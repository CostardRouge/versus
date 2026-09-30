import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedFiles, graph, headTags, jsonLd, llmsTxt, manifest, noscriptHtml, siteUrl } from '../build/seo';
import { DEFAULT_SITE_URL, DESCRIPTION, ICONS, METHODS, NAME, OG_IMAGE, pngIcon, TITLE } from '../build/site';

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
  it('falls back to the GitHub Pages address', () => {
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

describe('head', () => {
  it('keeps the title and description within what results display', () => {
    expect(TITLE.length).toBeLessThanOrEqual(60);
    expect(DESCRIPTION.length).toBeGreaterThanOrEqual(70);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(155);
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

  it('only links files that exist in public/ or are generated', () => {
    const hrefs = [...head.matchAll(/href="\.\/([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) expect(existsSync(publicFile(href)) || href in files, href).toBe(true);
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

  it('gives crawlers without JavaScript a heading and the description', () => {
    const html = noscriptHtml();
    expect(html).toMatch(/^<noscript>[\s\S]*<\/noscript>$/);
    expect(html).toContain('<h1>');
    expect(html).toContain(DESCRIPTION);
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
    expect(m.start_url).toBe('./');
  });

  it('points robots.txt at the sitemap and keeps the API out', () => {
    const robots = files['robots.txt']?.body ?? '';
    expect(robots).toContain(`Sitemap: ${URL_}sitemap.xml`);
    expect(robots).toContain('Disallow: /api/');
  });

  it('lists the canonical address in the sitemap, with its last change', () => {
    const sitemap = files['sitemap.xml']?.body ?? '';
    expect(sitemap).toContain(`<loc>${URL_}</loc>`);
    expect(sitemap).toContain('<lastmod>2026-09-30</lastmod>');
  });

  it('describes the app and every scoring method in llms.txt', () => {
    const llms = llmsTxt(URL_);
    expect(llms.startsWith(`# ${NAME}\n\n> ${DESCRIPTION}`)).toBe(true);
    for (const method of METHODS) expect(llms).toContain(method.name);
    expect(llms).toContain(`(${URL_})`);
  });

  it('adds the Cloudflare headers to the Worker build only', () => {
    expect(files._headers).toBeUndefined();
    const worker = generatedFiles(URL_, { lastmod: '2026-09-30', worker: true });
    expect(worker._headers?.body).toContain('Content-Type: text/html; charset=utf-8');
    expect(worker._headers?.body).toContain('Content-Type: application/manifest+json');
  });
});
