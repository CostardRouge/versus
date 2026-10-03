import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aboutStatic,
  CSP_REPORT_PATH,
  contentPolicy,
  generatedFiles,
  graph,
  headersFile,
  headTags,
  jsonLd,
  legalGraph,
  llmsTxt,
  manifest,
  noscriptHtml,
  notFoundHtml,
  pageUrl,
  ROBOTS_ADMIN,
  ROBOTS_APP,
  rootFrom,
  scriptHashes,
  sitePath,
  siteUrl,
} from '../build/seo';
import { preloadFonts } from '../build/seo-plugin';
import {
  ADMIN_TITLE,
  COLORS,
  DEFAULT_SITE_URL,
  DESCRIPTION,
  DESCRIPTIONS,
  HOMES,
  ICONS,
  LANGUAGES,
  LEGAL_DESCRIPTIONS,
  LEGAL_TITLES,
  METHODS,
  NAME,
  OG_IMAGE,
  OG_IMAGES,
  PAGES,
  type PageKey,
  pngIcon,
  TITLE,
  TITLES,
} from '../build/site';
import { aboutHTML } from '../src/app/about';
import { STASH_KEY } from '../src/app/router';
import { HOME_PATH } from '../src/core/site';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { PREFS_KEY } from '../src/prefs';

const URL_ = 'https://versus.example.com/';
const head = headTags(URL_).join('\n');
const files = generatedFiles(URL_, { lastmod: '2026-09-30', worker: false });
const publicFile = (name: string) => resolve(process.cwd(), 'public', name);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
const pngFile = (name: string) => pngSize(readFileSync(publicFile(name)));

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const metaContent = (key: string) =>
  attr(head.split('\n').find((tag) => tag.includes(`"${key}"`)) ?? '', 'content')?.replace(/&amp;/g, '&');

describe('siteUrl', () => {
  it('falls back to the default address', () => {
    expect(siteUrl()).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('  ')).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('not a url')).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('ftp://example.com/')).toBe(DEFAULT_SITE_URL);
  });

  it('normalizes to a trailing slash, without query or fragment', () => {
    expect(siteUrl('https://versus.example.com')).toBe('https://versus.example.com/');
    expect(siteUrl('https://example.com/versus?x=1#top')).toBe('https://example.com/versus/');
    expect(siteUrl(DEFAULT_SITE_URL)).toBe(DEFAULT_SITE_URL);
  });
});

describe('sitePath', () => {
  it('is the root unless a path is given, with slashes on both ends', () => {
    expect(sitePath()).toBe('/');
    expect(sitePath('')).toBe('/');
    expect(sitePath('/')).toBe('/');
    expect(sitePath('versus')).toBe('/versus/');
    expect(sitePath('/versus/')).toBe('/versus/');
    expect(sitePath('/a/b')).toBe('/a/b/');
    expect(sitePath('https://x.example/')).toBe('/');
    expect(sitePath('/../x')).toBe('/');
  });
});

