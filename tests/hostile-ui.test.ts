// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/app/ui';

/**
 * Every view of a ranking drawn from hostile stored data: labels, titles, pictures, colors and hues written to break
 * out of text, attributes and styles. Storage is read, not trusted (src/core/model.ts imageSrc and hueValue,
 * src/core/colors.ts fillCSS, esc everywhere): nothing may run, load from elsewhere or restyle the page.
 */

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const EVIL = 'evil.example';
const RUN = 'window.__ran=1';
const items = [
  { id: 'a', label: `<img src=x onerror="${RUN}">`, img: null, fill: null, h: `1;background:url(//${EVIL}/h)` },
  { id: 'b', label: 'Picture', img: `x" onerror="${RUN}`, fill: null, h: 20 },
  { id: 'c', label: 'Script', img: 'javascript:alert(1)', fill: null, h: 30 },
  { id: 'd', label: 'Elsewhere', img: `https://${EVIL}/pixel.jpg`, fill: null, h: 40 },
  { id: 'e', label: 'Red', img: null, fill: { type: 'solid', colors: [`red;background:url(//${EVIL}/s)`] }, h: 0 },
  {
    id: 'f',
    label: '"><svg onload=alert(1)>',
    img: null,
    fill: { type: 'gradient', colors: ['#fff', `#000"><img src=x onerror="${RUN}">`, '#123456'] },
    h: 0,
  },
];
const duels = [
  ['a', 'b', 1],
  ['c', 'd', 0],
  ['e', 'f', 0.5],
  ['a', 'e', 1],
  ['b', 'f', 0],
].map(([a, b, s], i) => ({ a, b, s, t: 1_000 + i }));
const ranking = {
  id: 'hostile',
  title: `</title><script>${RUN}</script>`,
  method: 'bt',
  items,
  history: duels,
  pair: ['a', 'b'],
  created: 1,
  updated: 2,
};

const $ = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

/** Nothing of the hostile data took effect in what is on screen. */
function expectInert(view: string): void {
  const all = [...document.querySelectorAll('*')];
  const handlers = all.flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => a.name));
  expect(handlers, view).toEqual([]);
  expect(document.querySelectorAll('#app script, #app svg[onload]'), view).toHaveLength(0);
  const styles = all
    .map((el) => el.getAttribute('style') ?? '')
    .filter((s) => s.includes(EVIL) || /url\(\s*['"]?(?!['"]?data:image)/.test(s));
  expect(styles, view).toEqual([]);
  const sources = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
  expect(
    sources.filter((s) => !/^(data:image\/|\/img\/b\/)/.test(s)),
    view,
  ).toEqual([]);
  expect((window as { __ran?: number }).__ran, view).toBeUndefined();
}

beforeAll(() => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  localStorage.setItem('versus-v1', JSON.stringify([ranking]));
  document.body.innerHTML = body;
  mount(document);
});

describe('hostile stored data', () => {
  it('stays text in the gallery', () => {
    expect(document.querySelector('.rcard [data-id="hostile"]')).not.toBeNull();
    expectInert('gallery');
  });

  it('stays text and plain colors in the duel and the items list', () => {
    $('.rcard [data-action="open"][data-id="hostile"][data-tab="duel"]').click();
    expect(document.querySelectorAll('#stage .card')).toHaveLength(2);
    expect(document.querySelectorAll('#item-list li')).toHaveLength(items.length);
    expectInert('duel');
  });

  it('stays text and plain colors in the ranking, its podium, table and comparison', () => {
    $('[data-action="tab"][data-tab="results"]').click();
    expect(document.querySelector('.podium')).not.toBeNull();
    expectInert('ranking');
    for (const el of document.querySelectorAll<HTMLElement>('[data-action="result-view"], [data-action="rank-view"]')) {
      el.click();
      expectInert(`ranking: ${el.dataset.view ?? el.textContent}`);
    }
  });
});
