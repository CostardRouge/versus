import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aboutStatic,
  generatedFiles,
  graph,
  headTags,
  jsonLd,
  llmsTxt,
  manifest,
  noscriptHtml,
  notFoundHtml,
  pageUrl,
  ROBOTS_APP,
  rootFrom,
  sitePath,
  siteUrl,
} from '../build/seo';
import {
  DEFAULT_SITE_URL,
  DESCRIPTION,
  DESCRIPTIONS,
  ICONS,
  LANGUAGES,
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
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

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
      const found = levels(aboutHTML((k) => String(en[k]), { h1, publish: true }));
      expect(found[0]).toBe(h1 ? 1 : 2);
      for (const l of found) expect(l - (found[0] ?? 0)).toBeLessThanOrEqual(1);
    }
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
  });

  it('points robots.txt at the sitemap and keeps the API out', () => {
    const robots = files['robots.txt']?.body ?? '';
    expect(robots).toContain(`Sitemap: ${URL_}sitemap.xml`);
    expect(robots).toContain('Disallow: /api/');
  });

  it('lists both home pages in a plain sitemap, with their last change, not the app', () => {
    const sitemap = files['sitemap.xml']?.body ?? '';
    expect(sitemap).toContain(`<url><loc>${URL_}</loc><lastmod>2026-09-30</lastmod></url>`);
    expect(sitemap).toContain(`<url><loc>${URL_}fr/</loc><lastmod>2026-09-30</lastmod></url>`);
    expect(sitemap).not.toContain(`${URL_}app/`);
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

  it('adds the Cloudflare headers to the Worker build only', () => {
    expect(files._headers).toBeUndefined();
    const worker = generatedFiles(URL_, { lastmod: '2026-09-30', worker: true });
    expect(worker._headers?.body).toContain('Content-Type: text/html; charset=utf-8');
    expect(worker._headers?.body).toContain('Content-Type: application/manifest+json');
    for (const path of ['/\n', '/fr/\n', '/app/\n']) expect(worker._headers?.body).toContain(path);
    expect(worker._headers?.body).toContain('/app/*\n  X-Robots-Tag: noindex');
    expect(worker._headers?.body).toContain('/sitemap.xml\n  Content-Type: application/xml; charset=utf-8');
    expect(worker._headers?.body).toContain('/404\n  Content-Type: text/html; charset=utf-8');
  });
});
