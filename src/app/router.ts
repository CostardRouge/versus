import { pagePath, trackView } from '../audience';
import { parseRoute, type Route, routePath, trackedPath } from '../core/route';
import { doc } from './dom';
import { S } from './state';

/**
 * The address bar follows the view (D92): each view has a real path under the app's folder
 * (src/core/route.ts). The page's <base> is that folder (written at build time, build/seo-plugin.ts), so every
 * relative address resolves from it, however deep the view.
 */

/**
 * The app's folder: `/app/` on the site, `/versus/app/` on GitHub Pages, from the page's <base>. Without one
 * (tests), the app sits at the origin's root.
 */
export const appRoot = (): URL =>
  doc.querySelector('base[href]') ? new URL('./', doc.baseURI) : new URL('/', location.href);

/** Where the current address sits under the app's folder, without a leading slash. */
export function currentPath(): string {
  const root = appRoot().pathname;
  const path = location.pathname;
  if (!path.startsWith(root)) return '';
  try {
    return decodeURIComponent(path.slice(root.length));
  } catch {
    return '';
  }
}

function routeOfState(): Route {
  const r = S.route;
  if (r.view === 'board') return { view: 'board', alias: r.alias };
  if (r.view === 'rank') return { view: 'rank', id: r.id, tab: r.tab };
  return { view: 'gallery' };
}

/** The shareable address of a route. */
export const routeURL = (route: Route): string => new URL(routePath(route), appRoot()).href;

/** The site's home page (the folder above the app's), where a shared local ranking sends people. */
export const siteURL = (): string => new URL('../', appRoot()).href;

/**
 * Writes the current view into the address bar: a new history entry for a change of view (Back returns to the
 * previous one), a replacement for a tab or a correction. Nothing happens when the address is already right.
 * Every view goes through here, at startup and on Back and Forward too, so it is also where a view is counted
 * (src/audience.ts), under its path without identifiers: the same view twice in a row counts once.
 */
export function syncURL(mode: 'push' | 'replace' = 'push'): void {
  const route = routeOfState();
  trackView(`${pagePath()}${trackedPath(route)}`);
  const url = new URL(routeURL(route));
  if (url.pathname === location.pathname && !location.hash && !location.search) return;
  // An entry opened from the gallery says so: "‹ Rankings" then steps back to it (rankings.ts goBack). A
  // replacement (a tab) keeps what its entry knew.
  if (mode === 'push') history.pushState(fromGallery() ? { fromGallery: true } : null, '', url.pathname);
  else history.replaceState(history.state, '', url.pathname);
}

/** Whether the address on screen is the gallery's. */
const fromGallery = (): boolean => parseRoute(currentPath())?.view === 'gallery';

/** True when the entry on screen was opened from the gallery, the entry just before it. */
export const backIsGallery = (): boolean => (history.state as { fromGallery?: boolean } | null)?.fromGallery === true;

/**
 * A page shown over a view at the same address (a board's end-of-vote page): it gets a history entry of its own,
 * so that Back (a phone's above all) closes it instead of leaving the view. The address doesn't change.
 */
export type Layer = 'finale';

/** The layer the entry on screen shows, if any. */
export const currentLayer = (): Layer | null => (history.state as { layer?: Layer } | null)?.layer ?? null;

export function pushLayer(layer: Layer): void {
  if (currentLayer() !== layer) history.pushState({ layer }, '', location.pathname);
}

/** A layer closed from the page (its own button): its entry goes as Back would take it. */
export function popLayer(layer: Layer): void {
  if (currentLayer() === layer) history.back();
}

/** The entry on screen shows the view under its layer after all (the layer can't be shown again). */
export function dropLayer(): void {
  if (currentLayer()) history.replaceState(null, '', location.pathname);
}

/**
 * Where a path kept by the 404 page leads: under the app's folder on this origin, or nowhere (null). A scheme, a
 * backslash or a protocol-relative path would name another origin, which the address bar can't take.
 */
export function stashedURL(path: string): string | null {
  try {
    const root = appRoot();
    const url = new URL(path.replace(/^[/\\]+/, ''), root);
    return url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

/** GitHub Pages answers a deep link with 404.html, which keeps the path here and loads the app's folder. */
export const STASH_KEY = 'versus-path';
export function takeStash(): string | null {
  try {
    const path = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    return path;
  } catch {
    return null;
  }
}
