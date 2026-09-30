import { aboutHTML } from '../src/app/about.ts';
import { en } from '../src/i18n/en.ts';
import {
  AUTHOR,
  COLORS,
  DEFAULT_SITE_URL,
  DESCRIPTION,
  DESCRIPTIONS,
  FEATURES,
  HOMES,
  ICONS,
  LANGUAGES,
  LICENSE_URL,
  LOCALES,
  METHODS,
  NAME,
  OG_IMAGES,
  PAGES,
  type PageKey,
  pngIcon,
  REPOSITORY,
  type SiteLang,
  TITLES,
  VERIFICATION,
} from './site.ts';

/**
 * Build-time SEO: the head tags of each page, the JSON-LD graph and the generated files (manifest, robots.txt,
 * sitemap, llms.txt, Cloudflare headers), all derived from build/site.ts. Pure functions of the site URL, so
 * the Vite plugin (build/seo-plugin.ts) and the tests call the same code.
 */

/** HTML escaping for text and attribute values (a local copy: vite.config.ts loads this file, keep it self-contained). */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Absolute https URL with a trailing slash; anything unusable falls back to the default address. */
export function siteUrl(raw?: string): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_SITE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_SITE_URL;
    url.search = '';
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** index.html is served at the site URL itself, so its canonical form is the URL with its trailing slash. */
const abs = (url: string, path: string): string => new URL(path, url).href;

/** A page's canonical address: the site URL plus its folder (index.html files are served at their folder). */
export const pageUrl = (url: string, page: PageKey): string => abs(url, PAGES[page].path);

/** From a page back to the site's root, for relative links that work under any base (github.io/versus/). */
export const rootFrom = (page: PageKey): string =>
  '../'.repeat(PAGES[page].path.split('/').filter(Boolean).length) || './';

const isHome = (page: PageKey): boolean => page !== 'app';

/** Max snippet and a large image preview in results; the rest states the default posture explicitly. */
export const ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
/**
 * The app itself stays out of the index: it renders with JavaScript, switches language on one URL and would
 * compete with the home pages, which carry the text. `follow` keeps its links counting.
 */
export const ROBOTS_APP = 'noindex, follow';

const meta = (attr: 'name' | 'property', key: string, content: string): string =>
  `<meta ${attr}="${key}" content="${esc(content)}" />`;
const link = (attrs: Record<string, string>): string =>
  `<link ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ')} />`;

/**
 * One schema.org @graph for a home page, nodes referenced by stable @id rather than repeated. The site, the app,
 * its source and its author have one @id across both languages; the page and its card are the language's own.
 */
export function graph(url: string, lang: SiteLang = 'en'): Record<string, unknown>[] {
  const id = (fragment: string) => `${url}#${fragment}`;
  const page = pageUrl(url, HOMES[lang]);
  const person = { '@id': AUTHOR.id };
  const image = OG_IMAGES[lang];
  return [
    {
      '@type': 'WebSite',
      '@id': id('website'),
      url,
      name: NAME,
      description: DESCRIPTIONS[lang],
      inLanguage: [...LANGUAGES],
      publisher: person,
    },
    {
      '@type': 'WebPage',
      '@id': `${page}#webpage`,
      url: page,
      name: TITLES[lang],
      description: DESCRIPTIONS[lang],
      isPartOf: { '@id': id('website') },
      mainEntity: { '@id': id('app') },
      primaryImageOfPage: { '@id': `${page}#image` },
      inLanguage: lang,
    },
    {
      '@type': 'WebApplication',
      '@id': id('app'),
      name: NAME,
      url: pageUrl(url, 'app'),
      description: DESCRIPTIONS[lang],
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      featureList: [...FEATURES],
      inLanguage: [...LANGUAGES],
      image: { '@id': `${page}#image` },
      author: person,
    },
    {
      '@type': 'ImageObject',
      '@id': `${page}#image`,
      url: abs(url, image.path),
      contentUrl: abs(url, image.path),
      width: image.width,
      height: image.height,
      caption: image.alt,
      inLanguage: lang,
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': id('source'),
      name: `${NAME} source code`,
      codeRepository: REPOSITORY,
      programmingLanguage: 'TypeScript',
      license: LICENSE_URL,
      author: person,
      targetProduct: { '@id': id('app') },
    },
    {
      '@type': 'Person',
      '@id': AUTHOR.id,
      name: AUTHOR.name,
      url: AUTHOR.url,
      sameAs: [...AUTHOR.sameAs],
    },
  ];
}

/** JSON-LD safe inside <script>: no "</script>" or "<!--" can come out of it. */
export const jsonLd = (url: string, lang: SiteLang = 'en'): string =>
  JSON.stringify({ '@context': 'https://schema.org', '@graph': graph(url, lang) }).replace(/</g, '\\u003c');

