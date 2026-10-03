import { trackEvent } from '../audience';
import { buildDemo, DEMOS, relabelDemos } from '../core/demos';
import { mkRank } from '../core/model';
import { parseBoardHash } from '../core/published';
import { parseOwnerFragment, parseRoute } from '../core/route';
import { methodOf } from '../core/scoring';
import { parseDuelQuery } from '../core/share';
import type { Item, Ranking } from '../core/types';
import { uid } from '../core/util';
import { getLang, isLang, plural, setLang as setI18nLang, t } from '../i18n';
import { enterBoard, leaveBoard, renderBoard } from './board';
import { cp } from './color';
import { $, ask, focusOn, keepFocus, narrow, toast } from './dom';
import { clearEnding } from './ending';
import { galleryHTML } from './gallery';
import { applyStatic, viewTitle } from './header';
import { renderList } from './items';
import { refreshJoined } from './joined';
import { refreshPopular } from './popular';
import { online } from './remote';
import { currentPath, routeURL, stashedURL, syncURL, takeStash } from './router';
import { cur, S, save } from './state';
import { savePrefs } from './storage';
import { setTab, wsHTML } from './workspace';

/** Top-level view switch (gallery, workspace or published board), navigation and actions on whole rankings. */

/** Draws the view the route names. The same view drawn again keeps its focused control (keepFocus). */
export function render(): void {
  keepFocus(draw);
}
function draw(): void {
  const pop = $('#cpop');
  if (pop && !pop.hidden) {
    pop.hidden = true;
    cp.id = null;
  }
  const view = $('#view');
  if (!view) return;
  if (S.route.view !== 'board') leaveBoard();
  if (S.route.view === 'board') {
    viewTitle();
    renderBoard();
  } else if (S.route.view === 'rank') {
    const r = cur();
    if (!r) {
      S.route = { view: 'gallery', tab: 'duel' };
      syncURL('replace');
      draw();
      return;
    }
    viewTitle(r.title);
    view.innerHTML = wsHTML(r);
    renderList(r, false);
    setTab(S.route.tab);
  } else {
    viewTitle();
    view.innerHTML = galleryHTML();
    void refreshJoined();
    void refreshPopular();
  }
}

/** False until the page's first view is on screen: that one leaves the focus where the browser puts it. */
let booted = false;
/** After a change of view, the focus goes to the new view's heading, where a screen reader starts reading. */
function focusView(): void {
  if (booted) focusOn($('#view h1'));
}

/** Opens a ranking; `replace` when the view it leaves shouldn't stay in the history (a withdrawn board). */
export function open(id: string | undefined, tab: string | undefined, opts: { replace?: boolean } = {}): void {
  if (!id) return;
  clearEnding();
  const pub = S.ranks.find((r) => r.id === id)?.pub;
  if (pub) {
    openBoard(pub.alias, opts);
    return;
  }
  S.route = { view: 'rank', id, tab: tab === 'results' || tab === 'items' ? tab : 'duel' };
  syncURL(opts.replace ? 'replace' : 'push');
  render();
  focusView();
  window.scrollTo?.(0, 0);
}
export function newRank(title?: string): Ranking {
  const r = mkRank(title ?? t('newRanking'));
  S.ranks.push(r);
  save();
  trackEvent('ranking-created', { from: 'new' });
  open(r.id, narrow.matches ? 'items' : 'duel');
  if (!title) {
    const input = $<HTMLInputElement>('#rank-title');
    input?.focus();
    input?.select();
  }
  return r;
}
export async function resetRank(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  if (r.demo) return resetDemo(id);
  const ok = await ask({
    title: t('resetTitle'),
    body: t('resetBody', { duels: plural(r.history.length, 'duel'), title: r.title }),
    ok: t('restart'),
    danger: true,
  });
  if (!ok) return;
  r.history = [];
  r.pair = null;
  r.updated = Date.now();
  save();
  render();
  toast(t('resetDone'));
}
export async function resetDemo(id: string | undefined): Promise<void> {
  const d = DEMOS.find((x) => x.id === id);
  if (!d) return;
  const ok = await ask({ title: t('resetDemoTitle'), body: t('resetDemoBody'), ok: t('reset') });
  if (!ok) return;
  const i = S.ranks.findIndex((r) => r.id === id);
  const fresh = buildDemo(d, getLang());
  if (i >= 0) S.ranks[i] = fresh;
  else S.ranks.push(fresh);
  save();
  render();
  toast(t('demoReset'));
}
export function duplicateRank(id: string | undefined): void {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const c = mkRank(`${r.title} ${t('copySuffix')}`, methodOf(r));
  c.items = r.items.map((it) => ({ ...structuredClone(it), id: uid() }));
  S.ranks.push(c);
  save();
  trackEvent('ranking-created', { from: r.demo ? 'demo' : 'copy' });
  open(c.id, 'duel');
  toast(t('copyCreated'));
}
/**
 * "Make my own": a ranking of this browser with a board's title and items (copied, no votes), for someone who
 * voted on it and wants their version, to change and publish; `template` when it starts from a popular board.
 */
