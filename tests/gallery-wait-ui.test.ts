// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PopularBoard } from '../src/core/protocol';

/** The gallery while the server answers late: places kept, a word for screen readers, the focus left alone. */

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

const board: PopularBoard = {
  alias: 'Fe4tUrEdbd',
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
};

/** The Popular list answers only when the test says so. */
let answer: (r: Response) => void = () => {};
const fetchMock = (url: string): Promise<Response> =>
  url.includes('/api/popular')
    ? new Promise((done) => {
        answer = done;
      })
    : Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  window.scrollTo = () => {};
  localStorage.clear();
  document.body.innerHTML = body;
  const { mount } = await import('../src/app/ui');
  mount(document);
});

describe('the gallery while Popular loads', () => {
  it('keeps the section’s place with a word a screen reader hears', () => {
    expect($('.popular-head h2')?.textContent).toBe('Popular');
    const wait = $('.g-wait');
    expect(wait?.getAttribute('role')).toBe('status');
    expect(wait?.textContent).toBe('Loading popular rankings…');
  });

  it('shows the list when it comes, the focus staying where it was', async () => {
    const before = $('.g-head [data-action="new-rank"]');
    before?.focus();
    answer(Response.json({ boards: [board] }));
    await vi.advanceTimersByTimeAsync(0);
    expect($('.g-wait')).toBeNull();
    expect(document.querySelectorAll('.popular-head + .g-grid .rcard')).toHaveLength(1);
    // The gallery was drawn again: another button, the same place.
    expect(before?.isConnected).toBe(false);
    expect(document.activeElement).toBe($('.g-head [data-action="new-rank"]'));
  });
});
