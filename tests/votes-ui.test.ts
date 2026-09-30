// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/board';
import type { BoardSummary } from '../src/core/protocol';
import type { Item, Joined, Ranking } from '../src/core/types';

/** "Your votes" for someone who came through shared links and made nothing yet, against a fake API. */

const ALIAS = 'Ab3dEf7hJk';
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};

const item = (id: string, label: string): Item => ({ id, label, img: null, fill: null, h: 10 });
const items = [item('p0', 'Margherita'), item('p1', 'Regina'), item('p2', 'Calzone')];
const card: Joined = {
  alias: ALIAS,
  title: 'Pizzas',
  items,
  settings: { ...DEFAULT_SETTINGS, visibility: 'blind' },
  status: 'open',
  votes: 4,
  voters: 2,
  order: null,
  mine: [{ a: 'p2', b: 'p0', s: 1 }],
  count: 3,
  joined: 1,
  voted: 1,
  seen: { at: 1, status: 'open', items: ['p0', 'p1', 'p2'], visible: false },
};
const summary = (over: Partial<BoardSummary> = {}): BoardSummary => ({
  title: 'Pizzas',
  items,
  settings: card.settings,
  status: 'open',
  counts: { votes: 12, voters: 5 },
  mine: 3,
  order: null,
  ...over,
});

let answer: () => Response = () => Response.json({ [ALIAS]: summary() });
let fetches = 0;
const fetchMock = async () => {
  fetches++;
  return answer();
};
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');
const cardEl = () => $('.g-grid .rcard');

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  window.scrollTo = () => {};
  localStorage.clear();
  localStorage.setItem('versus-joined', JSON.stringify([card]));
  document.body.innerHTML = body;
  const { mount } = await import('../src/app/ui');
  mount(document);
  await vi.advanceTimersByTimeAsync(0);
});

describe('your votes first', () => {
  it('opens on the votes, with an invitation to make a ranking of your own', () => {
    expect($('h1')?.textContent).toBe('Your votes');
    expect($('.g-invite h2')?.textContent).toBe('Your rankings');
    expect($('.g-invite [data-action="new-rank"]')).not.toBeNull();
    expect(cardEl()?.querySelector('.chip')?.textContent).toBe('Open');
    expect(cardEl()?.querySelector('.meta')?.textContent).toBe('3 items · 12 votes · 5 voters');
    expect(cardEl()?.querySelector('[data-action="open-board"].btn')?.textContent).toBe('Open');
    expect(fetches).toBe(1);
  });

  it('asks the server again at most once a minute', async () => {
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    click('[data-action="toggle-demos"]');
  });

  it('flags results revealed at closing, and brings the card to the top', async () => {
    answer = () => Response.json({ [ALIAS]: summary({ status: 'closed', order: ['p1', 'p0', 'p2'] }) });
    await vi.advanceTimersByTimeAsync(61_000);
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(cardEl()?.classList.contains('fresh')).toBe(true);
    expect(cardEl()?.querySelector('.lead')?.textContent).toBe('Results revealed · Leading: Regina');
    expect(cardEl()?.querySelector('.chip')?.textContent).toBe('Closed');
    expect(cardEl()?.querySelector('.mosaic-cap')).toBeNull();
    // What the voter saw stays as it was until they open the board.
    expect(stored('versus-joined')[0].seen.visible).toBe(false);
    click('[data-action="toggle-demos"]');
  });

  it('says how many items and pairs were added', async () => {
    const more = [...items, item('p3', 'Diavola')];
    answer = () => Response.json({ [ALIAS]: summary({ items: more, order: ['p1', 'p0', 'p2', 'p3'] }) });
    await vi.advanceTimersByTimeAsync(61_000);
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    // Revealed wins over the new items in the lead; the note still says what's new.
    expect(cardEl()?.querySelector('.rcard-note')?.textContent).toBe('+1 item added · 3 pairs to vote on');
    expect(cardEl()?.querySelector('[data-action="open-board"].btn')?.textContent).toBe('Continue');
    click('[data-action="toggle-demos"]');
  });

  it('keeps the snapshot when the server can’t be reached', async () => {
    answer = () => {
      throw new TypeError('offline');
    };
    await vi.advanceTimersByTimeAsync(61_000);
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(cardEl()?.querySelector('.rcard-note')).not.toBeNull();
    click('[data-action="toggle-demos"]');
  });

  it('shows a board that is gone, and keeps a copy of it as a ranking of your own', async () => {
    answer = () => Response.json({ [ALIAS]: null });
    await vi.advanceTimersByTimeAsync(61_000);
    click('[data-action="toggle-demos"]');
    await vi.advanceTimersByTimeAsync(0);
    expect(cardEl()?.classList.contains('gone')).toBe(true);
    expect(cardEl()?.querySelector('.chip')?.textContent).toBe('Withdrawn');
    expect(cardEl()?.querySelector('.rcard-main[data-action]')).toBeNull();
    click('[data-action="joined-copy"]');
    const copy = (stored('versus-v1') as Ranking[]).find((r) => r.title === 'Pizzas');
    expect(copy?.history).toEqual([{ a: 'p2', b: 'p0', s: 1 }]);
    expect(copy?.items.map((i) => i.label)).toEqual(['Margherita', 'Regina', 'Calzone', 'Diavola']);
    expect(stored('versus-joined')).toEqual([]);
    expect($('#toast')?.textContent).toBe('Copy kept in your rankings, with your votes');
    expect($('.results')).not.toBeNull();
    click('[data-action="back"]');
    expect($('h1')?.textContent).toBe('Your rankings');
  });
});
