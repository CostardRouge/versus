import { buildDemo, DEMOS, relabelDemos } from '../core/demos';
import { detectLang, type Lang, setLang as setI18nLang } from '../i18n';
import { initDom } from './dom';
import { bindEvents } from './events';
import { applyStatic } from './header';
import { render } from './rankings';
import { S, save } from './state';
import { loadLegacyRanks, loadPrefs, loadRanks } from './storage';

/**
 * Entry point of the app UI. The views live in their own modules: gallery, workspace (shell, tabs,
 * method menu), items (side list), duel, results and color (popover); rankings holds navigation and
 * ranking-level actions, events the delegated listeners, state and dom the shared pieces.
 */

/** Loads saved data (or migrates prototype data), adds the demos and renders the gallery. */
export function mount(d: Document): void {
  initDom(d);
  S.prefs = loadPrefs();
  const lang: Lang = detectLang(S.prefs.lang, navigator.language);
  setI18nLang(lang);
  S.ranks = loadRanks() ?? loadLegacyRanks();
  for (const demo of DEMOS) {
    if (!S.ranks.some((r) => r.id === demo.id)) S.ranks.push(buildDemo(demo, lang));
  }
  relabelDemos(S.ranks, lang === 'fr' ? 'en' : 'fr', lang);
  save();
  bindEvents();
  applyStatic();
  render();
}
