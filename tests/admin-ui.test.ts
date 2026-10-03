// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsConfig } from '../build/analytics';
import { BOOT_MARK, fillPage } from '../build/seo-plugin';
import { PAGES } from '../build/site';
import { mountAdmin } from '../src/admin/page';
import type { AdminBoardView, AdminList, AdminRow, AdminTotals } from '../src/core/protocol';
import { adminEn, adminFr, adminText } from '../src/i18n/admin';

/** The moderation page against a fake admin API. */

const ALIAS = 'Ab3dEf7hJk';
type Call = { method: string; url: string; body: unknown; auth: string | null };
const calls: Call[] = [];
let respond: (c: Call) => { status: number; body: unknown } = () => ({ status: 404, body: { error: 'not_found' } });

const items = ['Margherita', 'Regina', 'Calzone'].map((label, i) => ({
  id: `p${i}`,
  label,
  img: null,
  fill: null,
  h: 1,
}));
const row = (over: Partial<AdminRow> = {}): AdminRow => ({
  alias: ALIAS,
  title: 'Pizzas',
  status: 'open',
  lang: 'en',
  items: 3,
  votes: 12,
  voters: 4,
  reports: 2,
  pictures: 0,
  hidden: false,
  featured: false,
  template: '',
  recent: 5,
  top: ['Regina', 'Margherita', 'Calzone'],
  created: 1_790_000_000_000,
  active: 1_790_000_100_000,
  ...over,
});
const totals: AdminTotals = {
  boards: 1,
  open: 1,
  votes: 12,
  voters: 4,
  reported: 1,
  pictures: 0,
  featured: 0,
  hidden: 0,
};
const detail = (over: Partial<AdminBoardView> = {}): AdminBoardView => ({
  alias: ALIAS,
  title: 'Pizzas',
  items,
  settings: { method: 'bt', visibility: 'always', revealAfter: 10, allowChange: true, visitorsAddItems: false },
  status: 'open',
  created: 1_790_000_000_000,
  touched: 1_790_000_000_000,
  lang: 'en',
  counts: { votes: 12, voters: 4, online: 0 },
  ranking: {
    method: 'bt',
    order: ['p1', 'p0', 'p2'],
    stats: Object.fromEntries(items.map((it, i) => [it.id, { score: 1600 - i * 50, se: 20, w: 1, l: 1, d: 0 }])),
  },
  mod: { hidden: false, featured: false },
  reports: [{ reason: 'spam', note: 'Ads for a pizzeria', t: 1_790_000_050_000 }],
  ...over,
});

/** Answers every admin route with the fixtures above. */
const ok: typeof respond = (c) => {
  if (c.auth !== 'Bearer good') return { status: 403, body: { error: 'forbidden' } };
  if (c.url.includes('/stats')) return { status: 200, body: totals };
  if (/\/boards\?/.test(c.url)) {
    const url = new URL(c.url, 'http://x');
    const list: AdminList = {
      boards: url.searchParams.get('q') === 'none' ? [] : [row()],
      limit: 50,
      offset: Number(url.searchParams.get('offset')),
      filter: (url.searchParams.get('filter') as AdminList['filter']) ?? 'all',
      q: url.searchParams.get('q') ?? '',
    };
    return { status: 200, body: list };
  }
  if (c.method === 'GET') return { status: 200, body: detail() };
  return { status: 200, body: true };
};

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const call: Call = {
    method: init?.method ?? 'GET',
    url,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    auth: headers.Authorization ?? null,
  };
  calls.push(call);
  const r = respond(call);
  return new Response(JSON.stringify(r.body), { status: r.status });
});

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const requests = (method: string) => calls.filter((c) => c.method === method);

function mount(api: string | null = '', token = '') {
  document.body.innerHTML = '<div id="admin"></div>';
  const root = $('#admin') as HTMLElement;
  const store = new Map<string, string>();
  if (token) store.set('versus-admin', token);
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
  const confirm = vi.fn(() => true);
  mountAdmin({
    root,
    api,
    lang: 'en',
    fetch: fetchMock as unknown as typeof fetch,
    storage,
    confirm,
    boardURL: (alias) => `https://versus.example.com/app/b/${alias}`,
    locale: 'en-GB',
  });
  return { root, store, confirm };
}

