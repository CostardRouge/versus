/**
 * Versus service worker: the app works offline and opens instantly (docs/pwa.md).
 *
 * The build (build/pwa-plugin.ts) replaces the two placeholders below with the files to store at install and
 * a version derived from their content, so every deploy that changes the app installs a new worker. The new
 * worker waits until the page asks it to take over (src/app/pwa.ts), which the user decides: a deploy never
 * reloads the app in the middle of a duel.
 *
 * Only the app's own files go through here. The published boards API, other origins and anything but GET
 * reach the network untouched.
 */

declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const PREFIX = 'versus-';
const CACHE = `${PREFIX}${__VERSION__}`;
const scope = new URL(self.registration.scope);
const at = (path: string): string => new URL(path, scope).href;
const PRECACHED = new Set(__PRECACHE__.map(at));
/** The page, stored under the scope's address (see precacheList in build/pwa.ts). */
const SHELL = at('./');

self.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, which could still hold the previous deploy's page.
  const requests = [...PRECACHED].map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
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
    // The app is one page (its routes live in the fragment); anything else opened directly (robots.txt,
    // llms.txt…) goes to the network. Path routes such as /b/<alias> would need absolute asset URLs first.
    if (path === '' || path === 'index.html') event.respondWith(page(req));
    return;
  }
  if (PRECACHED.has(url.origin + url.pathname) || path.startsWith('assets/')) event.respondWith(file(req, event));
});

/** The stored page, or the network if the cache was cleared. */
async function page(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  return (await cache.match(SHELL)) ?? fetch(req);
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
