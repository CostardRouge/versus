// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BoardView, PopularBoard } from '../src/core/protocol';
import type { Ranking } from '../src/core/types';

/** The Popular section of the gallery, against a fake API. */

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};

const TPL = 'Tp1aTeb0Ar'.replace('0', 'x');
const FEAT = 'Fe4tUrEdbd';
const boards: PopularBoard[] = [
  {
    alias: FEAT,
    title: 'Best pizza in town',
    status: 'open',
    lang: 'en',
    items: 6,
    votes: 240,
    voters: 31,
    featured: true,
    template: '',
    top: ['Margherita', 'Diavola', 'Calzone'],
    active: 1,
  },
  {
    alias: TPL,
    title: 'The best game console of all time',
    status: 'open',
    lang: 'en',
    items: 12,
    votes: 0,
    voters: 0,
    featured: false,
    template: 'game-consoles',
    top: ['NES', 'Super Nintendo', 'Mega Drive'],
    active: 1,
  },
];
const items = ['NES', 'Super Nintendo', 'Mega Drive'].map((label, i) => ({
  id: `t${i}`,
  label,
  img: null,
  fill: null,
  h: 3,
}));
const view: BoardView = {
  title: 'The best game console of all time',
  items,
  settings: { method: 'bt', visibility: 'always', revealAfter: 10, allowChange: true, visitorsAddItems: false },
  status: 'open',
  created: 1,
  counts: { votes: 0, voters: 0, online: 0 },
  ranking: null,
};

const urls: string[] = [];
/** The server can't be reached for boards (the list itself was fetched before). */
let down = false;
const fetchMock = async (url: string) => {
  urls.push(url);
  if (down && url.startsWith('/api/boards/')) throw new TypeError('Failed to fetch');
  if (url.includes('/api/popular')) return Response.json({ boards });
  if (url === `/api/boards/${TPL}`) return Response.json(view);
  return Response.json({ error: 'not_found' }, { status: 404 });
};
const stored = (): Ranking[] => JSON.parse(localStorage.getItem('versus-v1') ?? '[]');

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  window.scrollTo = () => {};
  localStorage.clear();
  document.body.innerHTML = body;
  const { mount } = await import('../src/app/ui');
  mount(document);
  await vi.advanceTimersByTimeAsync(0);
});

describe('the Popular section', () => {
  it('shows the featured boards and the templates of the app’s language, between your rankings and the demos', () => {
    expect(urls.filter((u) => u.includes('/api/popular?lang=en'))).toHaveLength(1);
    const head = $('.popular-head');
    expect(head?.querySelector('h2')?.textContent).toBe('Popular');
    const cards = $$('.popular-head + .g-grid .rcard');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector('h3')?.textContent).toBe('Best pizza in town');
    expect(cards[0]?.querySelector('.chip')?.textContent).toBe('Featured');
    expect(cards[0]?.querySelector('.meta')?.textContent).toBe('6 items · 240 votes · 31 voters');
    expect(cards[0]?.querySelector('.lead')?.textContent).toBe('Leading: Margherita');
    expect(cards[0]?.querySelector('.tile.first b')?.textContent).toBe('Margherita');
    expect(cards[1]?.querySelector('.chip')?.textContent).toBe('Official');
    expect(cards[1]?.querySelector('.lead')?.textContent).toBe('No votes yet: be the first');
    // The section sits before the demos.
    const order = $$('.gallery .sec-head').map((el) => el.className);
    expect(order.indexOf('sec-head popular-head')).toBeLessThan(order.indexOf('sec-head demo-head'));
  });

  it('asks the server again only after a while', async () => {
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.filter((u) => u.includes('/api/popular'))).toHaveLength(1);
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.filter((u) => u.includes('/api/popular'))).toHaveLength(2);
    click('[data-action="toggle-demos"]');
  });

  it('says so when the board can’t be read for lack of a connection', async () => {
    down = true;
    const before = stored().length;
    click(`[data-action="make-mine-popular"][data-alias="${TPL}"]`);
    await vi.advanceTimersByTimeAsync(0);
    expect($('#toast')?.textContent).toBe('You’re offline or the server can’t be reached. Try again in a moment.');
    expect(stored()).toHaveLength(before);
    down = false;
  });

  it('starts a ranking of your own from a template, with its items and no votes', async () => {
    const before = stored().length;
    const asked = urls.length;
    // A double click: one request, one ranking.
    click(`[data-action="make-mine-popular"][data-alias="${TPL}"]`);
    const btn = $(`[data-action="make-mine-popular"][data-alias="${TPL}"]`) as HTMLButtonElement;
    expect([btn.disabled, btn.getAttribute('aria-busy')]).toEqual([true, 'true']);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(urls.slice(asked).filter((u) => u === `/api/boards/${TPL}`)).toHaveLength(1);
    expect(stored()).toHaveLength(before + 1);
    expect(($('#rank-title') as HTMLInputElement).value).toBe('The best game console of all time');
    expect($('#toast')?.textContent).toBe('Your own version, ready to change and publish');
    const mine = stored().find((r) => r.title === 'The best game console of all time');
    expect(mine?.items.map((i) => i.label)).toEqual(['NES', 'Super Nintendo', 'Mega Drive']);
    expect(mine?.items.map((i) => i.id)).not.toContain('t0');
    expect(mine?.history).toEqual([]);
    click('[data-action="back"]');
  });

  it('opens a popular board to vote', () => {
    click(`.rcard-actions [data-action="open-board"][data-alias="${FEAT}"]`);
    expect(location.pathname).toBe(`/b/${FEAT}`);
    click('.board [data-action="back"]');
  });
});