afterEach(() => {
  calls.length = 0;
  respond = ok;
});

describe('the dictionaries', () => {
  it('agree on keys and placeholders, with no empty text', () => {
    expect(Object.keys(adminFr).sort()).toEqual(Object.keys(adminEn).sort());
    const holes = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(adminEn) as Array<keyof typeof adminEn>) {
      expect(holes(adminFr[key]), key).toEqual(holes(adminEn[key]));
      expect(adminFr[key].trim(), key).not.toBe('');
    }
    expect(adminText('fr', 'confirmTakeDown', { title: 'Pizzas' })).toContain('« Pizzas »');
  });
});

describe('the shell', () => {
  it('fills with the theme script and no measurement, out of the index', () => {
    const shell = readFileSync(resolve(process.cwd(), PAGES.admin.file), 'utf8');
    expect(shell).toContain(BOOT_MARK);
    expect(shell).toContain('/src/admin/admin.ts');
    const analytics = analyticsConfig({}, { production: true, url: 'https://versus.example.com/' });
    const out = fillPage(shell, 'admin', { url: 'https://versus.example.com/', publish: true, head: [], analytics });
    expect(out).not.toContain('<!--');
    expect(out).toContain('versus-prefs');
    expect(out).not.toContain('id="analytics"');
    expect(out).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
});

describe('the page', () => {
  it('says so in a build without a server', () => {
    mount(null);
    expect($('.ad-main')?.textContent).toContain(adminEn.noApi);
    expect(calls).toHaveLength(0);
  });

  it('asks for the token, refuses a wrong one and keeps a good one in the tab', async () => {
    const { store } = mount();
    expect($('form[data-form="token"]')).not.toBeNull();
    ($('#ad-token') as HTMLInputElement).value = 'bad';
    ($('form[data-form="token"]') as HTMLFormElement).requestSubmit();
    await flush();
    expect($('.ad-error')?.textContent).toBe(adminEn.wrongToken);
    expect($('form[data-form="token"]')).not.toBeNull();
    expect(store.has('versus-admin')).toBe(false);
    calls.length = 0;
    ($('#ad-token') as HTMLInputElement).value = 'good';
    ($('form[data-form="token"]') as HTMLFormElement).requestSubmit();
    await flush();
    expect(store.get('versus-admin')).toBe('good');
    expect(requests('GET').length).toBeGreaterThan(1);
    expect(requests('GET').every((c) => c.auth === 'Bearer good')).toBe(true);
    expect($('.ad-error')).toBeNull();
    expect($('.ad-stats')?.textContent).toContain('12 votes');
    expect($('.ad-stats')?.textContent).toContain('1 reported');
    const title = $('.ad-title a');
    expect(title?.textContent).toBe('Pizzas');
    expect(title?.getAttribute('href')).toBe(`https://versus.example.com/app/b/${ALIAS}`);
    expect($('.ad-count')?.textContent).toBe('2');
    click('[data-act="logout"]');
    expect(store.has('versus-admin')).toBe(false);
    expect($('form[data-form="token"]')).not.toBeNull();
  });

  it('filters, searches and pages the list', async () => {
    mount('', 'good');
    await flush();
    click('[data-act="filter"][data-filter="reported"]');
    await flush();
    expect(requests('GET').at(-1)?.url).toContain('filter=reported&q=');
    expect($('[data-filter="reported"]')?.getAttribute('aria-selected')).toBe('true');
    ($('.ad-search input') as HTMLInputElement).value = 'none';
    ($('form[data-form="search"]') as HTMLFormElement).requestSubmit();
    await flush();
    expect(requests('GET').at(-1)?.url).toContain('offset=0&filter=reported&q=none');
    expect($('.ad-empty')?.textContent).toBe(adminEn.empty);
    ($('.ad-search input') as HTMLInputElement).value = '';
    ($('form[data-form="search"]') as HTMLFormElement).requestSubmit();
    await flush();
    // One board: nothing before, nothing after.
    expect(($('[data-act="prev"]') as HTMLButtonElement).disabled).toBe(true);
    expect(($('[data-act="next"]') as HTMLButtonElement).disabled).toBe(true);
    click('[data-act="refresh"]');
    await flush();
    expect(requests('GET').filter((c) => c.url.includes('/stats')).length).toBeGreaterThan(3);
  });

  it('inspects a board and acts on it', async () => {
    const { confirm } = mount('', 'good');
    await flush();
    click(`[data-act="inspect"][data-alias="${ALIAS}"]`);
    await flush();
    expect(requests('GET').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}`);
    const panel = $('.ad-panel');
    expect(panel?.textContent).toContain('Spam or advertising');
    expect(panel?.textContent).toContain('Ads for a pizzeria');
    expect($$('.ad-items li')).toHaveLength(3);
    expect($$('.ad-ranking li')[0]?.textContent).toContain('Regina');
    click('[data-act="hide"]');
    await flush();
    expect(requests('PATCH').at(-1)).toMatchObject({ url: `/api/admin/boards/${ALIAS}`, body: { hidden: true } });
    click('[data-act="feature"]');
    await flush();
    expect(requests('PATCH').at(-1)?.body).toEqual({ featured: true });
    click('[data-act="close"]');
    await flush();
    expect(requests('POST').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}/close`);
    click('[data-act="clear-reports"]');
    await flush();
    expect(requests('DELETE').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}/reports`);
    click('[data-act="delete-cards"]');
    await flush();
    expect(confirm).toHaveBeenLastCalledWith(adminText('en', 'confirmDeleteCards', { title: 'Pizzas' }));
    expect(requests('DELETE').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}/cards`);
    click('[data-act="remove-item"][data-id="p0"]');
    await flush();
    expect(confirm).toHaveBeenLastCalledWith(
      adminText('en', 'confirmRemove', { label: 'Margherita', title: 'Pizzas' }),
    );
    expect(requests('DELETE').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}/items/p0`);
    // The panel is still open, refreshed after each action.
    expect($('.ad-panel')).not.toBeNull();
    click('[data-act="delete"]');
    await flush();
    expect(confirm).toHaveBeenLastCalledWith(adminText('en', 'confirmTakeDown', { title: 'Pizzas' }));
    expect(requests('DELETE').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}`);
    expect($('.ad-panel')).toBeNull();
  });

  it('lists the pictures to review and sends each decision', async () => {
    const withPic = detail({ items: [{ ...(items[0] as (typeof items)[number]), pic: 'pending' }, ...items.slice(1)] });
    respond = (c) => {
      if (c.auth !== 'Bearer good') return ok(c);
      if (/\/boards\?/.test(c.url)) {
        return {
          status: 200,
          body: { boards: [row({ pictures: 1 })], limit: 50, offset: 0, filter: 'pictures', q: '' },
        };
      }
      if (c.method === 'GET' && c.url === `/api/admin/boards/${ALIAS}`) return { status: 200, body: withPic };
      return ok(c);
    };
    mount('', 'good');
    await flush();
    expect($('.ad-flags')?.textContent).toContain('Pictures to review: 1');
    expect($('[data-filter="pictures"]')?.textContent).toBe('Pictures');
    click(`[data-act="inspect"][data-alias="${ALIAS}"]`);
    await flush();
    expect($('.ad-pics li')?.textContent).toContain('Margherita');
    expect($('img[data-pic="p0"]')).not.toBeNull();
    click('[data-act="approve-pic"][data-id="p0"]');
    await flush();
    expect(requests('POST').at(-1)).toMatchObject({
      url: `/api/admin/boards/${ALIAS}/items/p0/picture`,
      body: { decision: 'ok' },
    });
    click('[data-act="refuse-pic"][data-id="p0"]');
    await flush();
    expect(requests('POST').at(-1)?.body).toEqual({ decision: 'refused' });
  });

  it('does nothing when a confirmation is refused, and says when the server is away', async () => {
    const { confirm } = mount('', 'good');
    confirm.mockReturnValue(false);
    await flush();
    click(`[data-act="inspect"][data-alias="${ALIAS}"]`);
    await flush();
    click('[data-act="delete"]');
    await flush();
    expect(requests('DELETE')).toHaveLength(0);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    click('[data-act="refresh"]');
    await flush();
    expect($('.ad-error')?.textContent).toBe(adminEn.offline);
    // A request that hangs is cut short, and says the same.
    expect(fetchMock.mock.calls.at(-1)?.[1]?.signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    click('[data-act="refresh"]');
    await flush();
    expect($('.ad-error')?.textContent).toBe(adminEn.offline);
  });
});