describe('head', () => {
  it('keeps the titles and descriptions within what results display, in both languages', () => {
    for (const lang of LANGUAGES) {
      expect(TITLES[lang].length, lang).toBeGreaterThanOrEqual(50);
      expect(TITLES[lang].length, lang).toBeLessThanOrEqual(60);
      expect(DESCRIPTIONS[lang].length, lang).toBeGreaterThanOrEqual(70);
      expect(DESCRIPTIONS[lang].length, lang).toBeLessThanOrEqual(155);
    }
    expect(TITLES.fr).toBe(fr.pageTitle);
    expect(DESCRIPTION).toBe(DESCRIPTIONS.en);
    expect(head).toContain(`<title>${TITLE}</title>`);
  });

  it('agrees on one address: canonical, og:url and the JSON-LD ids', () => {
    expect(head).toContain(`<link rel="canonical" href="${URL_}" />`);
    expect(metaContent('og:url')).toBe(URL_);
    const ids = graph(URL_).map((node) => String(node['@id']));
    expect(ids).toContain(`${URL_}#webpage`);
    for (const id of ids.filter((i) => !i.includes('steevepommier.com'))) expect(id.startsWith(`${URL_}#`)).toBe(true);
  });

  it('points og:image and twitter:image at the card, with its real size', () => {
    const image = `${URL_}${OG_IMAGE.path}`;
    expect(metaContent('og:image')).toBe(image);
    expect(metaContent('twitter:image')).toBe(image);
    expect(metaContent('twitter:card')).toBe('summary_large_image');
    expect(pngFile(OG_IMAGE.path)).toEqual([OG_IMAGE.width, OG_IMAGE.height]);
    expect(metaContent('og:image:width')).toBe(String(OG_IMAGE.width));
    expect(metaContent('og:image:alt')).toBeTruthy();
  });

  it('only links files that exist in public/ or are generated, from every page', () => {
    for (const page of Object.keys(PAGES) as PageKey[]) {
      const tags = headTags(URL_, page).join('\n');
      const hrefs = [...tags.matchAll(/href="(\.\.?\/)+([^"]+)"/g)].map((m) => m[0]);
      expect(hrefs.length).toBeGreaterThan(5);
      for (const [, prefix, file] of tags.matchAll(/href="((?:\.\.?\/)+)([^"]+)"/g)) {
        expect(prefix, page).toBe(rootFrom(page));
        expect(existsSync(publicFile(file ?? '')) || (file ?? '') in files, file).toBe(true);
      }
    }
  });

  it('declares raster favicons in multiples of 48 px only (what Google accepts)', () => {
    const sizes = [...head.matchAll(/rel="icon"[^>]*sizes="(\d+)x\d+"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(1);
    for (const size of sizes) expect(size % 48).toBe(0);
  });

  it('escapes the JSON-LD for a <script> element', () => {
    expect(jsonLd(URL_)).not.toContain('<');
    expect(JSON.parse(jsonLd(URL_))['@graph']).toHaveLength(graph(URL_).length);
  });

  it('resolves every @id reference in the graph to a node of the graph', () => {
    const nodes = graph(URL_);
    const ids = new Set(nodes.map((n) => n['@id']));
    const refs: string[] = [];
    const walk = (v: unknown, top: boolean): void => {
      if (Array.isArray(v)) for (const x of v) walk(x, false);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (!top && typeof o['@id'] === 'string') refs.push(o['@id']);
        for (const [k, x] of Object.entries(o)) if (k !== '@id') walk(x, false);
      }
    };
    for (const node of nodes) walk(node, true);
    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) expect(ids.has(ref), ref).toBe(true);
  });

  it('keeps the <noscript> line free of headings (the page text has the h1)', () => {
    const html = noscriptHtml();
    expect(html).toMatch(/^<noscript>[\s\S]*<\/noscript>$/);
    expect(html).not.toMatch(/<h\d/);
  });
});

