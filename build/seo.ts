import { createHash } from 'node:crypto';
import { aboutHTML } from '../src/app/about.ts';
import { en } from '../src/i18n/en.ts';
import {
  ADMIN_DESCRIPTION,
  ADMIN_TITLE,
  AUTHOR,
  COLORS,
  DEFAULT_SITE_URL,
  DESCRIPTION,
  DESCRIPTIONS,
  FEATURES,
  HOMES,
  ICONS,
  type IndexedKind,
  LANGUAGES,
  LEGAL_DESCRIPTIONS,
  LEGAL_TITLES,
  LEGALS,
  LICENSE_URL,
  LOCALES,
  METHODS,
  NAME,
  OG_IMAGES,
  PAGES,
  type PageKey,
  type PageKind,
  pngIcon,
  REPOSITORY,
  type SiteLang,
  TITLES,
  VERIFICATION,
  VERSIONS,
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

/**
 * The site's path on its host (`VITE_BASE_PATH`): `/` on the Worker and in development, `/versus/` for the
 * GitHub Pages copy (CI passes the repository's name). The app's page names its folder with it in a <base>,
 * so its views can be deep paths (D92). Normalized to leading and trailing slashes; anything odd gives `/`.
 */
export function sitePath(raw?: string): string {
  const value = raw?.trim() ?? '';
  const valid = /^\/?[\w.~-]+(\/[\w.~-]+)*\/?$/.test(value) && !value.split('/').some((seg) => /^\.+$/.test(seg));
  if (!valid) return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

/** index.html is served at the site URL itself, so its canonical form is the URL with its trailing slash. */
const abs = (url: string, path: string): string => new URL(path, url).href;

/** A page's canonical address: the site URL plus its folder (index.html files are served at their folder). */
export const pageUrl = (url: string, page: PageKey): string => abs(url, PAGES[page].path);

/** From a page back to the site's root, for relative links that work under any base (github.io/versus/). */
export const rootFrom = (page: PageKey): string =>
  '../'.repeat(PAGES[page].path.split('/').filter(Boolean).length) || './';

/** A page's title and description: the home page's for the language, the legal notice's, or the admin page's. */
const titleOf = (page: PageKey): string => {
  const { kind, lang } = PAGES[page];
  return kind === 'legal' ? LEGAL_TITLES[lang] : kind === 'admin' ? ADMIN_TITLE : TITLES[lang];
};
const descriptionOf = (page: PageKey): string => {
  const { kind, lang } = PAGES[page];
  return kind === 'legal' ? LEGAL_DESCRIPTIONS[lang] : kind === 'admin' ? ADMIN_DESCRIPTION : DESCRIPTIONS[lang];
};

const indexed = (kind: PageKind): kind is IndexedKind => kind === 'home' || kind === 'legal';

/** Max snippet and a large image preview in results; the rest states the default posture explicitly. */
const ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
/**
 * The app itself stays out of the index: it renders with JavaScript, switches language on one URL and would
 * compete with the home pages, which carry the text. `follow` keeps its links counting.
 */
export const ROBOTS_APP = 'noindex, follow';
/** The admin page: nothing to index, nothing to follow. */
export const ROBOTS_ADMIN = 'noindex, nofollow';

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
    websiteNode(url, lang),
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
    personNode(),
  ];
}

function websiteNode(url: string, lang: SiteLang): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${url}#website`,
    url,
    name: NAME,
    description: DESCRIPTIONS[lang],
    inLanguage: [...LANGUAGES],
    publisher: { '@id': AUTHOR.id },
  };
}

function personNode(): Record<string, unknown> {
  return { '@type': 'Person', '@id': AUTHOR.id, name: AUTHOR.name, url: AUTHOR.url, sameAs: [...AUTHOR.sameAs] };
}

/** The legal notice's graph: the page, part of the site, about its publisher. */
export function legalGraph(url: string, lang: SiteLang = 'en'): Record<string, unknown>[] {
  const page = pageUrl(url, LEGALS[lang]);
  return [
    websiteNode(url, lang),
    {
      '@type': 'WebPage',
      '@id': `${page}#webpage`,
      url: page,
      name: LEGAL_TITLES[lang],
      description: LEGAL_DESCRIPTIONS[lang],
      isPartOf: { '@id': `${url}#website` },
      about: { '@id': AUTHOR.id },
      inLanguage: lang,
    },
    personNode(),
  ];
}