/**
 * Every tag describing a page, in the order they appear in <head> (replaces <!-- seo:head -->). Home pages get
 * hreflang links to each other (x-default: English) and the JSON-LD graph; the app gets `noindex`.
 */
export function headTags(url: string, page: PageKey = 'home'): string[] {
  const { lang } = PAGES[page];
  const canonical = pageUrl(url, page);
  const card = OG_IMAGES[lang];
  const image = abs(url, card.path);
  const root = rootFrom(page);
  const home = isHome(page);
  return [
    `<title>${esc(TITLES[lang])}</title>`,
    meta('name', 'description', DESCRIPTIONS[lang]),
    link({ rel: 'canonical', href: canonical }),
    ...(home
      ? [
          ...LANGUAGES.map((l) => link({ rel: 'alternate', hreflang: l, href: pageUrl(url, HOMES[l]) })),
          link({ rel: 'alternate', hreflang: 'x-default', href: pageUrl(url, HOMES.en) }),
        ]
      : []),
    meta('name', 'robots', home ? ROBOTS : ROBOTS_APP),
    meta('name', 'author', AUTHOR.name),
    meta('name', 'application-name', NAME),
    meta('name', 'apple-mobile-web-app-title', NAME),
    ...(VERIFICATION.google ? [meta('name', 'google-site-verification', VERIFICATION.google)] : []),
    ...(VERIFICATION.bing ? [meta('name', 'msvalidate.01', VERIFICATION.bing)] : []),
    // Icons: .ico for the probes that ignore the head, SVG for current browsers, PNG multiples of 48 for Google.
    link({ rel: 'icon', href: `${root}${ICONS.ico}`, sizes: '48x48' }),
    link({ rel: 'icon', href: `${root}${ICONS.svg}`, type: 'image/svg+xml', sizes: 'any' }),
    ...ICONS.png
      .filter((size) => size % 48 === 0)
      .map((size) =>
        link({ rel: 'icon', href: `${root}${pngIcon(size)}`, type: 'image/png', sizes: `${size}x${size}` }),
      ),
    link({ rel: 'apple-touch-icon', href: `${root}${ICONS.apple}` }),
    link({ rel: 'manifest', href: `${root}manifest.webmanifest` }),
    link({ rel: 'sitemap', type: 'application/xml', href: `${root}sitemap.xml` }),
    link({ rel: 'alternate', type: 'text/markdown', href: `${root}llms.txt`, title: `${NAME} in Markdown` }),
    // Open Graph
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', NAME),
    meta('property', 'og:title', TITLES[lang]),
    meta('property', 'og:description', DESCRIPTIONS[lang]),
    meta('property', 'og:url', canonical),
    meta('property', 'og:locale', LOCALES[lang]),
    ...LANGUAGES.filter((l) => l !== lang).map((l) => meta('property', 'og:locale:alternate', LOCALES[l])),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', card.type),
    meta('property', 'og:image:width', String(card.width)),
    meta('property', 'og:image:height', String(card.height)),
    meta('property', 'og:image:alt', card.alt),
    // X
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:creator', AUTHOR.twitter),
    meta('name', 'twitter:title', TITLES[lang]),
    meta('name', 'twitter:description', DESCRIPTIONS[lang]),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', card.alt),
    ...(home ? [`<script type="application/ld+json">${jsonLd(url, lang)}</script>`] : []),
  ];
}

/**
 * The page text in static HTML (at <!-- seo:about -->, inside <main>): what a crawler that doesn't run
 * JavaScript reads, with the page's only h1. The app hides it before the first paint and replaces it with the
 * gallery, which shows the same section in the visitor's language (src/app/about.ts). `publish`: the build
 * has the published boards API (Worker build).
 */
export function aboutStatic(publish: boolean): string {
  return aboutHTML((key) => String(en[key]), { h1: true, publish });
}

/** What a browser without JavaScript gets on top of the page text. No heading: the page text has the h1. */
export function noscriptHtml(): string {
  return `<noscript><p class="noscript">${esc(NAME)} runs in your browser: turn on JavaScript to start ranking.</p></noscript>`;
}

/**
 * Web app manifest. The installed app opens the app (app/), not the home page. `minimal-ui` rather than `standalone`: rankings live in localStorage, and iOS gives a
 * standalone home-screen app its own storage, so a ranking made in Safari would vanish once installed.
 * Browsers without minimal-ui (iOS) open the site in the browser; Android gets a window with a back button.
 * Colors are the light palette: the manifest is read once at install and cannot follow the theme.
 */