describe('pages', () => {
  const tags = (page: PageKey) => headTags(URL_, page).join('\n');

  it('gives each page its own address and a way back to the root', () => {
    expect(pageUrl(URL_, 'home')).toBe(URL_);
    expect(pageUrl(URL_, 'homeFr')).toBe(`${URL_}fr/`);
    expect(pageUrl(URL_, 'app')).toBe(`${URL_}app/`);
    expect(rootFrom('home')).toBe('./');
    expect(rootFrom('homeFr')).toBe('../');
    expect(rootFrom('app')).toBe('../');
  });

  it('links the two home pages to each other with hreflang, English by default', () => {
    for (const page of ['home', 'homeFr'] as const) {
      const html = tags(page);
      expect(html).toContain(`<link rel="canonical" href="${pageUrl(URL_, page)}" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="${URL_}" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="fr" href="${URL_}fr/" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${URL_}" />`);
    }
  });

  it('describes the French home page in French, with its own card', () => {
    const html = tags('homeFr');
    expect(html).toContain(`<title>${TITLES.fr}</title>`);
    expect(html).toContain('<meta property="og:locale" content="fr_FR" />');
    expect(html).toContain('<meta property="og:locale:alternate" content="en_US" />');
    expect(html).toContain(`<meta property="og:image" content="${URL_}${OG_IMAGES.fr.path}" />`);
    expect(html).toContain(`<meta property="og:url" content="${URL_}fr/" />`);
    expect(pngFile(OG_IMAGES.fr.path)).toEqual([OG_IMAGES.fr.width, OG_IMAGES.fr.height]);
  });

  it('keeps the app out of the index, without hreflang or JSON-LD', () => {
    const html = tags('app');
    expect(html).toContain(`<meta name="robots" content="${ROBOTS_APP}" />`);
    expect(html).toContain(`<link rel="canonical" href="${URL_}app/" />`);
    expect(html).not.toContain('hreflang');
    expect(html).not.toContain('application/ld+json');
  });

  it('keeps the admin page out of the index entirely', () => {
    const html = tags('admin');
    expect(html).toContain(`<meta name="robots" content="${ROBOTS_ADMIN}" />`);
    expect(html).toContain(`<title>${ADMIN_TITLE}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${URL_}admin/" />`);
    expect(html).not.toContain('hreflang');
    expect(html).not.toContain('application/ld+json');
    expect(rootFrom('admin')).toBe('../');
  });

  it('links the two legal pages to each other, each titled and described in its language', () => {
    for (const lang of LANGUAGES) {
      expect(LEGAL_TITLES[lang].length, lang).toBeLessThanOrEqual(60);
      expect(LEGAL_DESCRIPTIONS[lang].length, lang).toBeGreaterThanOrEqual(70);
      expect(LEGAL_DESCRIPTIONS[lang].length, lang).toBeLessThanOrEqual(155);
    }
    for (const page of ['legal', 'legalFr'] as const) {
      const html = tags(page);
      const { lang } = PAGES[page];
      expect(html).toContain(`<title>${LEGAL_TITLES[lang]}</title>`);
      expect(html).toContain(`<link rel="canonical" href="${pageUrl(URL_, page)}" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="${URL_}legal/" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="fr" href="${URL_}fr/mentions-legales/" />`);
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${URL_}legal/" />`);
      expect(html).not.toContain('noindex');
      expect(html).toContain(`"@id":"${pageUrl(URL_, page)}#webpage"`);
    }
    expect(rootFrom('legalFr')).toBe('../../');
  });

  it('resolves every reference of the legal graph', () => {
    for (const lang of LANGUAGES) {
      const nodes = legalGraph(URL_, lang);
      const ids = new Set(nodes.map((n) => n['@id']));
      const page = nodes.find((n) => n['@type'] === 'WebPage') as Record<string, { '@id': string }>;
      expect(ids.has(page.isPartOf?.['@id'])).toBe(true);
      expect(ids.has(page.about?.['@id'])).toBe(true);
    }
  });

  it('resolves the French graph: page ids of its own, entity ids shared', () => {
    const nodes = graph(URL_, 'fr');
    const ids = new Set(nodes.map((n) => n['@id']));
    expect(ids.has(`${URL_}fr/#webpage`)).toBe(true);
    expect(ids.has(`${URL_}#app`)).toBe(true);
    const page = nodes.find((n) => n['@type'] === 'WebPage');
    expect(page?.inLanguage).toBe('fr');
    expect(page?.primaryImageOfPage).toEqual({ '@id': `${URL_}fr/#image` });
  });
});

describe('page text', () => {
  const words = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;
  const levels = (html: string) => [...html.matchAll(/<h(\d)/g)].map((m) => Number(m[1]));

  it('gives crawlers without JavaScript one h1, the title words and at least 250 words', () => {
    const html = aboutStatic(false);
    expect(levels(html).filter((l) => l === 1)).toHaveLength(1);
    expect(html).toContain(`<h1 id="about-title">${en.aboutTitle}</h1>`);
    expect(TITLE).toContain(en.aboutTitle);
    expect(words(html)).toBeGreaterThanOrEqual(250);
    expect(html).toContain('href="https://steevepommier.com/"');
  });

  it('never skips a heading level, static or in the gallery', () => {
    for (const h1 of [true, false]) {
      const found = levels(aboutHTML((k) => String(en[k]), { h1, publish: true, lang: 'en' }));
      expect(found[0]).toBe(h1 ? 1 : 2);
      for (const l of found) expect(l - (found[0] ?? 0)).toBeLessThanOrEqual(1);
    }
  });

  it('links back to the home page of the app’s language, from the app’s folder', () => {
    for (const lang of LANGUAGES) expect(PAGES[HOMES[lang]].path).toBe(HOME_PATH[lang]);
    const foot = (lang: 'en' | 'fr') =>
      aboutHTML((k) => String((lang === 'fr' ? fr : en)[k]), { h1: false, publish: false, lang }).match(
        /<p class="about-foot">[\s\S]*?<\/p>/,
      )?.[0] ?? '';
    expect(foot('en')).toContain(`<a href="../">${en.aboutHome}</a>`);
    expect(foot('fr')).toContain(`<a href="../fr/">${fr.aboutHome}</a>`);
    // The static copy crawlers read links it too.
    expect(aboutStatic(false)).toContain('<a href="../">Versus home page</a>');
  });

  it('mentions publishing only in builds that have the API', () => {
    expect(aboutStatic(true)).toContain(en.aboutPublishTitle);
    expect(aboutStatic(false)).not.toContain(en.aboutPublishTitle);
  });
});

