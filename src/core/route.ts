import { ALIAS_RE } from './board';

/**
 * The app's addresses (D92): real paths under the app's folder, so every view has a link that can be
 * reloaded, bookmarked and shared. Pure: the app maps them to its state (src/app/rankings.ts).
 *
 *   ''                     the gallery
 *   demo/<slug>[/<tab>]    a demo (the same for everyone: its link works anywhere)
 *   r/<id>[/<tab>]         a ranking of this browser
 *   b/<alias>              a published board
 *
 * The tab is left out for the duel, `ranking` for the results and `items` for the list.
 */

export type RouteTab = 'items' | 'duel' | 'results';
export type Route =
  | { view: 'gallery' }
  | { view: 'rank'; id: string; tab: RouteTab }
  | { view: 'board'; alias: string };

/** Demo rankings have fixed ids with this prefix (core/demos.ts); their address drops it. */
export const DEMO_PREFIX = 'demo-';

const TAB_SLUGS: Record<RouteTab, string> = { items: 'items', duel: '', results: 'ranking' };
const SLUG_TABS: Record<string, RouteTab> = { '': 'duel', duel: 'duel', items: 'items', ranking: 'results' };
/** Local ids come from uid() (letters and digits); demo slugs are lowercase words. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The path of a route, relative to the app's folder (no leading slash). */
export function routePath(route: Route): string {
  if (route.view === 'board') return `b/${route.alias}`;
  if (route.view === 'gallery') return '';
  const demo = route.id.startsWith(DEMO_PREFIX);
  const base = demo ? `demo/${route.id.slice(DEMO_PREFIX.length)}` : `r/${route.id}`;
  const tab = TAB_SLUGS[route.tab];
  return tab ? `${base}/${tab}` : base;
}

/**
 * A route as audience measurement records it (docs/analytics.md): the same path, with what identifies a ranking
 * of this browser or a published board replaced by a placeholder (`r/:id/ranking`, `b/:alias`). Demos keep their
 * slug: they are the same for everyone.
 */
export function trackedPath(route: Route): string {
  if (route.view === 'board') return routePath({ view: 'board', alias: ':alias' });
  if (route.view === 'rank' && !route.id.startsWith(DEMO_PREFIX)) return routePath({ ...route, id: ':id' });
  return routePath(route);
}

/** The route a path names, or null when it names none (the app then shows the gallery). */
export function parseRoute(path: string): Route | null {
  const parts = path.split('/').filter(Boolean);
  const [kind, key, tabSlug, ...rest] = parts;
  if (!kind) return { view: 'gallery' };
  if (kind === 'b') {
    return key && ALIAS_RE.test(key) && tabSlug === undefined ? { view: 'board', alias: key } : null;
  }
  if ((kind !== 'demo' && kind !== 'r') || !key || !ID_RE.test(key) || rest.length) return null;
  const tab = SLUG_TABS[tabSlug ?? ''];
  if (!tab) return null;
  return { view: 'rank', id: kind === 'demo' ? `${DEMO_PREFIX}${key}` : key, tab };
}

/** An author's link carries their token in the fragment (`#owner=…`), which never reaches a server. */
export const ownerFragment = (token: string): string => `#owner=${token}`;
export function parseOwnerFragment(hash: string): string | null {
  return /^#owner=([0-9a-f]{64})$/.exec(hash)?.[1] ?? null;
}
