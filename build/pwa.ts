import { createHash } from 'node:crypto';
import { ICONS } from './site.ts';

/** The service worker's file name, at the root of the build next to index.html (its scope is the whole site). */
export const SW_FILE = 'sw.js';

/** Placeholders in src/sw/sw.ts, replaced in the built worker. */
export const PRECACHE_MARK = '__PRECACHE__';
export const VERSION_MARK = '__VERSION__';

/**
 * What the service worker stores at install: the pages (the app and the two home pages, so an app installed
 * before the home page existed still opens offline), their scripts and styles, the latin fonts of the first
 * render, the manifest and the SVG icon. Other files under assets/ (font subsets for other scripts) are stored
 * on first use; the social cards, PNG icons and crawler files are never needed offline.
 */
const PRECACHE = [
  /^(?:(?:fr|app)\/)?index\.html$/,
  /^assets\/[^/]+\.(?:js|css)$/,
  /^assets\/[^/]+-latin-(?!ext-)[^/]*\.woff2$/,
  /^manifest\.webmanifest$/,
  new RegExp(`^${ICONS.svg.replace(/\./g, '\\.')}$`),
];

/** A page's address from its file: `app/index.html` is stored as `./app/`. */
export const pageAddress = (file: string): string => `./${file.replace(/index\.html$/, '')}`;

/**
 * Files to precache, relative to the worker's scope. Pages are stored under their folder's address (`./`,
 * `./fr/`, `./app/`), the one every host serves directly: Cloudflare redirects `/index.html` to `/`, and a
 * navigation can't be answered with a redirected response.
 */
export function precacheList(files: Iterable<string>): string[] {
  return [...files]
    .filter((f) => PRECACHE.some((re) => re.test(f)))
    .map((f) => (f.endsWith('index.html') ? pageAddress(f) : f))
    .sort();
}

/** A short hash of the precached files' names and bytes: it changes, and a new worker installs, on every deploy that changes them. */
export function cacheVersion(files: ReadonlyArray<readonly [name: string, body: string | Uint8Array]>): string {
  const hash = createHash('sha256');
  for (const [name, body] of [...files].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    hash.update(name).update('\0').update(body).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/** Puts the precache list and the version into the built worker. */
export function injectPrecache(code: string, list: readonly string[], version: string): string {
  if (!code.includes(PRECACHE_MARK) || !code.includes(VERSION_MARK)) {
    throw new Error(`the service worker needs both ${PRECACHE_MARK} and ${VERSION_MARK}`);
  }
  return code.replaceAll(PRECACHE_MARK, JSON.stringify(list)).replaceAll(VERSION_MARK, JSON.stringify(version));
}
