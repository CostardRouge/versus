import { buildDemo, DEMOS, relabelDemos } from '../core/demos';
import { voterId } from '../core/published';
import { detectLang, type Lang, setLang as setI18nLang, t } from '../i18n';
import { initDom, toast } from './dom';
import { bindEvents } from './events';
import { applyStatic } from './header';
import { initPwa } from './pwa';
import { routeFromURL } from './rankings';
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
  S.prefs = loadPrefs();
  S.voter = loadVoter(() => voterId(crypto.getRandomValues(new Uint8Array(22))));
  const lang: Lang = detectLang(S.prefs.lang, navigator.language);
  setI18nLang(lang);
  S.ranks = loadRanks(() => setTimeout(() => toast(t('storageDamaged')), 0)) ?? loadLegacyRanks();
  S.joined = loadJoined();
  for (const demo of DEMOS) {
    if (!S.ranks.some((r) => r.id === demo.id)) S.ranks.push(buildDemo(demo, lang));
  }
  relabelDemos(S.ranks, lang === 'fr' ? 'en' : 'fr', lang);
  save();
  bindEvents();
  initPwa();
  applyStatic();
  // The address names the view: the gallery, a ranking, a demo or a published board.
  routeFromURL();
}
