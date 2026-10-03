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
type Answer = { status: number; body: unknown; headers?: Record<string, string> };
let respond: (c: Call) => Answer = () => ({ status: 404, body: { error: 'not_found' } });

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
  return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
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

/** Mounts the page; with a token, types it in the form as the admin would. */
function mount(api: string | null = '', token = '') {
  document.body.innerHTML = '<div id="admin"></div>';
  const root = $('#admin') as HTMLElement;
  const confirm = vi.fn(() => true);
  mountAdmin({
    root,
    api,
    lang: 'en',
    fetch: fetchMock as unknown as typeof fetch,
    confirm,
    boardURL: (alias) => `https://versus.example.com/app/b/${alias}`,
    locale: 'en-GB',
  });
  if (token) {
    ($('#ad-token') as HTMLInputElement).value = token;
    ($('form[data-form="token"]') as HTMLFormElement).requestSubmit();
  }
  return { root, confirm };
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

  it('asks for the token, refuses a wrong one and keeps a good one in memory only', async () => {
    sessionStorage.clear();
    localStorage.clear();
    mount();
    expect($('form[data-form="token"]')).not.toBeNull();
    // Its home link opens elsewhere: leaving the page would forget the token.
    expect($('.ad-brand')?.getAttribute('target')).toBe('_blank');
    expect($('.ad-brand')?.getAttribute('rel')).toBe('noopener');
    ($('#ad-token') as HTMLInputElement).value = 'bad';
    ($('form[data-form="token"]') as HTMLFormElement).requestSubmit();
    await flush();
    expect($('.ad-error')?.textContent).toBe(adminEn.wrongToken);
    expect($('form[data-form="token"]')).not.toBeNull();
    calls.length = 0;
    ($('#ad-token') as HTMLInputElement).value = 'good';
    ($('form[data-form="token"]') as HTMLFormElement).requestSubmit();
    await flush();
    // Nowhere a script of the site could read it later.
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
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
    expect($('form[data-form="token"]')).not.toBeNull();
    // A reload (the page mounted again) asks again.
    mount();
    await flush();
    expect($('form[data-form="token"]')).not.toBeNull();
  });

  it('filters, searches and pages the list', async () => {
    mount('', 'good');
    await flush();
    // A group of toggle buttons, one pressed; the focus stays on the one clicked once the list is drawn again.
    expect($('.ad-filters')?.getAttribute('role')).toBe('group');
    expect($('.ad-filters')?.getAttribute('aria-label')).toBe(adminEn.filters);
    expect($('[role="tab"], [role="tablist"]')).toBeNull();
    $('[data-act="filter"][data-filter="reported"]')?.focus();
    click('[data-act="filter"][data-filter="reported"]');
    await flush();
    expect(requests('GET').at(-1)?.url).toContain('filter=reported&q=');
    expect($('[data-filter="reported"]')?.getAttribute('aria-pressed')).toBe('true');
    expect($('[data-filter="all"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe($('[data-act="filter"][data-filter="reported"]'));
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
    // The actions column has a heading screen readers read.
    expect($('.ad-table thead th:last-child .ad-vh')?.textContent).toBe(adminEn.cActions);
    const details = () => $(`[data-act="details"][data-alias="${ALIAS}"]`);
    expect(details()?.getAttribute('aria-expanded')).toBe('false');
    click(`[data-act="details"][data-alias="${ALIAS}"]`);
    await flush();
    expect(requests('GET').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}`);
    expect(details()?.getAttribute('aria-expanded')).toBe('true');
    expect(details()?.getAttribute('aria-controls')).toBe(`ad-detail-${ALIAS}`);
    expect($(`#ad-detail-${ALIAS} .ad-panel`)).not.toBeNull();
    expect(document.activeElement).toBe(details());
    const panel = $('.ad-panel');
    expect(panel?.textContent).toContain('Spam or advertising');
    expect(panel?.textContent).toContain('Ads for a pizzeria');
    expect($$('.ad-items li')).toHaveLength(3);
    expect($$('.ad-ranking li')[0]?.textContent).toContain('Regina');
    // A double click sends one request; the focus comes back to the same control once the page is drawn again.
    calls.length = 0;
    click('[data-act="hide"]');
    expect(($('[data-act="hide"]') as HTMLButtonElement).disabled).toBe(true);
    expect($('[data-act="hide"]')?.getAttribute('aria-busy')).toBe('true');
    ($('[data-act="hide"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(requests('PATCH')).toHaveLength(1);
    expect(requests('PATCH').at(-1)).toMatchObject({ url: `/api/admin/boards/${ALIAS}`, body: { hidden: true } });
    expect(document.activeElement).toBe($('[data-act="hide"]'));
    expect($('[data-act="hide"]')?.hasAttribute('aria-busy')).toBe(false);
    click('[data-act="feature"]');
    await flush();
    expect(requests('PATCH').at(-1)?.body).toEqual({ featured: true });
    click('[data-act="close"]');
    await flush();
    expect(requests('POST').at(-1)?.url).toBe(`/api/admin/boards/${ALIAS}/close`);
    click('[data-act="clear-reports"]');
    await flush();
    expect(confirm).toHaveBeenLastCalledWith(adminText('en', 'confirmClearReports', { title: 'Pizzas' }));
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
    // Its button is gone with the panel: the focus goes to the board's details toggle, closed.
    expect(document.activeElement).toBe(details());
    expect(details()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('lists the pictures to review and sends each decision, an approval with the picture it saw', async () => {
    const withPic = detail({ items: [{ ...(items[0] as (typeof items)[number]), pic: 'pending' }, ...items.slice(1)] });
    const image = `/api/admin/boards/${ALIAS}/items/p0/image`;
    let etag = '"e1"';
    let approve: Answer = { status: 200, body: true };
    respond = (c) => {
      if (c.auth !== 'Bearer good') return ok(c);
      if (/\/boards\?/.test(c.url)) {
        return {
          status: 200,
          body: { boards: [row({ pictures: 1 })], limit: 50, offset: 0, filter: 'pictures', q: '' },
        };
      }
      if (c.method === 'GET' && c.url === `/api/admin/boards/${ALIAS}`) return { status: 200, body: withPic };
      if (c.url === image) return { status: 200, body: 'jpeg', headers: { ETag: etag } };
      if (c.url.endsWith('/picture')) return approve;
      return ok(c);
    };
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:picture';
    URL.revokeObjectURL = () => {};
    const { confirm } = mount('', 'good');
    await flush();
    expect($('.ad-flags')?.textContent).toContain('Pictures to review: 1');
    expect($('[data-filter="pictures"]')?.textContent).toBe('Pictures');
    click(`[data-act="details"][data-alias="${ALIAS}"]`);
    await flush();
    expect($('.ad-pics li')?.textContent).toContain('Margherita');
    expect($('img[data-pic="p0"]')?.getAttribute('src')).toBe('blob:picture');
    // The author sent another picture meanwhile: the server says so, and the page shows the new one.
    approve = { status: 409, body: { error: 'changed' } };
    etag = '"e2"';
    click('[data-act="approve-pic"][data-id="p0"]');
    await flush();
    expect(requests('POST').at(-1)).toMatchObject({
      url: `/api/admin/boards/${ALIAS}/items/p0/picture`,
      body: { decision: 'ok', etag: '"e1"' },
    });
    expect($('.ad-error')?.textContent).toBe(adminEn.picChanged);
    expect(calls.filter((c) => c.url === image).length).toBeGreaterThan(1);
    approve = { status: 200, body: true };
    click('[data-act="approve-pic"][data-id="p0"]');
    await flush();
    expect(requests('POST').at(-1)?.body).toEqual({ decision: 'ok', etag: '"e2"' });
    // Refusing deletes the picture: asked first, nothing sent when the admin says no.
    const posts = requests('POST').length;
    confirm.mockReturnValueOnce(false);
    click('[data-act="refuse-pic"][data-id="p0"]');
    await flush();
    expect(confirm).toHaveBeenLastCalledWith(adminText('en', 'confirmRefuse', { label: 'Margherita' }));
    expect(requests('POST')).toHaveLength(posts);
    click('[data-act="refuse-pic"][data-id="p0"]');
    await flush();
    expect(requests('POST').at(-1)?.body).toEqual({ decision: 'refused' });
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  it('does nothing when a confirmation is refused, and says when the server is away', async () => {
    const { confirm } = mount('', 'good');
    confirm.mockReturnValue(false);
    await flush();
    click(`[data-act="details"][data-alias="${ALIAS}"]`);
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
