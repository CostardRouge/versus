import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../build/site';
import { DEMOS } from '../src/core/demos';
import { adminHash, parseBoardHash } from '../src/core/published';
import {
  lastRanking,
  ownerFragment,
  parseOwnerFragment,
  parseRoute,
  parseShortcut,
  type Route,
  routePath,
  trackedPath,
} from '../src/core/route';

const ALIAS = 'Ab3dEf7hJk';
const TOKEN = 'a'.repeat(64);

describe('routePath', () => {
  it('gives every view its address under the app', () => {
    expect(routePath({ view: 'gallery' })).toBe('');
    expect(routePath({ view: 'rank', id: 'demo-destinations', tab: 'duel' })).toBe('demo/destinations');
    expect(routePath({ view: 'rank', id: 'demo-accent', tab: 'results' })).toBe('demo/accent/ranking');
    expect(routePath({ view: 'rank', id: 'k3x9q2m7lz', tab: 'items' })).toBe('r/k3x9q2m7lz/items');
    expect(routePath({ view: 'board', alias: ALIAS })).toBe(`b/${ALIAS}`);
  });

  it('names every demo by a short slug', () => {
    for (const d of DEMOS) expect(routePath({ view: 'rank', id: d.id, tab: 'duel' })).toMatch(/^demo\/[a-z-]+$/);
  });
});

describe('parseRoute', () => {
  const routes: Route[] = [
    { view: 'gallery' },
    { view: 'rank', id: 'demo-backgrounds', tab: 'duel' },
    { view: 'rank', id: 'demo-backgrounds', tab: 'results' },
    { view: 'rank', id: 'k3x9q2m7lz', tab: 'items' },
    { view: 'board', alias: ALIAS },
  ];

  it('reads back every address it writes', () => {
    for (const r of routes) expect(parseRoute(routePath(r))).toEqual(r);
  });

  it('tolerates a trailing slash and the explicit duel tab', () => {
    expect(parseRoute('demo/destinations/')).toEqual({ view: 'rank', id: 'demo-destinations', tab: 'duel' });
    expect(parseRoute('r/abc/duel')).toEqual({ view: 'rank', id: 'abc', tab: 'duel' });
    expect(parseRoute(`b/${ALIAS}/`)).toEqual({ view: 'board', alias: ALIAS });
  });

  it.each(['x', 'demo', 'r/', 'demo/a b', 'r/abc/results', 'r/abc/ranking/more', 'b/short', `b/${ALIAS}/items`])(
    'names nothing for %j',
    (path) => {
      expect(parseRoute(path)).toBeNull();
    },
  );
});

describe('author links', () => {
  it('keep the token in the fragment', () => {
    expect(parseOwnerFragment(ownerFragment(TOKEN))).toBe(TOKEN);
    expect(parseOwnerFragment('#owner=nope')).toBeNull();
    expect(parseOwnerFragment('')).toBeNull();
  });

  it('still read the links written before paths', () => {
    expect(parseBoardHash(adminHash(ALIAS, TOKEN))).toEqual({ alias: ALIAS, owner: TOKEN });
  });
});

describe('trackedPath', () => {
  it('keeps demos and the gallery, and hides what identifies a ranking or a board', () => {
    expect(trackedPath({ view: 'gallery' })).toBe('');
    expect(trackedPath({ view: 'rank', id: 'demo-destinations', tab: 'results' })).toBe('demo/destinations/ranking');
    expect(trackedPath({ view: 'rank', id: 'x7Kq2', tab: 'duel' })).toBe('r/:id');
    expect(trackedPath({ view: 'rank', id: 'x7Kq2', tab: 'items' })).toBe('r/:id/items');
    expect(trackedPath({ view: 'board', alias: ALIAS })).toBe('b/:alias');
  });
});

describe('icon shortcuts', () => {
  it('reads the shortcut the manifest declares, and nothing else', () => {
    for (const s of SHORTCUTS) expect(parseShortcut(`?shortcut=${s.key}`)).toBe(s.key);
    expect(parseShortcut('?shortcut=new&x=1')).toBe('new');
    expect(parseShortcut('')).toBeNull();
    expect(parseShortcut('?shortcut=delete')).toBeNull();
    expect(parseShortcut('?duel=a.b')).toBeNull();
  });

  it('resumes the ranking changed last, never a demo', () => {
    const ranks = [
      { id: 'a', updated: 5 },
      { id: 'demo', updated: 9, demo: true },
      { id: 'b', updated: 7 },
    ];
    expect(lastRanking(ranks)?.id).toBe('b');
    expect(lastRanking([{ id: 'demo', updated: 9, demo: true }])).toBeNull();
    expect(lastRanking([])).toBeNull();
  });
});