/** JSON-LD safe inside <script>: no "</script>" or "<!--" can come out of it. */
export const jsonLd = (url: string, lang: SiteLang = 'en', nodes = graph(url, lang)): string =>
  JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');

/**
 * Every tag describing a page, in the order they appear in <head> (replaces <!-- seo:head -->). Home and legal
 * pages get hreflang links to their other language (x-default: English) and a JSON-LD graph; the app gets `noindex`.
 */
export function headTags(url: string, page: PageKey = 'home'): string[] {
  const { lang, kind } = PAGES[page];
  const canonical = pageUrl(url, page);
  const card = OG_IMAGES[lang];
  const image = abs(url, card.path);
  const root = rootFrom(page);
  const title = titleOf(page);
  const description = descriptionOf(page);
  const versions = indexed(kind) ? VERSIONS[kind] : null;
  return [
    `<title>${esc(title)}</title>`,
    meta('name', 'description', description),
    link({ rel: 'canonical', href: canonical }),
    ...(versions
      ? [
          ...LANGUAGES.map((l) => link({ rel: 'alternate', hreflang: l, href: pageUrl(url, versions[l]) })),
          link({ rel: 'alternate', hreflang: 'x-default', href: pageUrl(url, versions.en) }),
        ]
      : []),
    meta('name', 'robots', versions ? ROBOTS : kind === 'admin' ? ROBOTS_ADMIN : ROBOTS_APP),
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
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
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
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', card.alt),
    ...(versions
      ? [
          `<script type="application/ld+json">${jsonLd(url, lang, kind === 'legal' ? legalGraph(url, lang) : graph(url, lang))}</script>`,
        ]
      : []),
  ];
}

/**
 * The page text in static HTML (at <!-- seo:about -->, inside <main>): what a crawler that doesn't run
 * JavaScript reads, with the page's only h1. The app hides it before the first paint and replaces it with the
 * gallery, which shows the same section in the visitor's language (src/app/about.ts). `publish`: the build
 * has the published boards API (Worker build).
 */
export function aboutStatic(publish: boolean): string {
  return aboutHTML((key) => String(en[key]), { h1: true, publish, lang: 'en' });
}

/** What a browser without JavaScript gets on top of the page text. No heading: the page text has the h1. */
export function noscriptHtml(): string {
  return `<noscript><p class="noscript">${esc(NAME)} runs in your browser: turn on JavaScript to start ranking.</p></noscript>`;
}

/**
 * Web app manifest. The installed app opens the app (app/), not the home page, in a window of its own
 * (`standalone`). On iOS that window keeps its own storage, apart from Safari's: rankings move in with an
 * export and an import (src/core/backup.ts), and the empty app says how (D98). It was `minimal-ui` until then
 * (D69), which iOS doesn't have: the icon opened Safari.
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
    display: 'standalone',
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
 * exists to be read. Only the published boards API and the admin page are off limits. Crawlers read robots.txt
 * at the root of a host only, so this one counts on the Worker's domain, not under github.io/versus/.
 */
function robotsTxt(url: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    `Disallow: /${PAGES.admin.path}`,
    '',
    `Sitemap: ${abs(url, 'sitemap.xml')}`,
    '',
  ].join('\n');
}

/**
 * The home page and the legal notice of each language, in the plain sitemap format. Their hreflang pairs are in
 * each page's head, which Google reads as well as a sitemap's: `xhtml:link` alternates here would make browsers
 * render the file as a (nearly blank) page instead of showing the XML, for no gain. The app is left out: it is
 * `noindex`, and its views are this browser's rankings or boards shared by link.
 */
function sitemapXml(url: string, lastmod: string): string {
  const pages = [...LANGUAGES.map((l) => HOMES[l]), ...LANGUAGES.map((l) => LEGALS[l])];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map((p) => `  <url><loc>${esc(pageUrl(url, p))}</loc><lastmod>${esc(lastmod)}</lastmod></url>`),
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
    `- [Legal notice and privacy](${pageUrl(url, LEGALS.en)}): publisher, hosting, what is stored and counted`,
    `- [${AUTHOR.name}](${AUTHOR.url}): author`,
    '',
  ].join('\n');
}

/** The scripts a page runs from its own HTML (JSON data aside), as the hashes a content security policy allows. */
export function scriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] ?? '';
    if (/\bsrc=/.test(attrs) || /type="application\/(?:ld\+)?json"/.test(attrs)) continue;
    out.push(
      `'sha256-${createHash('sha256')
        .update(m[2] ?? '')
        .digest('base64')}'`,
    );
  }
  return out;
}

