import { describe, expect, it } from 'vitest';
import { cacheVersion, injectPrecache, PRECACHE_MARK, precacheList, VERSION_MARK } from '../build/pwa';
import { ICONS } from '../build/site';

const BUILD = [
  'index.html',
  'assets/index-CWzlMAkk.js',
  'assets/index-CWzlMAkk.js.map',
  'assets/index-Dw_WARWv.css',
  'assets/figtree-latin-wght-normal-D_ZTVpCC.woff2',
  'assets/figtree-latin-ext-wght-normal-DCwSJGxG.woff2',
  'assets/jetbrains-mono-latin-500-normal-BWZEU5yA.woff2',
  'assets/jetbrains-mono-latin-500-normal-CJOVTJB7.woff',
  'assets/jetbrains-mono-cyrillic-500-normal-DmUKJPL_.woff2',
  'manifest.webmanifest',
  ICONS.svg,
  'icon-192.png',
  'og.png',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  '_headers',
  'sw.js',
  'sw.js.map',
];

describe('precacheList', () => {
  const list = precacheList(BUILD);

  it('stores the page under the scope, with its script, styles, manifest and icon', () => {
    expect(list).toContain('./');
    expect(list).not.toContain('index.html');
    expect(list).toContain('assets/index-CWzlMAkk.js');
    expect(list).toContain('assets/index-Dw_WARWv.css');
    expect(list).toContain('manifest.webmanifest');
    expect(list).toContain(ICONS.svg);
  });

  it('keeps only the latin woff2 fonts of the first render', () => {
    expect(list.filter((f) => /\.woff2?$/.test(f))).toEqual([
      'assets/figtree-latin-wght-normal-D_ZTVpCC.woff2',
      'assets/jetbrains-mono-latin-500-normal-BWZEU5yA.woff2',
    ]);
  });

  it('leaves out source maps, images, crawler files and the worker itself', () => {
    for (const f of ['.map', '.png', '.ico', 'robots.txt', 'sitemap.xml', 'llms.txt', '_headers', 'sw.js']) {
      expect(list.some((x) => x.endsWith(f))).toBe(false);
    }
  });

  it('is sorted, whatever the bundle order', () => {
    expect(precacheList([...BUILD].reverse())).toEqual(list);
    expect([...list].sort()).toEqual(list);
  });
});

describe('cacheVersion', () => {
  const files = [
    ['./', '<html>v1</html>'],
    ['assets/app-1.js', new Uint8Array([1, 2, 3])],
  ] as const;

  it('is stable and ignores the order of the files', () => {
    const v = cacheVersion(files);
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(cacheVersion([...files].reverse())).toBe(v);
  });

  it('changes when a file changes, even under the same name', () => {
    const v = cacheVersion(files);
    expect(cacheVersion([['./', '<html>v2</html>'], files[1]])).not.toBe(v);
    expect(cacheVersion([files[0], ['assets/app-2.js', new Uint8Array([1, 2, 3])]])).not.toBe(v);
  });
});

describe('injectPrecache', () => {
  it('writes the list and the version into the worker', () => {
    const code = `const v=${VERSION_MARK};const l=new Set(${PRECACHE_MARK}.map(f));`;
    const out = injectPrecache(code, ['./', 'assets/a.js'], 'abc123');
    expect(out).toBe('const v="abc123";const l=new Set(["./","assets/a.js"].map(f));');
  });

  it('refuses a worker without its placeholders', () => {
    expect(() => injectPrecache(`const l=${PRECACHE_MARK};`, [], 'x')).toThrow(VERSION_MARK);
    expect(() => injectPrecache(`const v=${VERSION_MARK};`, [], 'x')).toThrow(PRECACHE_MARK);
  });
});
