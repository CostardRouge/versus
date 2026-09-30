import { aboutHTML } from '../src/app/about.ts';
import { en } from '../src/i18n/en.ts';
import {
  ALTERNATE_LOCALES,
  AUTHOR,
  COLORS,
  DEFAULT_SITE_URL,
  DESCRIPTION,
  FEATURES,
  ICONS,
  LANGUAGES,
  LICENSE_URL,
  LOCALE,
  METHODS,
  NAME,
  OG_IMAGE,
  pngIcon,
  REPOSITORY,
  TITLE,
  VERIFICATION,
} from './site.ts';

/**
 * Build-time SEO: the head tags, the JSON-LD graph and the generated files (manifest, robots.txt, sitemap,
 * llms.txt, Cloudflare headers), all derived from build/site.ts. Pure functions of the site URL, so the
 * Vite plugin (build/seo-plugin.ts) and the tests call the same code.
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

/** Max snippet and a large image preview in results; the rest states the default posture explicitly. */
export const ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

const meta = (attr: 'name' | 'property', key: string, content: string): string =>
  `<meta ${attr}="${key}" content="${esc(content)}" />`;
const link = (attrs: Record<string, string>): string =>
  `<link ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ')} />`;

/** One schema.org @graph for the page, nodes referenced by stable @id rather than repeated. */
export function graph(url: string): Record<string, unknown>[] {
  const id = (fragment: string) => `${url}#${fragment}`;
  const person = { '@id': AUTHOR.id };
  return [
    {
      '@type': 'WebSite',
      '@id': id('website'),
      url,
      name: NAME,
      description: DESCRIPTION,
      inLanguage: [...LANGUAGES],
      publisher: person,
    },
    {
      '@type': 'WebPage',
      '@id': id('webpage'),
      url,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { '@id': id('website') },
      mainEntity: { '@id': id('app') },
      primaryImageOfPage: { '@id': id('image') },
      inLanguage: 'en',
    },
    {
      '@type': 'WebApplication',
      '@id': id('app'),
      name: NAME,
      url,
      description: DESCRIPTION,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      featureList: [...FEATURES],
      inLanguage: [...LANGUAGES],
      image: { '@id': id('image') },
      author: person,
    },
    {
      '@type': 'ImageObject',
      '@id': id('image'),
      url: abs(url, OG_IMAGE.path),
      contentUrl: abs(url, OG_IMAGE.path),
      width: OG_IMAGE.width,
      height: OG_IMAGE.height,
      caption: OG_IMAGE.alt,
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
export const jsonLd = (url: string): string =>
  JSON.stringify({ '@context': 'https://schema.org', '@graph': graph(url) }).replace(/</g, '\\u003c');

/** Every tag describing the page, in the order they appear in <head> (replaces <!-- seo:head --> in index.html). */
export function headTags(url: string): string[] {
  const image = abs(url, OG_IMAGE.path);
  return [
    `<title>${esc(TITLE)}</title>`,
    meta('name', 'description', DESCRIPTION),
    link({ rel: 'canonical', href: url }),
    meta('name', 'robots', ROBOTS),
    meta('name', 'author', AUTHOR.name),
    meta('name', 'application-name', NAME),
    meta('name', 'apple-mobile-web-app-title', NAME),
    ...(VERIFICATION.google ? [meta('name', 'google-site-verification', VERIFICATION.google)] : []),
    ...(VERIFICATION.bing ? [meta('name', 'msvalidate.01', VERIFICATION.bing)] : []),
    // Icons: .ico for the probes that ignore the head, SVG for current browsers, PNG multiples of 48 for Google.
    link({ rel: 'icon', href: `./${ICONS.ico}`, sizes: '48x48' }),
    link({ rel: 'icon', href: `./${ICONS.svg}`, type: 'image/svg+xml', sizes: 'any' }),
    ...ICONS.png
      .filter((size) => size % 48 === 0)
      .map((size) => link({ rel: 'icon', href: `./${pngIcon(size)}`, type: 'image/png', sizes: `${size}x${size}` })),
    link({ rel: 'apple-touch-icon', href: `./${ICONS.apple}` }),
    link({ rel: 'manifest', href: './manifest.webmanifest' }),
    link({ rel: 'sitemap', type: 'application/xml', href: './sitemap.xml' }),
    link({ rel: 'alternate', type: 'text/markdown', href: './llms.txt', title: `${NAME} in Markdown` }),
    // Open Graph
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', NAME),
    meta('property', 'og:title', TITLE),
    meta('property', 'og:description', DESCRIPTION),
    meta('property', 'og:url', url),
    meta('property', 'og:locale', LOCALE),
    ...ALTERNATE_LOCALES.map((l) => meta('property', 'og:locale:alternate', l)),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', OG_IMAGE.type),
    meta('property', 'og:image:width', String(OG_IMAGE.width)),
    meta('property', 'og:image:height', String(OG_IMAGE.height)),
    meta('property', 'og:image:alt', OG_IMAGE.alt),
    // X
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:creator', AUTHOR.twitter),
    meta('name', 'twitter:title', TITLE),
    meta('name', 'twitter:description', DESCRIPTION),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', OG_IMAGE.alt),
    `<script type="application/ld+json">${jsonLd(url)}</script>`,
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
 * Web app manifest. `minimal-ui` rather than `standalone`: rankings live in localStorage, and iOS gives a
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
    id: './',
    start_url: './',
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

/** One URL: the app is a single page (rankings and boards live in the URL fragment, which crawlers ignore). */
export function sitemapXml(url: string, lastmod: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${esc(url)}</loc><lastmod>${esc(lastmod)}</lastmod></url>`,
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
    `- [${NAME}](${url}): the app`,
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
    '/',
    '  Content-Type: text/html; charset=utf-8',
    '',
    '/index.html',
    '  Content-Type: text/html; charset=utf-8',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
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