describe('icons', () => {
  it('matches every PNG to its declared size', () => {
    for (const size of ICONS.png) expect(pngFile(pngIcon(size))).toEqual([size, size]);
    expect(pngFile(ICONS.maskable)).toEqual([512, 512]);
    expect(pngFile(ICONS.apple)).toEqual([ICONS.appleSize, ICONS.appleSize]);
  });

  it('packs 16, 32 and 48 px PNGs in favicon.ico', () => {
    const ico = readFileSync(publicFile(ICONS.ico));
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => {
      const entry = 6 + i * 16;
      const offset = ico.readUInt32LE(entry + 12);
      const [w] = pngSize(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)));
      expect(ico.readUInt8(entry)).toBe(w);
      return w;
    });
    expect(sizes).toEqual([...ICONS.icoSizes]);
  });

  it('keeps the SVG icon and its legacy address', () => {
    for (const name of [ICONS.svg, ...ICONS.legacy]) {
      const svg = readFileSync(publicFile(name), 'utf8');
      expect(svg.startsWith('<svg')).toBe(true);
      // Glyphs as paths: no text element that would depend on the viewer's fonts.
      expect(svg).not.toContain('<text');
    }
  });

  it('lists only existing files in the manifest, with a separate maskable icon', () => {
    const icons = manifest().icons as { src: string; purpose: string }[];
    for (const icon of icons) expect(existsSync(publicFile(icon.src.replace('./', ''))), icon.src).toBe(true);
    expect(icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1);
    expect(icons.some((i) => i.purpose.includes('any') && i.purpose.includes('maskable'))).toBe(false);
  });
});

