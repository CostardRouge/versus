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
