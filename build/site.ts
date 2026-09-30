import { LINKS } from '../src/app/about.ts';
import { en } from '../src/i18n/en.ts';
import { fr } from '../src/i18n/fr.ts';

/**
 * Every sitewide fact the page head, the web app manifest, robots.txt, the sitemap, llms.txt and the icons
 * are built from (build/seo.ts, scripts/icons.ts). Nothing about SEO is written by hand elsewhere: rename
 * the app, change its description or a color here and every output follows.
 */

/**
 * Canonical address of the app, trailing slash included: the Worker's domain, which the GitHub Pages copy
 * points to as well. `VITE_SITE_URL` overrides it at build time.
 */
export const DEFAULT_SITE_URL = 'https://versus.steevepommier.com/';

export const NAME = 'Versus';

/** The languages of the site: a home page each, and the app's two languages. */
export type SiteLang = 'en' | 'fr';

/** Tab title and social title, 50 to 60 characters (tests check it); the app shows it in the current language. */
export const TITLES: Record<SiteLang, string> = { en: en.pageTitle, fr: String(fr.pageTitle) };
export const TITLE = TITLES.en;

/** Search snippet and social description: keep it within ~155 characters (tests check it). */
export const DESCRIPTIONS: Record<SiteLang, string> = {
  en: 'Rank anything by pairwise comparison: pick the better of two, duel after duel, and the ranking builds itself. Text, images or colors. Free, no account.',
  fr: 'Classe tout en comparant deux par deux : choisis le meilleur, duel après duel, et le classement se construit tout seul. Texte, images ou couleurs. Gratuit.',
};
export const DESCRIPTION = DESCRIPTIONS.en;

/**
 * The pages the build writes (vite.config.ts), relative to the site's root. Each language has its home page,
 * a static page search engines index (hreflang between the two); the app, which renders everything with
 * JavaScript and switches language by itself, lives under app/ and stays out of the index.
 */
export const PAGES = {
  home: { file: 'index.html', path: '', lang: 'en' },
  homeFr: { file: 'fr/index.html', path: 'fr/', lang: 'fr' },
  app: { file: 'app/index.html', path: 'app/', lang: 'en' },
} as const satisfies Record<string, { file: string; path: string; lang: SiteLang }>;
export type PageKey = keyof typeof PAGES;
/** The home page of each language. */
export const HOMES: Record<SiteLang, PageKey> = { en: 'home', fr: 'homeFr' };

/** What the app does, one line each: JSON-LD featureList and llms.txt. */
export const FEATURES = [
  'Duels with buttons, arrow keys or swipe, with undo, skip and ties',
  'Items of any kind: text, images, solid colors and gradients',
  'Four scoring methods, switchable at any time without losing a duel',
  'Results with a podium, a ± margin per item and a comparison of the methods',
  'English and French, light and dark themes',
  'Local-first: rankings stay in the browser, no account needed',
  'Installable as an app that works offline',
] as const;

/** The four scoring methods, as the app names them (llms.txt). */
export const METHODS = [
  {
    name: 'Balanced (default)',
    how: 'Bradley-Terry model fitted on all duels at once, with a ± standard error per item. Order-independent: best for things that do not change, like photos or products.',
  },
  {
    name: 'Dynamic',
    how: 'Elo rating updated duel by duel (K = 40 for an item’s first 6 duels, then 24). Order-dependent by design: for preferences that evolve.',
  },
  {
    name: 'Simple',
    how: 'Smoothed win rate, (wins + ties / 2 + 1) / (duels + 2). The easiest to read.',
  },
  {
    name: 'Exact sort',
    how: 'Binary insertion sort replayed from the duels: no ties, no skips, and a full order in the fewest duels.',
  },
] as const;

export const LOCALES: Record<SiteLang, string> = { en: 'en_US', fr: 'fr_FR' };
export const LOCALE = LOCALES.en;
export const ALTERNATE_LOCALES = ['fr_FR'] as const;
/** Languages the site speaks: one home page each; the app switches from the browser language or the visitor's choice. */
export const LANGUAGES = ['en', 'fr'] as const satisfies readonly SiteLang[];