export function manifest(): Record<string, unknown> {
  return {
    name: NAME,
    short_name: NAME,
    description: DESCRIPTION,
    lang: 'en',
    dir: 'ltr',
    // The id stays the site's root, as before the app moved to app/: installed copies keep their identity.
    id: './',
    start_url: './app/',
    scope: './',
    display: 'minimal-ui',
    orientation: 'any',
    background_color: COLORS.bg,
    theme_color: COLORS.bg,
    categories: ['productivity', 'utilities'],
    icons: [
      { src: `./${ICONS.svg}`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ...ICONS.png.map((size) => ({
        src: `./${pngIcon(size)}`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'any',
      })),
      // Its own file, not "any maskable": launchers crop to a circle, so the mark sits inside the safe zone.
      { src: `./${ICONS.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/**
 * robots.txt. AI crawlers are allowed, training and answer engines alike, as on steevepommier.com: llms.txt
 * exists to be read. Only the published boards API is off limits. Crawlers read robots.txt at the root of a
 * host only, so this one counts on the Worker's domain, not under github.io/versus/.
 */
export function robotsTxt(url: string): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${abs(url, 'sitemap.xml')}`, ''].join('\n');
}

/**
 * The home page of each language, in the plain sitemap format. Their hreflang pairs are in each page's head,
 * which Google reads as well as a sitemap's: `xhtml:link` alternates here would make browsers render the file
 * as a (nearly blank) page instead of showing the XML, for no gain. The app is left out: it is `noindex`, and
 * its rankings and boards live in the URL fragment, which crawlers ignore.
 */
export function sitemapXml(url: string, lastmod: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...LANGUAGES.map((l) => `  <url><loc>${esc(pageUrl(url, HOMES[l]))}</loc><lastmod>${esc(lastmod)}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/** llms.txt (https://llmstxt.org): the whole app in plain Markdown for language models and answer engines. */
export function llmsTxt(url: string): string {
  return [
    `# ${NAME}`,
    '',
    `> ${DESCRIPTION}`,
    '',
    `${NAME} is a free web app that ranks a list of anything (places, photos, products, colors, names) by showing two items at a time and asking which one wins. Each answer is a duel; a scoring method turns the duels into a ranking with a measure of how settled it is. It runs in the browser: rankings are stored on the device, with no account.`,
    '',
    '## Features',
    '',
    ...FEATURES.map((f) => `- ${f}`),
    '',
    '## Scoring methods',
    '',
    'Every method is recomputed from the same duel history, so switching loses nothing.',
    '',
    ...METHODS.map((m) => `- **${m.name}**: ${m.how}`),
    '',
    '## Links',
    '',
    `- [${NAME}](${url}): home page, in English`,
    `- [${NAME} en français](${pageUrl(url, HOMES.fr)}): home page, in French`,
    `- [The app](${pageUrl(url, 'app')}): start ranking (English or French)`,
    `- [Source code](${REPOSITORY}): TypeScript, MIT license`,
    `- [${AUTHOR.name}](${AUTHOR.url}): author`,
    '',
  ].join('\n');
}

/**
 * Cloudflare static assets headers (Worker build only; GitHub Pages ignores the file). Charset stated for the
 * HTML, which the platform omits otherwise; hashed bundles cached for a year; HSTS without preload, which is
 * a separate, hard-to-undo decision.
 */
export function headersFile(): string {
  return [
    '/*',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '',
    ...Object.values(PAGES)
      .flatMap((p) => [`/${p.path}`, `/${p.file}`])
      .flatMap((path) => [path, '  Content-Type: text/html; charset=utf-8', '']),
    // The meta tag says the same; the header also covers anything else under app/.
    '/app/*',
    '  X-Robots-Tag: noindex',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/sitemap.xml',
    '  Content-Type: application/xml; charset=utf-8',
    '',
    '/manifest.webmanifest',
    '  Content-Type: application/manifest+json; charset=utf-8',
    '',
    '/llms.txt',
    '  Content-Type: text/markdown; charset=utf-8',
    '',
  ].join('\n');
}

export interface GeneratedFile {
  body: string;
  type: string;
}

/** Files the build writes next to index.html (and the dev server answers). */
export function generatedFiles(url: string, opts: { lastmod: string; worker: boolean }): Record<string, GeneratedFile> {
  return {
    'manifest.webmanifest': {
      body: `${JSON.stringify(manifest(), null, 2)}\n`,
      type: 'application/manifest+json; charset=utf-8',
    },
    'robots.txt': { body: robotsTxt(url), type: 'text/plain; charset=utf-8' },
    'sitemap.xml': { body: sitemapXml(url, opts.lastmod), type: 'application/xml; charset=utf-8' },
    'llms.txt': { body: llmsTxt(url), type: 'text/markdown; charset=utf-8' },
    ...(opts.worker ? { _headers: { body: headersFile(), type: 'text/plain; charset=utf-8' } } : {}),
  };
}
