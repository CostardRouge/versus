import type { BoardLang } from './types.ts';

/**
 * The site's pages and links, as the app, the home page, the legal notice and the build name them. Paths are
 * relative to the site's root, which can be a folder (the site also lives under github.io/versus/).
 */

/** The site's languages: the ones boards have too. */
type Lang = BoardLang;

/** Where the pages link to; build/site.ts takes the author and repository from here too. */
export const LINKS = {
  author: { name: 'Steeve Pommier', url: 'https://steevepommier.com/' },
  source: 'https://github.com/CostardRouge/versus',
} as const;

/** The home page of each language. */
export const HOME_PATH: Record<Lang, string> = { en: '', fr: 'fr/' };

/** The legal notice of each language. */
export const LEGAL_PATH: Record<Lang, string> = { en: 'legal/', fr: 'fr/mentions-legales/' };

/** The app, one for every language. */
export const APP_PATH = 'app/';

/**
 * The id of the tag carrying the measurement settings in each page's head: written by the build
 * (build/analytics.ts), read by the page (src/audience.ts), rewritten by the Worker on the template pages.
 */
export const MEASUREMENT_ID = 'analytics';