describe('generated files', () => {
  it('writes a manifest that parses and names the app', () => {
    const m = JSON.parse(files['manifest.webmanifest']?.body ?? '');
    expect(m.name).toBe(NAME);
    // The installed app opens the app; its id stays the root it had before the home page existed.
    expect(m.start_url).toBe('./app/');
    expect(m.id).toBe('./');
    // A window of its own, on iOS too: rankings move in with an export and an import (D98).
    expect(m.display).toBe('standalone');
  });

  it('points robots.txt at the sitemap and keeps the API and the admin page out', () => {
    const robots = files['robots.txt']?.body ?? '';
    expect(robots).toContain(`Sitemap: ${URL_}sitemap.xml`);
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Disallow: /admin/');
  });

  it('lists the home and legal pages in a plain sitemap, with their last change, not the app', () => {
    const sitemap = files['sitemap.xml']?.body ?? '';
    for (const path of ['', 'fr/', 'legal/', 'fr/mentions-legales/']) {
      expect(sitemap).toContain(`<url><loc>${URL_}${path}</loc><lastmod>2026-09-30</lastmod></url>`);
    }
    expect(sitemap).not.toContain(`${URL_}app/`);
    expect(sitemap).not.toContain(`${URL_}admin/`);
    // Only the sitemap namespace: an XHTML one makes browsers render the file as a blank page.
    expect([...sitemap.matchAll(/xmlns(:\w+)?=/g)]).toHaveLength(1);
    expect(sitemap).not.toContain('xhtml');
  });

  it('describes the app and every scoring method in llms.txt', () => {
    const llms = llmsTxt(URL_);
    expect(llms.startsWith(`# ${NAME}\n\n> ${DESCRIPTION}`)).toBe(true);
    for (const method of METHODS) expect(llms).toContain(method.name);
    expect(llms).toContain(`(${URL_})`);
    expect(llms).toContain(`(${URL_}fr/)`);
    expect(llms).toContain(`(${URL_}app/)`);
    expect(llms).toContain(`(${URL_}legal/)`);
  });

  it('writes a 404 page that sends app views to the app and stays out of the index', () => {
    const html = files['404.html']?.body ?? '';
    expect(html).toBe(notFoundHtml(URL_));
    expect(html).toContain('<meta name="robots" content="noindex" />');
    // The key the app reads back (src/app/router.ts).
    expect(html).toContain(`sessionStorage.setItem('${STASH_KEY}'`);
    expect(html).toContain(`href="${URL_}"`);
    expect(html).toContain(`href="${URL_}fr/"`);
    expect(html).toContain(`href="${URL_}app/"`);
  });

  it('preloads the display font on the home pages only, the body font everywhere', () => {
    const bricolage = 'assets/bricolage-grotesque-latin-opsz-normal-Cre6nC2_.woff2';
    const figtree = 'assets/figtree-latin-wght-normal-D_ZTVpCC.woff2';
    expect(preloadFonts('home').map((re) => re.test(bricolage) || re.test(figtree))).toEqual([true, true]);
    for (const kind of ['app', 'legal', 'admin']) {
      expect(
        preloadFonts(kind).some((re) => re.test(bricolage)),
        kind,
      ).toBe(false);
      expect(
        preloadFonts(kind).some((re) => re.test(figtree)),
        kind,
      ).toBe(true);
    }
  });

  it('sends a deep path to its app folder once, and never loops on a folder that doesn’t exist', () => {
    const script = notFoundHtml(URL_).match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    const run = (pathname: string) => {
      const stash = new Map<string, string>();
      const replaced: string[] = [];
      const location = { pathname, search: '', hash: '', replace: (to: string) => replaced.push(to) };
      const sessionStorage = { setItem: (k: string, v: string) => stash.set(k, v) };
      new Function('location', 'sessionStorage', script)(location, sessionStorage);
      return { to: replaced[0] ?? null, kept: stash.get(STASH_KEY) ?? null };
    };
    expect(run('/versus/app/demo/destinations')).toEqual({ to: '/versus/app/', kept: 'demo/destinations' });
    expect(run('/fr/app/x')).toEqual({ to: '/fr/app/', kept: 'x' });
    // That folder isn't the app's either: the page stays, instead of reloading itself forever.
    expect(run('/fr/app/')).toEqual({ to: null, kept: null });
    expect(run('/elsewhere')).toEqual({ to: null, kept: null });
  });

  it('adds the Cloudflare headers to the Worker build only', () => {
    expect(files._headers).toBeUndefined();
    const worker = generatedFiles(URL_, { lastmod: '2026-09-30', worker: true });
    expect(worker._headers?.body).toContain('Content-Type: text/html; charset=utf-8');
    expect(worker._headers?.body).toContain('Content-Type: application/manifest+json');
    for (const path of ['/\n', '/fr/\n', '/app/\n', '/legal/\n', '/fr/mentions-legales/\n']) {
      expect(worker._headers?.body).toContain(path);
    }
    expect(worker._headers?.body).toContain('/app/*\n  X-Robots-Tag: noindex');
    expect(worker._headers?.body).toContain('/admin/*\n  X-Robots-Tag: noindex');
    expect(worker._headers?.body).toContain('/sitemap.xml\n  Content-Type: application/xml; charset=utf-8');
    expect(worker._headers?.body).toContain('/404\n  Content-Type: text/html; charset=utf-8');
  });
});