/** Design tokens the icons and the manifest need (same values as styles.css). */
export const COLORS = {
  bg: '#ECEEF2',
  bgDark: '#0E1015',
  surface: '#FAFBFD',
  ink: '#13151B',
  muted: '#5A6072',
  line: '#D2D6DF',
  a: '#2743F5',
  b: '#E4492A',
  onAccent: '#FFFFFF',
} as const;

/**
 * Icon files written by `npm run icons` into public/ and declared by the head and the manifest. Google shows a
 * favicon in results only if it is a multiple of 48 px, hence 48 (in the .ico), 96 and 192; 180 is what iOS
 * wants for the home screen, 512 what Android wants for installs and splash screens. Like the social card,
 * a redesigned icon gets new file names: search engines cache favicons by URL for months.
 */
export const ICONS = {
  svg: 'icon.svg',
  ico: 'favicon.ico',
  icoSizes: [16, 32, 48],
  png: [96, 192, 512],
  maskable: 'icon-maskable-512.png',
  apple: 'apple-touch-icon.png',
  appleSize: 180,
  /** Old addresses still answered (with the current drawing) but no longer declared. */
  legacy: ['favicon.svg'],
} as const;

export const pngIcon = (size: number): string => `icon-${size}.png`;

/**
 * Social cards, one per language, generated by `npm run icons` from CARD_COPY. Rename a file if its design
 * changes: unfurlers cache by URL.
 */
export const OG_IMAGES = {
  en: {
    path: 'og.png',
    width: 1200,
    height: 630,
    type: 'image/png',
    alt: 'Versus: “Rank anything, two at a time” beside a duel between two cards, Kyoto (A) and Lisbon (B).',
  },
  fr: {
    path: 'og-fr.png',
    width: 1200,
    height: 630,
    type: 'image/png',
    alt: 'Versus : « Classe tout, deux par deux » à côté d’un duel entre deux cartes, Kyoto (A) et Lisbonne (B).',
  },
} as const satisfies Record<SiteLang, { path: string; width: number; height: number; type: string; alt: string }>;
export const OG_IMAGE = OG_IMAGES.en;

/** The words of each social card (scripts/icons.ts); only characters of the fonts' latin subset. */
export const CARD_COPY: Record<
  SiteLang,
  { lines: readonly [string, string]; body: string; cta: string; note: string; duel: readonly [string, string] }
> = {
  en: {
    lines: ['Rank anything,', 'two at a time'],
    body: 'Text, images or colors. Pick a winner, duel after duel, and the ranking builds itself.',
    cta: 'Start ranking',
    note: 'Free · No account',
    duel: ['Kyoto', 'Lisbon'],
  },
  fr: {
    lines: ['Classe tout,', 'deux par deux'],
    body: 'Texte, images ou couleurs. Choisis un gagnant, duel après duel : le classement se fait tout seul.',
    cta: 'Commencer',
    note: 'Gratuit · Sans compte',
    duel: ['Kyoto', 'Lisbonne'],
  },
};

export const REPOSITORY = LINKS.source;
export const LICENSE_URL = `${REPOSITORY}/blob/main/LICENSE`;

/**
 * The author. The `@id` is the one steevepommier.com gives the same person, so search engines join the two
 * graphs into one entity; the full profile (job, employers, every sameAs) lives there, not here.
 */
export const AUTHOR = {
  id: 'https://steevepommier.com/#person',
  name: LINKS.author.name,
  url: LINKS.author.url,
  sameAs: ['https://github.com/costardrouge'],
  twitter: '@BlousonRouge',
} as const;

/** Search engine ownership tokens (Search Console, Bing Webmaster Tools); emitted only when filled in. */
export const VERIFICATION: { google?: string; bing?: string } = {};
