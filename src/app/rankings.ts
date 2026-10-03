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
import { enterBoard, followLayer, leaveBoard, renderBoard } from './board';
import { closeColor } from './color';
import { $, ask, focusOn, keepFocus, narrow, toast } from './dom';
import { clearEnding } from './ending';
import { galleryHTML, setNotice } from './gallery';
import { applyStatic, viewTitle } from './header';
import { renderList } from './items';
import { joinedOf, joinedToRanking, refreshJoined } from './joined';
import { readPopular, refreshPopular } from './popular';
import { online } from './remote';
import { backIsGallery, currentPath, routeURL, stashedURL, syncURL, takeStash } from './router';
import { cur, S, save } from './state';
import { savePrefs } from './storage';
import { setTab, wsHTML } from './workspace';

/** Top-level view switch (gallery, workspace or published board), navigation and actions on whole rankings. */

/**
 * Draws the view the route names. The same view drawn again keeps its focused control (keepFocus), else gives the
 * focus to `fallback`'s element.
 */
export function render(fallback?: () => HTMLElement | null): void {
  keepFocus(draw, fallback);
}
/** The view's heading, ready to take the focus. */
function heading(): HTMLElement | null {
  const h = $('#view h1');
  if (h && !h.hasAttribute('tabindex')) h.tabIndex = -1;
  return h;
}
function draw(): void {
  closeColor();
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
  setNotice(null);
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
/** "Make my own" from a card under "Your votes": the board's items, without the votes. */
export function makeMineFromCard(alias: string | undefined): void {
  const j = alias ? joinedOf(alias) : undefined;
  if (j) makeOwn(j.title, j.items, 'card');
}
/** "Make my own" from a popular board: its items, read from the server, without the votes. */
export async function makeMineFromPopular(alias: string | undefined): Promise<void> {
  const view = await readPopular(alias);
  if (view) makeOwn(view.title, view.items, 'template');
}
/** "Keep a copy" of a board that is gone: its items and votes as a ranking of this browser, on its result. */
export function keepJoinedCopy(alias: string | undefined): void {
  const r = joinedToRanking(alias);
  if (!r) return;
  open(r.id, 'results');
  toast(t('copyKept'));
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
  const at = S.ranks.indexOf(r);
  S.ranks = S.ranks.filter((x) => x !== r);
  save();
  if (S.route.view === 'rank' && S.route.id === id) {
    S.route = { view: 'gallery', tab: 'duel' };
    syncURL('replace');
  }
  // Its card is gone: the focus goes to the gallery's heading.
  render(heading);
  // Undo puts it back in its place, duels and all.
  toast(t('deleted'), {
    label: t('undoToast'),
    run: () => {
      if (S.ranks.some((x) => x.id === r.id)) return;
      S.ranks.splice(Math.min(at, S.ranks.length), 0, r);
      save();
      render();
    },
  });
}

/**
 * Back to the gallery. A view opened from it steps back to its entry, as the browser's Back would: a new one
 * would make Back loop to the view just left. The gallery and its address show at once; the history follows.
 */
export function goBack(): void {
  if (S.route.view === 'gallery') return;
  const back = backIsGallery();
  S.route = { view: 'gallery', tab: 'duel' };
  syncURL(back ? 'replace' : 'push');
  if (back) history.back();
  render();
  focusView();
  window.scrollTo?.(0, 0);
}

/** Closes the gallery's notice. */
export function closeNotice(): void {
  setNotice(null);
  render();
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
  setNotice(null);
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
  // The gallery on screen already (the step back "‹ Rankings" takes, goBack): nothing to draw again.
  if (booted && route?.view === 'gallery' && S.route.view === 'gallery' && $('#view .gallery')) return;
  if (route?.view === 'board') {
    owner ??= parseOwnerFragment(location.hash);
    // A duel link (`?duel=a.b`): the board opens on that duel; the address loses the query once open.
    const duel = parseDuelQuery(location.search);
    if (owner) {
      history.replaceState(null, '', location.pathname);
      // Reconnect with the token: the board keeps it only once the server says it is this board's (board.ts).
      leaveBoard();
    } else if (S.route.view === 'board' && S.route.alias === route.alias && !duel) {
      // The same board: Back or Forward between it and its end-of-vote page.
      followLayer();
      return;
    }
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
  }
  // What the address named isn't here: the gallery says so until closed, not in a toast gone in seconds.
  if (route?.view !== 'gallery') setNotice(t(route ? 'rankNotHere' : 'pathUnknown'));
  clearEnding();
  S.route = { view: 'gallery', tab: 'duel' };
  syncURL('replace');
  render();
  focusView();
}
