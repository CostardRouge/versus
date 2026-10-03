/**
 * The preferences every page shares (`versus-prefs`): the home page and the legal notice read the theme and the
 * language, and remember a language chosen there so the app opens in it; the app owns the rest (src/app/storage.ts).
 */
export const PREFS_KEY = 'versus-prefs';

/** What is stored, as an object: nothing, garbage or no storage at all read as `{}`. */
export function readPrefs(): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Remembers a language, keeping the other preferences; `force: false` leaves one already chosen alone. */
export function rememberLang(lang: 'en' | 'fr', force = true): void {
  try {
    const prefs = readPrefs();
    if (!force && (prefs.lang === 'en' || prefs.lang === 'fr')) return;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, lang }));
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}

/**
 * Inline code for a page's first-paint script, run once `theme` (a variable there) holds a chosen theme: the
 * browser's bar takes that theme's color, read from the theme-color tag of its scheme (the build writes one per
 * scheme, build/seo.ts). The app does the same when the theme changes (src/app/header.ts).
 */
export const THEME_BAR_JS = `var bars = document.querySelectorAll('meta[name="theme-color"]'), own = {};
        for (var i = 0; i < bars.length; i++) own[/dark/.test(bars[i].getAttribute('media')) ? 'dark' : 'light'] = bars[i].content;
        for (var j = 0; j < bars.length; j++) bars[j].content = own[theme] || bars[j].content;`;
