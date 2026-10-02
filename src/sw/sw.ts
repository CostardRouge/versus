/**
 * Versus service worker: the app works offline and opens instantly (docs/pwa.md).
 *
 * The build (build/pwa-plugin.ts) replaces the two placeholders below with the files to store at install and
 * a version derived from their content, so every deploy that changes the app installs a new worker. The new
 * worker waits until the page asks it to take over (src/app/pwa.ts), which the user decides: a deploy never
 * reloads the app in the middle of a duel.
 *
 * Only the site's own files go through here, plus what other apps share to Versus (the manifest's
 * share_target): set aside in a cache of its own, then picked up by the app (src/app/inbox.ts). The published
 * boards API, other origins and anything else but GET reach the network untouched. The app (app/) opens from
 * the cache; the home pages (the root, fr/) come from the network when there is one, so they are always
 * current, and from the cache offline.
 *
 * It also shows the notifications of published boards the Worker sends (src/core/push.ts) and, on a tap, opens
 * the board in the app: the open one if there is one, a new window otherwise.
 */

declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const PREFIX = 'versus-';
const CACHE = `${PREFIX}${__VERSION__}`;
const scope = new URL(self.registration.scope);
const at = (path: string): string => new URL(path, scope).href;
const PRECACHED = new Set(__PRECACHE__.map(at));
/** The app's page, stored under its folder's address (see precacheList in build/pwa.ts). */
const SHELL = at('./app/');
/** The home pages, by path relative to the scope; `index.html` is the same page as its folder. */
const HOMES: Record<string, string> = {
  '': at('./'),
  'index.html': at('./'),
  'fr/': at('./fr/'),
  'fr/index.html': at('./fr/'),
};
/** Where the manifest's share_target posts, and the cache that holds a share until the app picks it up. */
const SHARE_PATH = 'app/share-target';
const INBOX = `${PREFIX}inbox`;
/** As many files as one drop takes (items.ts). */
const SHARE_FILES = 60;
/** The notifications' icon and badge (ICONS in build/site.ts; the badge is a white silhouette Android tints). */
const ICON = at('icon-192.png');
const BADGE = at('badge-96.png');
/** A notification as the Worker sends it (PushMessage in src/core/push.ts). */
interface PushMessage {
  title: string;
  body: string;
  path: string;
  tag: string;
}
/** A path of the app (`app/b/<alias>`): a notification never opens anything else. */
const APP_PATH = /^app\/[\w/-]*$/;

self.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, which could still hold the previous deploy's page.
  const requests = [...PRECACHED].map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE && key !== INBOX) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (req.method === 'POST' && path === SHARE_PATH) event.respondWith(receive(req));
  if (req.method !== 'GET' || path.startsWith('api/')) return;
  if (req.mode === 'navigate') {
    // Every address under app/ is a view of the one app page (app/demo/…, app/b/…, D92); anything else opened
    // directly (robots.txt, llms.txt…) goes to the network.
    if (path.startsWith('app/')) event.respondWith(page(req));
    else if (path in HOMES) event.respondWith(home(req, HOMES[path] as string));
    return;
  }
  if (PRECACHED.has(url.origin + url.pathname) || path.startsWith('assets/')) event.respondWith(file(req, event));
});

self.addEventListener('push', (event) => {
  const msg = readPush(event.data);
  if (!msg) return;
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      icon: ICON,
      badge: BADGE,
      data: { path: msg.path },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data as { path?: unknown } | null)?.path;
  event.waitUntil(openApp(typeof path === 'string' && APP_PATH.test(path) ? path : 'app/'));
});

/** A message as the Worker sends it (PushMessage in src/core/push.ts); anything else is not shown. */
function readPush(data: PushMessageData | null): PushMessage | null {
  try {
    const x = data?.json() as Partial<PushMessage> | undefined;
    if (!x || typeof x.title !== 'string' || typeof x.body !== 'string' || typeof x.tag !== 'string') return null;
    if (typeof x.path !== 'string' || !APP_PATH.test(x.path)) return null;
    return { title: x.title, body: x.body, path: x.path, tag: x.tag };
  } catch {
    return null;
  }
}

/** The app's window comes forward and opens the view itself, without reloading (src/app/push.ts); or a new one. */
async function openApp(path: string): Promise<void> {
  const url = at(path);
  const app = (await self.clients.matchAll({ type: 'window' })).find((c) => c.url.startsWith(SHELL));
  if (app) {
    await app.focus().catch(() => app);
    app.postMessage({ t: 'open', path });
    return;
  }
  await self.clients.openWindow(url);
}

/** The stored page, or the network if the cache was cleared. */
async function page(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  return (await cache.match(SHELL)) ?? fetch(req);
}

/** A home page: the network first, so it is always current; the stored copy offline. */
async function home(req: Request, stored: string): Promise<Response> {
  try {
    return await fetch(req);
  } catch (err) {
    const hit = await (await caches.open(CACHE)).match(stored);
    if (hit) return hit;
    throw err;
  }
}

/** Stored files first. Files under assets/ have hashed names and never change: keep the ones fetched later. */
async function file(req: Request, event: FetchEvent): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) event.waitUntil(cache.put(req, res.clone()));
  return res;
}

/**
 * A share from another app: its title, text, link and files go to the inbox (replacing one never picked up),
 * then the app opens and picks them up. Whatever happens, the app opens: at worst with nothing to add.
 */
async function receive(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    await caches.delete(INBOX);
    const inbox = await caches.open(INBOX);
    const text = (name: string): string => {
      const v = form.get(name);
      return typeof v === 'string' ? v : '';
    };
    const files = form
      .getAll('files')
      .filter((f): f is File => typeof f !== 'string')
      .slice(0, SHARE_FILES);
    const list = await Promise.all(
      files.map(async (f, i) => {
        const key = at(`app/inbox/${i}`);
        await inbox.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
        return { key, name: f.name, type: f.type };
      }),
    );
    const meta = { title: text('title'), text: text('text'), url: text('url'), files: list };
    await inbox.put(
      at('app/inbox/meta'),
      new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch {
    /* nothing to pick up */
  }
  return Response.redirect(at('./app/'), 303);
}

export {};
