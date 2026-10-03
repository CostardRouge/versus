/**
 * Versus service worker: the app works offline and opens instantly (docs/pwa.md).
 *
 * The build (build/pwa-plugin.ts) replaces the two placeholders below with the files to store at install and
 * a version derived from their content, so every deploy that changes the app installs a new worker. The new
 * worker waits until the page asks it to take over (src/app/pwa.ts), which the user decides: a deploy never
 * reloads the app in the middle of a duel.
 *
 * Only the site's own files go through here. The published boards API, other origins and anything but GET
 * reach the network untouched. The app (app/) opens from the cache; the home pages (the root, fr/) come from
 * the network when there is one, so they are always current, and from the cache offline.
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
/**
 * The pages served from the network first (always current) and from the cache offline: the home pages and the legal
 * notices, by path relative to the scope; `index.html` is the same page as its folder.
 */
const HOMES: Record<string, string> = {
  '': at('./'),
  'index.html': at('./'),
  'fr/': at('./fr/'),
  'fr/index.html': at('./fr/'),
  'legal/': at('./legal/'),
  'legal/index.html': at('./legal/'),
  'fr/mentions-legales/': at('./fr/mentions-legales/'),
  'fr/mentions-legales/index.html': at('./fr/mentions-legales/'),
};

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

/**
 * Stores the files of this version. Files under assets/ have hashed names: one the previous version already holds
 * is the same file, copied over instead of downloaded again (a deploy changes a few of them, not the fonts). The
 * rest is fetched with `reload`, which skips the HTTP cache: it could still hold the previous deploy's page.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  const previous = await Promise.all(
    (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.open(k)),
  );
  const fetched: Request[] = [];
  for (const url of PRECACHED) {
    const hashed = new URL(url).pathname.startsWith(`${scope.pathname}assets/`);
    let kept: Response | undefined;
    for (const old of hashed ? previous : []) {
      kept = await old.match(url);
      if (kept) break;
    }
    if (kept) await cache.put(url, kept);
    else fetched.push(new Request(url, { cache: 'reload' }));
  }
  await cache.addAll(fetched);
  // An older version that took over meanwhile (Reload in a tab) deleted every other cache, this one included: this
  // install fails, and the browser tries it again at its next update check.
  if (!(await caches.has(CACHE))) throw new Error('cache deleted during install');
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The files of this version, stored again if an older version's activation deleted them after the install.
      if (!(await caches.has(CACHE))) await precache().catch(() => {});
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
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
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('api/')) return;
  if (req.mode === 'navigate') {
    // Every address under app/ is a view of the one app page (app/demo/…, app/b/…, D92); anything else opened
    // directly (robots.txt, llms.txt…) goes to the network.
    // `app` without its slash is the address people type.
    if (path === 'app' || path.startsWith('app/')) event.respondWith(page(req));
    else if (path in HOMES) event.respondWith(home(req, HOMES[path] as string));
    return;
  }
  // The moderation page's files stay out of the cache: only its publisher uses them, online.
  if (path.startsWith('assets/admin-')) return;
  if (PRECACHED.has(url.origin + url.pathname) || path.startsWith('assets/')) event.respondWith(file(req, event));
});

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

export {};
