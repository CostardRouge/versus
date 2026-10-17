import { buildDemo, DEMOS, relabelDemos } from '../core/demos';
import { voterId } from '../core/published';
import { detectLang, type Lang, setLang as setI18nLang, t } from '../i18n';
import { initDom, toast } from './dom';
import { bindEvents, loadSharing } from './events';
import { applyStatic } from './header';
import { hasImageRefs, loadImages, storedForm, tidyImages } from './images';
import { receiveShare } from './inbox';
import { setRender } from './nav';
import { checkPush, listenPush } from './push';
import { initPwa } from './pwa';
import { openBoard, render, routeFromURL } from './rankings';
import { S, save } from './state';
import { loadJoined, loadLegacyRanks, loadPrefs, loadRanks, loadVoter } from './storage';

/**
 * Entry point of the app UI. The views live in their own modules: gallery, workspace (shell, tabs,
 * method menu), items (side list), duel, results, color (popover), publish (modal) and board (published
 * boards, over remote); rankings holds navigation and ranking-level actions, events the delegated
 * listeners, state and dom the shared pieces.
 */

/** Loads saved data (or migrates prototype data), adds the demos and renders the gallery or the linked board. */
export function mount(d: Document): void {
  initDom(d);
  setRender(render);
  S.prefs = loadPrefs();
  S.voter = loadVoter(() => voterId(crypto.getRandomValues(new Uint8Array(22))));
  const lang: Lang = detectLang(S.prefs.lang, navigator.language);
  setI18nLang(lang);
  let damaged = false;
  const stored = loadRanks(() => {
    damaged = true;
    setTimeout(() => toast(t('storageDamaged')), 0);
  });
  S.ranks = stored ?? loadLegacyRanks();
  S.joined = loadJoined();
  // Written back only when something changed: every ranking is rewritten, images included.
  let changed = stored === null || damaged;
  for (const demo of DEMOS) {
    if (S.ranks.some((r) => r.id === demo.id)) continue;
    S.ranks.push(buildDemo(demo, lang));
    changed = true;
  }
  if (relabelDemos(S.ranks, lang === 'fr' ? 'en' : 'fr', lang)) changed = true;
  // Images kept in IndexedDB are read before the first render, so cards never show without them (D124).
  if (hasImageRefs(S.ranks)) void loadImages(S.ranks).then(() => start(changed));
  else start(changed);
}

function start(changed: boolean): void {
  // Also moves images still inline in localStorage (saved before D124) into IndexedDB.
  if (changed || storedForm(S.ranks).pending.size) save();
  bindEvents();
  initPwa();
  applyStatic();
  // The address names the view: the gallery, a ranking, a demo or a published board.
  routeFromURL();
  // Photos, text or a file another app shared to Versus (the manifest's share_target).
  void receiveShare();
  // A tapped notification opens its board here.
  listenPush((alias) => openBoard(alias));
  // What the first view doesn't need, once the page is idle.
  const idle = (run: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500);
  idle(() => void loadSharing().catch(() => {}));
  // Unused images and the notifications' subscription, once the app is up: never in the way of the first render.
  setTimeout(() => {
    void tidyImages(S.ranks);
    void checkPush();
  }, 5000);
}