export function makeOwn(title: string, items: readonly Item[], from: 'board' | 'card' | 'template'): Ranking {
  const r = mkRank(title);
  r.items = items.map((it) => ({ ...structuredClone(it), id: uid() }));
  S.ranks.push(r);
  save();
  trackEvent('ranking-created', { from });
  open(r.id, 'duel');
  toast(t('madeMine'));
  return r;
}
export function toggleDemos(): void {
  S.prefs.hideDemos = !S.prefs.hideDemos;
  savePrefs(S.prefs);
  render();
}
export function changeLang(l: string | undefined): void {
  const from = getLang();
  if (!isLang(l) || l === from) return;
  relabelDemos(S.ranks, from, l);
  setI18nLang(l);
  S.prefs.lang = l;
  savePrefs(S.prefs);
  save();
  applyStatic();
  render();
}
export async function deleteRank(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const ok = await ask({
    title: t('deleteTitle'),
    body: t('deleteBody', { title: r.title, items: plural(r.items.length, 'item') }),
    ok: t('deleteOk'),
    danger: true,
  });
  if (!ok) return;
  S.ranks = S.ranks.filter((x) => x.id !== id);
  save();
  if (S.route.id === id) {
    S.route = { view: 'gallery', tab: 'duel' };
    syncURL('replace');
  }
  render();
  toast(t('deleted'));
}

export function goBack(): void {
  if (S.route.view === 'gallery') return;
  S.route = { view: 'gallery', tab: 'duel' };
  syncURL();
  render();
  focusView();
  window.scrollTo?.(0, 0);
}

/**
 * Opens a published board at its own address, the link to share; `duel` is the pair a shared link asked for,
 * `owner` the token of an admin link just opened.
 */
export function openBoard(
  alias: string | undefined,
  opts: { replace?: boolean; duel?: [string, string] | null; owner?: string | null } = {},
): void {
  if (!alias) return;
  S.route = { view: 'board', alias, tab: 'duel' };
  syncURL(opts.replace ? 'replace' : 'push');
  enterBoard(alias, online(), opts.duel ?? null, opts.owner ?? null);
  render();
  focusView();
  window.scrollTo?.(0, 0);
}

/**
 * Shows what the address names: at startup, on Back and Forward, and for links written before paths (#/b/<alias>,
 * with `?owner=` for an author). An author's token (`#owner=…`) is kept on this device and taken out of the URL.
 * A ranking of another browser falls back to the gallery with a word of explanation.
 */
export function routeFromURL(): void {
  route();
  booted = true;
}
function route(): void {
  const stashed = takeStash();
  // The stashed path stays under the app's folder, on this origin; anything else is dropped.
  const target = stashed === null ? null : stashedURL(stashed);
  if (target) history.replaceState(null, '', target);
  let owner: string | null = null;
  const legacy = parseBoardHash(location.hash);
  if (legacy) {
    owner = legacy.owner;
    history.replaceState(null, '', routeURL({ view: 'board', alias: legacy.alias }));
  }
  const route = parseRoute(currentPath());
  if (route?.view === 'board') {
    owner ??= parseOwnerFragment(location.hash);
    // A duel link (`?duel=a.b`): the board opens on that duel; the address loses the query once open.
    const duel = parseDuelQuery(location.search);
    if (owner) {
      history.replaceState(null, '', location.pathname);
      // Reconnect with the token: the board keeps it only once the server says it is this board's (board.ts).
      leaveBoard();
    } else if (S.route.view === 'board' && S.route.alias === route.alias && !duel) return;
    if (duel) leaveBoard();
    openBoard(route.alias, { replace: true, duel, owner });
    return;
  }
  if (route?.view === 'rank') {
    const r = S.ranks.find((x) => x.id === route.id);
    if (r) {
      open(r.id, route.tab, { replace: true });
      return;
    }
    toast(t('rankNotHere'));
  }
  clearEnding();
  S.route = { view: 'gallery', tab: 'duel' };
  syncURL('replace');
  render();
  focusView();
}