/** Where the policy's violations are sent (the Worker logs them). */
export const CSP_REPORT_PATH = '/api/csp-report';

/**
 * The content security policy of every page: scripts from this site (the inline ones by hash), the measurement
 * tracker and Turnstile; pictures, fonts and data from this site, data: and blob: URLs (images kept as data URLs,
 * shared cards); no plugin, no framing. Inline style attributes stay allowed: the views set colors with them.
 */
export function contentPolicy(opts: {
  scripts: readonly string[];
  analytics: string | null;
  api: string | null;
}): string {
  const turnstile = 'https://challenges.cloudflare.com';
  const tracker = opts.analytics ? new URL(opts.analytics).origin : null;
  const api = opts.api && /^https?:\/\//.test(opts.api) ? new URL(opts.api).origin : null;
  const list = (...xs: (string | null)[]) => xs.filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src ${list("'self'", ...[...new Set(opts.scripts)].sort(), tracker, turnstile)}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${list("'self'", tracker, api)}`,
    `frame-src ${turnstile}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ');
}

/**
 * Cloudflare static assets headers (Worker build only; GitHub Pages ignores the file). Charset stated for the
 * HTML, which the platform omits otherwise; hashed bundles cached for a year; HSTS without preload, which is
 * a separate, hard-to-undo decision. The content security policy is first reported only (`policy`, filled in
 * once the pages are built: their inline scripts' hashes), to be enforced once its reports are clean.
 */
export function headersFile(policy?: string): string {
  return [
    '/*',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    ...(policy ? [`  Content-Security-Policy-Report-Only: ${policy}`] : []),
    '',
    ...[...Object.values(PAGES).flatMap((p) => [`/${p.path}`, `/${p.file}`]), '/404', '/404.html'].flatMap((path) => [
      path,
      '  Content-Type: text/html; charset=utf-8',
      '',
    ]),
    // The meta tag says the same; the header also covers anything else under app/ and admin/.
    '/app/*',
    '  X-Robots-Tag: noindex',
    '',
    `/${PAGES.admin.path}*`,
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

/**
 * The 404 page. The Worker serves it for unknown addresses; GitHub Pages serves it for every address that
 * isn't a file, app views included: for those it keeps the path in sessionStorage and opens the app's folder,
 * which reads it back (`versus-path`, src/app/router.ts). Not indexed.
 */
export function notFoundHtml(url: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Page not found · ${esc(NAME)}</title>
    <script>
      (function () {
        var p = location.pathname;
        var i = p.indexOf('/app/');
        // Not under an app folder, or already at a folder that doesn't exist (/fr/app/): the 404 page, no loop.
        if (i < 0 || p.length === i + 5) return;
        try {
          sessionStorage.setItem('versus-path', p.slice(i + 5) + location.search + location.hash);
        } catch (e) {
          return;
        }
        location.replace(p.slice(0, i + 5));
      })();
    </script>
    <style>
      :root { color-scheme: light dark; --bg: ${COLORS.bg}; --ink: ${COLORS.ink}; --muted: ${COLORS.muted}; }
      @media (prefers-color-scheme: dark) { :root { --bg: ${COLORS.bgDark}; --ink: #eceef3; --muted: #9298a8; } }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
        font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; box-sizing: border-box; }
      main { max-width: 34rem; }
      .mark { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; margin: 0;
        background: linear-gradient(90deg, ${COLORS.a} 50%, ${COLORS.b} 50%); color: #fff; font-weight: 800; }
      h1 { font-size: 2rem; letter-spacing: -0.02em; margin: 18px 0 4px; }
      p { margin: 0 0 12px; color: var(--muted); }
      a { color: var(--ink); font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <p class="mark" aria-hidden="true">vs</p>
      <h1>Page not found</h1>
      <p lang="fr">Page introuvable.</p>
      <p><a href="${esc(url)}">${esc(NAME)}</a> · <a href="${esc(pageUrl(url, HOMES.fr))}" lang="fr">${esc(NAME)} en français</a> · <a href="${esc(pageUrl(url, 'app'))}">Open the app</a></p>
    </main>
  </body>
</html>
`;
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
    '404.html': { body: notFoundHtml(url), type: 'text/html; charset=utf-8' },
    ...(opts.worker ? { _headers: { body: headersFile(), type: 'text/plain; charset=utf-8' } } : {}),
  };
}