describe('content security policy', () => {
  const sha = (code: string) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;

  it('hashes the inline scripts a page runs, not its bundles or its data', () => {
    const page = [
      '<script>document.documentElement.dataset.theme = "dark";</script>',
      '<script type="module" crossorigin src="/assets/app-1.js"></script>',
      '<script type="application/ld+json">{"@type":"WebSite"}</script>',
      '<script defer src="https://insight.example.com/s.js" data-website-id="x"></script>',
      '<script type="module">\n  start();\n</script>',
    ].join('\n');
    expect(scriptHashes(page)).toEqual([
      sha('document.documentElement.dataset.theme = "dark";'),
      sha('\n  start();\n'),
    ]);
    expect(scriptHashes(notFoundHtml(URL_))).toHaveLength(1);
  });

  it('allows this site, the hashed scripts, the tracker and Turnstile, and nothing else runs or frames', () => {
    const policy = contentPolicy({
      scripts: ["'sha256-b'", "'sha256-a'", "'sha256-b'"],
      analytics: 'https://insight.example.com/s.js',
      api: 'https://api.example.com/api',
    });
    const rule = (name: string) => policy.split('; ').find((r) => r.startsWith(`${name} `));
    expect(rule('script-src')).toBe(
      "script-src 'self' 'sha256-a' 'sha256-b' https://insight.example.com https://challenges.cloudflare.com",
    );
    expect(rule('connect-src')).toBe("connect-src 'self' https://insight.example.com https://api.example.com");
    expect(rule('object-src')).toBe("object-src 'none'");
    expect(rule('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(rule('report-uri')).toBe(`report-uri ${CSP_REPORT_PATH}`);
    // A same-origin API (a relative address) and no tracker add nothing.
    const plain = contentPolicy({ scripts: [], analytics: null, api: '/api' });
    expect(plain).toContain("connect-src 'self';");
    expect(plain).toContain("script-src 'self' https://challenges.cloudflare.com;");
  });

  it('is reported only, on every path, when the build gives it', () => {
    expect(headersFile()).not.toContain('Content-Security-Policy');
    const withPolicy = headersFile("default-src 'self'");
    expect(withPolicy).toMatch(/^\/\*\n(?: {2}.+\n)*? {2}Content-Security-Policy-Report-Only: default-src 'self'\n/);
    expect(withPolicy).not.toContain('Content-Security-Policy:');
    expect(withPolicy).toContain('  Referrer-Policy: strict-origin-when-cross-origin');
  });
});

describe('palette', () => {
  const tokens = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8');
  /** A token's value in the first block that `selector` opens. */
  const token = (selector: string, name: string) => {
    const block = tokens.slice(tokens.indexOf(selector));
    return block
      .slice(0, block.indexOf('}'))
      .match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
      ?.toLowerCase();
  };
  const light = (name: string) => token(':root {', name);
  const dark = (name: string) => token(':root:not([data-theme="light"]) {', name);

  it('keeps the build’s colors equal to the design tokens, in both themes', () => {
    const pairs: [string | undefined, string][] = [
      [light('bg'), COLORS.bg],
      [light('surface'), COLORS.surface],
      [light('ink'), COLORS.ink],
      [light('muted'), COLORS.muted],
      [light('line'), COLORS.line],
      [light('a'), COLORS.a],
      [light('b'), COLORS.b],
      [light('on-accent'), COLORS.onAccent],
      [dark('bg'), COLORS.bgDark],
      [dark('ink'), COLORS.inkDark],
      [dark('muted'), COLORS.mutedDark],
    ];
    for (const [css, built] of pairs) expect(css).toBe(built.toLowerCase());
  });

  it('gives every page the browser bar of its theme', () => {
    for (const page of Object.keys(PAGES) as PageKey[]) {
      const tags = headTags(URL_, page).join('\n');
      expect(tags).toContain(
        `<meta name="theme-color" content="${COLORS.bg}" media="(prefers-color-scheme: light)" />`,
      );
      expect(tags).toContain(
        `<meta name="theme-color" content="${COLORS.bgDark}" media="(prefers-color-scheme: dark)" />`,
      );
    }
  });
});

describe('shared preferences', () => {
  it('reads the theme before the first paint under the key every page shares', () => {
    for (const shell of ['app/index.html', 'admin/index.html']) {
      const html = readFileSync(resolve(process.cwd(), shell), 'utf8');
      if (html.includes('localStorage')) expect(html, shell).toContain(`localStorage.getItem('${PREFS_KEY}')`);
    }
  });
});
