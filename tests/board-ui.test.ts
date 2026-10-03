// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BoardView, ClientMessage, ItemScore, RankingView, ServerMessage } from '../src/core/protocol';
import type { Ranking } from '../src/core/types';
import { installFakeCanvas } from './helpers/canvas';

/** The publish modal and the board page, against a fake API and fake WebSockets. */

const ALIAS = 'Ab3dEf7hJk';
const OWNER = 'b'.repeat(64);

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: ClientMessage[] = [];
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn];
  }
  private emit(type: string, e: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }
  receive(msg: ServerMessage): void {
    this.emit('message', { data: JSON.stringify(msg) });
  }
  drop(code: number): void {
    this.readyState = 3;
    this.emit('close', { code });
  }
  static last(): FakeSocket {
    const s = FakeSocket.all.at(-1);
    if (!s) throw new Error('no socket');
    return s;
  }
}

type Call = { method: string; url: string; body: unknown; auth: string | null };
const calls: Call[] = [];
let respond: (c: Call) => { status: number; body: unknown } = () => ({ status: 404, body: { error: 'not_found' } });

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};
const flush = () => vi.advanceTimersByTimeAsync(0);
const change = (el: HTMLInputElement) => el.dispatchEvent(new Event('change', { bubbles: true }));

const items = ['Margherita', 'Regina', 'Calzone'].map((label, i) => ({
  id: `p${i}`,
  label,
  img: null,
  fill: null,
  h: 10,
}));
const ranking = (order: string[]): RankingView => ({
  method: 'bt',
  order,
  stats: Object.fromEntries(order.map((id, i) => [id, { score: 1600 - i * 100, se: 20, w: 0, l: 0, d: 0 }])),
});
const view = (over: Partial<BoardView> = {}): BoardView => ({
  title: 'Pizzas',
  items,
  settings: { method: 'bt', visibility: 'always', revealAfter: 2, allowChange: true, visitorsAddItems: false },
  status: 'open',
  created: 1,
  counts: { votes: 3, voters: 2, online: 2 },
  ranking: ranking(['p0', 'p1', 'p2']),
  ...over,
});
const state = (over: Partial<BoardView> = {}, owner = false): ServerMessage => ({
  t: 'state',
  board: view(over),
  owner,
  mine: [],
  pairs: [
    ['p0', 'p1'],
    ['p1', 'p2'],
    ['p0', 'p2'],
  ],
});
const stored = (): Ranking[] => JSON.parse(localStorage.getItem('versus-v1') ?? '[]');
const labels = (): string[] =>
  [...document.querySelectorAll<HTMLInputElement>('#item-list .row-label')].map((i) => i.value);
const submit = (v: string) => {
  ($('#add-input') as HTMLInputElement).value = v;
  $('#add-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};
const paste = (text: string) => {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files: [], getData: () => text } });
  $('#add-input')?.dispatchEvent(e);
  return e.defaultPrevented;
};
/** A ranking where the given items have that many votes each. */
const voted = (votes: Record<string, number>): RankingView => {
  const rv = ranking(['p0', 'p1', 'p2']);
  for (const [id, n] of Object.entries(votes)) (rv.stats[id] as ItemScore).w = n;
  return rv;
};

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      // The Popular section asks on its own; here it stays empty and out of the calls.
      if (url.includes('/api/popular')) return Response.json({ boards: [] });
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call = {
        method: init.method ?? 'GET',
        url,
        // A card upload sends the image itself; everything else is JSON.
        body:
          init.body instanceof Blob ? { blob: init.body.type } : init.body ? JSON.parse(String(init.body)) : undefined,
        auth: headers.Authorization ?? null,
      };
      calls.push(call);
      const r = respond(call);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  installFakeCanvas();
  window.scrollTo = () => {};
  localStorage.clear();
  const withImage: Ranking = {
    id: 'with-image',
    title: 'Photos',
    method: 'bt',
    items: [
      { id: 'i1', label: 'Beach', img: 'data:image/jpeg;base64,', fill: null, h: 1 },
      { id: 'i2', label: 'Hills', img: null, fill: null, h: 2 },
    ],
    history: [],
    pair: null,
    created: 1,
    updated: 1,
  };
  localStorage.setItem('versus-v1', JSON.stringify([withImage]));
  document.body.innerHTML = body;
  const { mount } = await import('../src/app/ui');
  mount(document);
});

afterEach(() => {
  calls.length = 0;
});

describe('publishing', () => {
  it('refuses a ranking with images, saying why', async () => {
    click('.rcard [data-action="open"][data-id="with-image"][data-tab="duel"]');
    click('[data-action="publish"]');
    // The server is asked first whether it takes pictures.
    await flush();
    expect($('#m-title')?.textContent).toBe('Can’t publish yet');
    expect($('#m-body')?.textContent).toContain('Remove the images');
    expect($('#m-cancel')?.hidden).toBe(true);
    click('#m-ok');
    // The server was asked whether it takes pictures (it doesn't here), nothing else.
    expect(calls.map((c) => c.url)).toEqual(['/api/config']);
    click('[data-action="back"]');
  });

  it('publishes with the chosen settings and opens the board as its author', async () => {
    click('.g-head [data-action="new-rank"]');
    const input = $('#add-input') as HTMLInputElement;
    for (const v of ['Margherita', 'Regina', 'Calzone']) {
      input.value = v;
      $('#add-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    click('[data-action="pick"][data-side="a"]');
    await vi.advanceTimersByTimeAsync(600);
    click('[data-action="publish"]');
    expect($('#m-title')?.textContent).toBe('Publish this ranking?');
    expect($('#m-body .opt.off[aria-disabled="true"]')?.textContent).toContain('Exact sort');
    expect(document.querySelector('#m-body input[value="sort"]')).toBeNull();
    expect(($('#pub-votes') as HTMLInputElement).checked).toBe(true);
    ($('#m-body input[name="pub-vis"][value="after"]') as HTMLInputElement).checked = true;
    ($('#pub-n') as HTMLInputElement).value = '4';
    respond = (c) =>
      c.method === 'PUT'
        ? { status: 201, body: { url: `http://localhost:3000/og/b/${ALIAS}/1.png` } }
        : { status: 201, body: { alias: ALIAS, owner: OWNER } };
    click('#m-ok');
    await flush();

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/boards');
    expect(post?.body).toMatchObject({
      settings: { visibility: 'after', revealAfter: 4, method: 'bt', allowChange: true },
      lang: 'en',
    });
    expect((post?.body as { duels?: unknown[] } | undefined)?.duels).toHaveLength(1);
    // The link's preview card, drawn here and sent right after publishing.
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: `/api/boards/${ALIAS}/card`,
      body: { blob: 'image/png' },
      auth: `Bearer ${OWNER}`,
    });
    expect(location.pathname).toBe(`/b/${ALIAS}`);
    expect(JSON.parse(localStorage.getItem('versus-owners') ?? '{}')[ALIAS]).toBe(OWNER);
    expect(stored().find((r) => r.pub)?.pub).toEqual({ alias: ALIAS, status: 'open' });
    expect($('#view')?.textContent).toContain('Connecting…');

    const ws = FakeSocket.last();
    expect(ws.url).toBe(`ws://localhost:3000/api/boards/${ALIAS}`);
    ws.open();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', owner: OWNER });
    ws.receive(state({}, true));
    // Its author gets the workspace of a local ranking (D116): the title, the score, the items pane.
    expect(($('#rank-title') as HTMLInputElement).value).toBe('Pizzas');
    expect($('.ws')?.dataset.alias).toBe(ALIAS);
    expect($('[data-action="b-settings"]')?.textContent).toContain('Published');
    expect($('#b-counts')?.textContent).toContain('3 votes');
    expect(labels()).toEqual(['Margherita', 'Regina', 'Calzone']);
    click('.tab[data-tab="results"]');
    expect(document.querySelectorAll('#b-rank .b-rows li')).toHaveLength(3);
    click('.tab[data-tab="duel"]');
    expect($('#b-main .card-a')).not.toBeNull();
  });
});

describe('voting', () => {
  it('sends votes on the queued pair and reverts a refused undo', async () => {
    const ws = FakeSocket.last();
    click('[data-action="b-pick"][data-side="a"]');
    expect(ws.sent.at(-1)).toEqual({ t: 'vote', a: 'p0', b: 'p1', s: 1 });
    ws.receive({ t: 'pairs', pairs: [['p1', 'p2']], mine: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect($('.eyebrow')?.textContent).toContain('Your votes: 1');
    click('[data-action="b-undo"]');
    expect(ws.sent.at(-1)).toEqual({ t: 'undo', a: 'p0', b: 'p1' });
    expect(($('[data-action="b-undo"]') as HTMLButtonElement).disabled).toBe(true);
    ws.receive({ t: 'error', code: 'final' });
    ws.receive({ t: 'pairs', pairs: [['p1', 'p2']], mine: 1 });
    expect($('#toast')?.textContent).toBe('Votes are final on this ranking.');
    expect(($('[data-action="b-undo"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('follows the keyboard', async () => {
    const ws = FakeSocket.last();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(ws.sent.at(-1)).toEqual({ t: 'skip', a: 'p1', b: 'p2' });
    ws.receive({ t: 'pairs', pairs: [['p0', 'p2']], mine: 1 });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(ws.sent.at(-1)).toEqual({ t: 'vote', a: 'p0', b: 'p2', s: 0.5 });
    ws.receive({ t: 'pairs', pairs: [], mine: 3 });
    await vi.advanceTimersByTimeAsync(600);
    expect($('#fin h1')?.textContent).toBe('You voted on every pair');
  });

  it('shows the result on a page of its own after the last vote, in two views', async () => {
    const ws = FakeSocket.last();
    // The podium: the crowd's, then the voter's own.
    expect(document.querySelectorAll('#fin .fin-pd')).toHaveLength(3);
    expect($('#fin .fin-pd-1 .fin-tile')?.textContent).toBe('Margherita');
    expect($('#fin .fin-num [data-count]')?.dataset.count).toBe('3');
    expect($('#fin .fin-num small')?.textContent).toBe('/3');
    click('[data-action="b-finale-who"][data-who="me"]');
    expect($('#fin-pod-h')?.textContent).toBe('Your podium');
    expect($('#fin .fin-pd-1 .fin-pd-meta')?.textContent).toContain('1W 0L');

    // Face à face, remembered in this browser.
    click('[data-action="b-finale-view"][data-view="duo"]');
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').resultView).toBe('duo');
    expect($('#fin h1')?.textContent).toBe('The crowd chose Margherita.');
    expect(document.querySelectorAll('#fin .fin-mine li')).toHaveLength(3);
    expect(document.querySelectorAll('#fin .fin-lines path')).toHaveLength(3);

    // Live: a new crowd order shows at once; the keyboard doesn't vote here.
    ws.receive({ t: 'ranking', counts: { votes: 9, voters: 3, online: 2 }, ranking: ranking(['p2', 'p1', 'p0']) });
    expect($('#fin h1')?.textContent).toBe('The crowd chose Calzone.');
    expect($('#fin-counts')?.textContent).toContain('9 votes');
    const sent = ws.sent.length;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(ws.sent).toHaveLength(sent);
    ws.receive({ t: 'ranking', counts: { votes: 9, voters: 3, online: 2 }, ranking: ranking(['p0', 'p1', 'p2']) });

    // Back to the board, and to the result again.
    click('[data-action="b-finale-close"]');
    expect($('#fin')).toBeNull();
    expect($('#b-main')?.textContent).toContain('You voted on every pair');
    click('[data-action="b-finale"]');
    expect($('#fin h1')?.textContent).toBe('The crowd chose Margherita.');
    click('[data-action="b-finale-close"]');
  });

  it('keeps the crowd for the closing on a blind board, showing the voter their own ranking', () => {
    const ws = FakeSocket.last();
    const blind = { settings: { ...view().settings, visibility: 'blind' as const }, ranking: null };
    const mine = [
      { a: 'p2', b: 'p0', s: 1 as const },
      { a: 'p2', b: 'p1', s: 1 as const },
      { a: 'p1', b: 'p0', s: 1 as const },
    ];
    ws.receive({ ...state(blind), mine, pairs: [] } as ServerMessage);
    click('[data-action="b-finale"]');
    expect($('#fin h1')?.textContent).toBe('Your winner: Calzone.');
    expect(document.querySelectorAll('#fin .fin-ph')).toHaveLength(3);
    expect($('#fin .fin-locked')).not.toBeNull();
    click('[data-action="b-finale-view"][data-view="podium"]');
    expect($('#fin-pod-h')?.textContent).toBe('Your podium');
    expect($('[data-action="b-finale-who"]')).toBeNull();
    // Shared, it is the voter's podium alone: nothing else to pick.
    click('[data-action="share-finale"]');
    expect($('[data-action="share-view"]')).toBeNull();
    expect($('.share-msg')?.textContent).toContain('Pizzas · 3 votes · You');
    click('#m-ok');
    click('[data-action="b-finale-close"]');
    ws.receive(state());
  });

  it('holds the ranking while live updates are off', () => {
    const ws = FakeSocket.last();
    const liveBox = $('#b-live') as HTMLInputElement;
    liveBox.checked = false;
    change(liveBox);
    ws.receive({ t: 'ranking', counts: { votes: 5, voters: 2, online: 2 }, ranking: ranking(['p2', 'p1', 'p0']) });
    expect($('#b-counts')?.textContent).toContain('5 votes');
    expect($('#b-rank .rlabel')?.textContent).toBe('Margherita');
    click('[data-action="b-refresh"]');
    expect($('#b-rank .rlabel')?.textContent).toBe('Calzone');
    const again = $('#b-live') as HTMLInputElement;
    again.checked = true;
    change(again);
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').live).toBe(true);
  });

  it('says how many votes reveal the ranking', () => {
    const ws = FakeSocket.last();
    ws.receive({
      ...state({ settings: { ...view().settings, visibility: 'after' }, ranking: null }),
      mine: [{ a: 'p0', b: 'p1', s: 1 }],
    } as ServerMessage);
    expect($('#b-rank')?.textContent).toContain('after 2 of your votes (1/2)');
    ws.receive({ ...state({ settings: { ...view().settings, visibility: 'blind' }, ranking: null }) } as ServerMessage);
    expect($('#b-rank')?.textContent).toContain('hidden until the author closes the vote');
  });

  it('lets visitors suggest items when the author allows it, with the same field', () => {
    const ws = FakeSocket.last();
    ws.receive(state({ settings: { ...view().settings, visitorsAddItems: true } }));
    expect($('.b-suggest #add-input')).not.toBeNull();
    submit('#ff8800');
    expect(ws.sent.at(-1)).toEqual({
      t: 'add',
      item: { label: '#FF8800', fill: { type: 'solid', colors: ['#ff8800'] } },
    });
    ws.receive({ t: 'error', code: 'too_fast' });
    ws.receive({ t: 'pairs', pairs: [], mine: 0 });
    expect($('#toast')?.textContent).toBe('Wait a few seconds before adding another item.');
    expect(($('#add-input') as HTMLInputElement).value).toBe('#ff8800');
    ws.receive(state());
    expect($('#add-input')).toBeNull();
  });

  it('draws a skipped duel once, even when the server confirms it late', () => {
    const ws = FakeSocket.last();
    click('[data-action="b-skip"]');
    expect(ws.sent.at(-1)).toEqual({ t: 'skip', a: 'p0', b: 'p1' });
    const stage = $('#stage');
    expect($('#stage .card-a')?.dataset.id).toBe('p1');
    // The same pair from the server: the cards keep entering, they don't start over.
    ws.receive({
      t: 'pairs',
      pairs: [
        ['p1', 'p2'],
        ['p0', 'p2'],
      ],
      mine: 0,
    });
    expect($('#stage')).toBe(stage);
    // Another pair does show.
    ws.receive({ t: 'pairs', pairs: [['p0', 'p2']], mine: 0 });
    expect($('#stage')).not.toBe(stage);
    expect($('#stage .card-a')?.dataset.id).toBe('p0');
  });

  it('says a new version is out when the server no longer serves this one', () => {
    FakeSocket.last().receive({ t: 'error', code: 'upgrade' });
    expect($('#toast')?.textContent).toBe('A new version of Versus is out: reload the page to keep voting.');
  });

  it('says so when the server turns a vote away for too many new voters', async () => {
    const ws = FakeSocket.last();
    ws.receive(state());
    click('[data-action="b-pick"][data-side="a"]');
    ws.receive({ t: 'error', code: 'rate_limited' });
    ws.receive({ t: 'pairs', pairs: [['p0', 'p1']], mine: 0 });
    expect($('#toast')?.textContent).toBe('Too many attempts. Try again in a minute.');
    await vi.advanceTimersByTimeAsync(600);
  });
});

describe('author', () => {
  it('adds one item or a pasted list, then removes items as the author', async () => {
    const ws = FakeSocket.last();
    ws.receive(state({}, true));
    const added = (label: string) => ({ id: `n-${label}`, label, img: null, fill: null, h: 1 });
    respond = (c) => {
      if (c.method === 'POST') {
        const list = (c.body as { items?: { label: string }[] }).items;
        return { status: 200, body: list ? list.map((x) => added(x.label)) : added('Hawaii') };
      }
      return { status: 200, body: 0 };
    };
    submit('Hawaii');
    await flush();
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: `/api/boards/${ALIAS}/items`,
      body: { label: 'Hawaii', fill: null },
      auth: `Bearer ${OWNER}`,
    });
    expect($('#toast')?.textContent).toBe('Item added');
    expect(($('#add-input') as HTMLInputElement).value).toBe('');

    // A list adds its new labels in one request, and can be undone.
    expect(paste('- Quattro\n- regina\n- Napoli')).toBe(true);
    await flush();
    expect(calls.at(-1)?.body).toEqual({
      items: [
        { label: 'Quattro', fill: null },
        { label: 'Napoli', fill: null },
      ],
    });
    expect($('#toast')?.textContent).toBe('2 items added · 1 duplicate skippedUndo');
    calls.length = 0;
    click('[data-action="toast-act"]');
    await flush();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE /api/boards/${ALIAS}/items/n-Quattro`,
      `DELETE /api/boards/${ALIAS}/items/n-Napoli`,
    ]);

    // Without votes an item goes at once, and Undo brings it back.
    click('[data-action="remove-item"][data-id="p1"]');
    expect($('#modal')?.hidden).toBe(true);
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `/api/boards/${ALIAS}/items/p1` });
    expect($('#toast')?.textContent).toBe('“Regina” removed.Undo');
    click('[data-action="toast-act"]');
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { label: 'Regina', fill: null } });

    // With votes, after a confirmation.
    ws.receive(state({ ranking: voted({ p0: 2 }) }, true));
    expect($('#item-list li[data-id="p0"] .rt')?.textContent).toBe('2 votes');
    respond = () => ({ status: 409, body: { error: 'too_few' } });
    click('[data-action="remove-item"][data-id="p0"]');
    expect($('#m-title')?.textContent).toBe('Remove Margherita?');
    expect($('#m-body')?.textContent).toBe('Its 2 votes will be deleted for everyone.');
    click('#m-ok');
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `/api/boards/${ALIAS}/items/p0` });
    expect($('#toast')?.textContent).toBe('A published ranking keeps at least 2 items.');
  });

  it('renames an item: at once without votes, asking what its votes become otherwise', async () => {
    const ws = FakeSocket.last();
    ws.receive(state({ ranking: voted({ p0: 3 }) }, true));
    respond = (c) => ({ status: 200, body: (c.body as { reset?: boolean }).reset ? 3 : 0 });
    const rename = (id: string, v: string) => {
      const input = $(`#item-list .row-label[data-id="${id}"]`) as HTMLInputElement;
      input.value = v;
      change(input);
      return input;
    };
    rename('p2', ' Calzone fritto ');
    await flush();
    expect($('#modal')?.hidden).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      url: `/api/boards/${ALIAS}/items/p2`,
      body: { label: 'Calzone fritto', reset: false },
      auth: `Bearer ${OWNER}`,
    });

    // With votes: kept by default (a correction)…
    rename('p0', 'Marinara');
    expect($('#m-title')?.textContent).toBe('Rename “Margherita” to “Marinara”?');
    expect($('#m-body p')?.textContent).toBe('Margherita has 3 votes. What happens to them?');
    expect(($('#m-body input[value="keep"]') as HTMLInputElement).checked).toBe(true);
    click('#m-ok');
    await flush();
    expect(calls.at(-1)?.body).toEqual({ label: 'Marinara', reset: false });
    expect($('#toast')?.textContent).toBe('Renamed. Votes kept: 3.');

    // …or dropped (another choice).
    rename('p0', 'Sushi');
    ($('#m-body input[value="reset"]') as HTMLInputElement).checked = true;
    click('#m-ok');
    await flush();
    expect(calls.at(-1)?.body).toEqual({ label: 'Sushi', reset: true });
    expect($('#toast')?.textContent).toBe('Renamed. Sushi starts again from zero.');

    // Cancelled, or a name already there: the name goes back, nothing is sent.
    calls.length = 0;
    const input = rename('p0', 'Pepperoni');
    click('#m-cancel');
    await flush();
    expect(input.value).toBe('Margherita');
    rename('p2', 'regina');
    expect($('#toast')?.textContent).toBe('This item is already there.');
    expect(($('#item-list .row-label[data-id="p2"]') as HTMLInputElement).value).toBe('Calzone');
    expect(calls).toHaveLength(0);
  });

  it('keeps what the author is typing when the board changes', () => {
    const ws = FakeSocket.last();
    ws.receive(state({}, true));
    const input = $('#item-list .row-label[data-id="p1"]') as HTMLInputElement;
    input.focus();
    input.value = 'Regina Mar';
    ($('#add-input') as HTMLInputElement).value = 'Bianca';
    ws.receive({ t: 'ranking', counts: { votes: 4, voters: 2, online: 2 }, ranking: ranking(['p1', 'p0', 'p2']) });
    ws.receive(state({ counts: { votes: 4, voters: 3, online: 2 } }, true));
    expect(($('#item-list .row-label[data-id="p1"]') as HTMLInputElement).value).toBe('Regina Mar');
    expect(document.activeElement).toBe($('#item-list .row-label[data-id="p1"]'));
    expect(($('#add-input') as HTMLInputElement).value).toBe('Bianca');
    ($('#add-input') as HTMLInputElement).value = '';
    (document.activeElement as HTMLElement).blur();
  });

  it('recolors a color item: a draft until validated, then the author says what its votes become', async () => {
    const ws = FakeSocket.last();
    const red = { type: 'solid' as const, colors: ['#aa0000'] };
    const colored = [{ ...items[0], label: 'Rouge', fill: red }, { ...items[1], label: 'Carmin', fill: red }, items[2]];
    ws.receive(state({ items: colored, ranking: voted({ p1: 2 }) } as Partial<BoardView>, true));
    expect($('#item-list li[data-id="p0"] .row-note')?.textContent).toBe('Same color as Carmin');
    expect(document.querySelectorAll('#item-list [data-action="edit-color"]')).toHaveLength(2);
    calls.length = 0;

    const edit = (hexValue: string) => {
      click('[data-action="edit-color"][data-id="p1"]');
      expect($('#cp-twin')?.textContent).toBe('Same color as Rouge');
      const hex = $('#cpop .cp-hex') as HTMLInputElement;
      hex.value = hexValue;
      hex.dispatchEvent(new Event('input', { bubbles: true }));
      change(hex);
      expect($('#cp-twin')?.hidden).toBe(true);
    };
    edit('#2743F5');
    click('[data-action="cp-cancel"]');
    expect($('#cpop')?.hidden).toBe(true);
    expect(calls).toHaveLength(0);

    edit('2743f5');
    respond = () => ({ status: 200, body: 2 });
    click('[data-action="cp-ok"]');
    expect($('#m-title')?.textContent).toBe('Change the color of Carmin?');
    expect($('#m-body p')?.textContent).toBe('Carmin has 2 votes, cast on the old color. What happens to them?');
    // The color is the item: starting again is checked first.
    expect(($('#m-body input[value="reset"]') as HTMLInputElement).checked).toBe(true);
    click('#m-ok');
    await flush();
    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      url: `/api/boards/${ALIAS}/items/p1`,
      body: { fill: { type: 'solid', colors: ['#2743f5'] }, reset: true },
      auth: `Bearer ${OWNER}`,
    });
    expect($('#toast')?.textContent).toBe('Color changed. Carmin starts again from zero.');

    // An item without votes changes without a question.
    respond = () => ({ status: 200, body: 0 });
    click('[data-action="edit-color"][data-id="p0"]');
    ($('#cpop .cp-sw') as HTMLElement).click();
    click('[data-action="cp-ok"]');
    await flush();
    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      url: `/api/boards/${ALIAS}/items/p0`,
      body: { reset: false },
    });
    expect($('#toast')?.textContent).toBe('Color changed');

    // A closed vote: the list is read-only, and says how to change it.
    ws.receive(state({ items: colored, status: 'closed' } as Partial<BoardView>, true));
    expect($('#item-list [data-action="edit-color"]')).toBeNull();
    expect($('#item-list .row-label')).toBeNull();
    expect($('#add-input')).toBeNull();
    expect($('.ed-frozen')?.textContent).toContain('The vote is closed: reopen it to change the items.');
    expect($('.ed-frozen [data-action="b-reopen"]')).not.toBeNull();
  });

  it('renames the board, switches its method and saves its settings through the API', async () => {
    const ws = FakeSocket.last();
    ws.receive(state({}, true));
    calls.length = 0;
    respond = (c) => ({ status: 200, body: c.method === 'PATCH' ? view().settings : 'closed' });
    const title = $('#rank-title') as HTMLInputElement;
    title.value = ' Pizzas du vendredi ';
    change(title);
    await flush();
    expect(calls.at(-1)).toMatchObject({
      method: 'PATCH',
      url: `/api/boards/${ALIAS}`,
      body: { title: 'Pizzas du vendredi' },
    });
    // An empty title puts the current one back.
    title.value = ' ';
    change(title);
    expect(title.value).toBe('Pizzas');
    expect(calls).toHaveLength(1);

    // The score menu offers the crowd's methods; Exact sort is shown, and can't be picked.
    click('[data-action="method-menu"]');
    expect($('.mopt[data-m="sort"]')?.getAttribute('aria-disabled')).toBe('true');
    click('.mopt[data-m="sort"]');
    click('.mopt[data-m="elo"]');
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { method: 'elo' } });
    expect($('#toast')?.textContent).toBe('Dynamic method: ranking recalculated');

    click('[data-action="b-settings"]');
    expect($('#m-title')?.textContent).toBe('Published ranking settings');
    expect($('#b-settings input[name="b-m"]')).toBeNull();
    const blind = $('#b-settings input[name="b-vis"][value="blind"]') as HTMLInputElement;
    blind.checked = true;
    change(blind);
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: `/api/boards/${ALIAS}`, auth: `Bearer ${OWNER}` });
    expect(calls.at(-1)?.body).toMatchObject({ visibility: 'blind' });
    // Closing the vote from the settings closes them first.
    click('#b-settings [data-action="b-close"]');
    expect($('#modal')?.hidden).toBe(true);
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `/api/boards/${ALIAS}/close` });
    ws.receive(state({ status: 'closed' }, true));
    expect($('[data-action="b-settings"]')?.classList.contains('pub-closed')).toBe(true);
    expect($('#b-main')?.textContent).toContain('The vote is closed');
    expect(stored().find((r) => r.pub)?.pub?.status).toBe('closed');
    // The local ranking follows the board's title.
    ws.receive(state({ title: 'Pizzas du vendredi', status: 'closed' }, true));
    expect(stored().find((r) => r.pub)?.title).toBe('Pizzas du vendredi');
  });

  it('withdraws into a local copy with the crowd votes', async () => {
    const copy = {
      id: 'x',
      title: 'Pizzas du vendredi',
      method: 'elo',
      items,
      history: [
        { a: 'p0', b: 'p1', s: 1 },
        { a: 'p1', b: 'p2', s: 0 },
      ],
      pair: null,
      created: 1,
      updated: 1,
    };
    respond = () => ({ status: 200, body: copy });
    click('[data-action="b-settings"]');
    click('#b-settings [data-action="b-withdraw"]');
    expect($('#m-title')?.textContent).toBe('Withdraw this ranking?');
    click('#m-ok');
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', auth: `Bearer ${OWNER}` });
    const local = stored().find((r) => r.title === 'Pizzas du vendredi' && r.history.length === 2);
    expect(local?.pub).toBeUndefined();
    expect(local?.method).toBe('elo');
    expect(location.pathname).toMatch(/^\/r\/\w+\/ranking$/);
    expect($('.results')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('versus-owners') ?? '{}')[ALIAS]).toBeUndefined();
  });
});

describe('links', () => {
  it('opens an admin link as the author and keeps the token out of the URL', async () => {
    localStorage.removeItem('versus-owners');
    history.pushState(null, '', `/b/${ALIAS}#owner=${OWNER}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(location.pathname).toBe(`/b/${ALIAS}`);
    expect(location.hash).toBe('');
    expect(JSON.parse(localStorage.getItem('versus-owners') ?? '{}')[ALIAS]).toBe(OWNER);
    const ws = FakeSocket.last();
    ws.open();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', owner: OWNER });
  });

  it('reads an admin link written before paths, and moves it to the board’s address', async () => {
    history.pushState(null, '', '/');
    location.hash = `#/b/${ALIAS}?owner=${OWNER}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(location.pathname).toBe(`/b/${ALIAS}`);
    expect(location.hash).toBe('');
    const ws = FakeSocket.last();
    ws.open();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', owner: OWNER });
  });

  it('shows a withdrawn board as gone', async () => {
    const ws = FakeSocket.last();
    ws.receive(state());
    ws.drop(4004);
    expect($('#view')?.textContent).toContain('doesn’t exist or was withdrawn');
    click('.board [data-action="back"]');
    expect($('h1')?.textContent).toBe('Your rankings');
  });

  it('lets the author take back the local version of a board that is gone', async () => {
    const local = stored().find((r) => r.title === 'Pizzas du vendredi' && r.history.length === 2) as Ranking;
    click('[data-action="back"]');
    click(`.rcard [data-action="open"][data-id="${local.id}"][data-tab="duel"]`);
    click('[data-action="publish"]');
    respond = () => ({ status: 201, body: { alias: 'Zz3dEf7hJk', owner: OWNER } });
    click('#m-ok');
    await flush();
    FakeSocket.last().drop(4004);
    // Nothing is dropped until the author decides.
    expect(stored().find((r) => r.id === local.id)?.pub?.alias).toBe('Zz3dEf7hJk');
    click('[data-action="b-unlink"]');
    expect(stored().find((r) => r.id === local.id)?.pub).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('versus-owners') ?? '{}').Zz3dEf7hJk).toBeUndefined();
    expect(($('#rank-title') as HTMLInputElement).value).toBe('Pizzas du vendredi');
  });

  it('asks the API when the connection fails and reconnects if the board exists', async () => {
    location.hash = `#/b/${ALIAS}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state());
    respond = () => ({ status: 200, body: view() });
    ws.drop(1006);
    await flush();
    expect(($('#b-conn') as HTMLElement).hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(FakeSocket.last()).not.toBe(ws);
  });
});

describe('your votes', () => {
  const VISITED = 'Vs3dEf7hJk';
  const joined = () => JSON.parse(localStorage.getItem('versus-joined') ?? '[]');

  it('keeps a card for a board voted on, from the first vote', async () => {
    location.hash = `#/b/${VISITED}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state({ settings: { ...view().settings, visibility: 'blind' }, ranking: null }));
    // Opening a link is not enough.
    expect(joined()).toEqual([]);
    click('[data-action="b-pick"][data-side="b"]');
    ws.receive({ t: 'pairs', pairs: [['p1', 'p2']], mine: 1 });
    expect(joined()).toMatchObject([{ alias: VISITED, title: 'Pizzas', count: 1, mine: [{ a: 'p0', b: 'p1', s: 0 }] }]);
    expect($('#toast')?.textContent).toBe('Kept in your gallery, under “Your votes”.');
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').joinedHint).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
  });

  it('shows the card under "Your votes", then forgets it with an undo', async () => {
    respond = (c) =>
      c.url === '/api/summaries' ? { status: 503, body: { error: 'network' } } : { status: 404, body: {} };
    click('.board [data-action="back"]');
    await flush();
    expect(calls.find((c) => c.url === '/api/summaries')?.body).toEqual({
      voter: expect.any(String),
      aliases: [VISITED],
    });
    expect($('.votes-head h2')?.textContent).toBe('Your votes 1');
    const card = $(`.rcard:has([data-action="forget"][data-alias="${VISITED}"])`);
    // Blind board: the card shows the voter's own top, never the crowd's.
    expect(card?.querySelector('.mosaic-cap')?.textContent).toBe('Your top');
    expect(card?.querySelector('.tile.first b')?.textContent).toBe('Regina');
    expect(card?.querySelector('.lead')?.textContent).toBe('Hidden until the vote closes');
    expect(card?.querySelector('.stab-line .mono')?.textContent).toBe('1/3');

    click(`[data-action="forget"][data-alias="${VISITED}"]`);
    expect($('.votes-head')).toBeNull();
    expect(joined()).toEqual([]);
    expect($('#toast')?.textContent).toBe('“Pizzas” forgotten.Undo');
    click('[data-action="toast-act"]');
    expect(joined()).toHaveLength(1);
    expect($('.votes-head')).not.toBeNull();
  });

  it('opens the board from its card', () => {
    click(`.rcard-main[data-action="open-board"][data-alias="${VISITED}"]`);
    expect(location.pathname).toBe(`/b/${VISITED}`);
    click('.board [data-action="back"]');
  });

  it('starts a ranking of your own from a card, with the items and no votes', () => {
    click(`[data-action="make-mine"][data-alias="${VISITED}"]`);
    expect($('#toast')?.textContent).toBe('Your own version, ready to change and publish');
    expect(($('#rank-title') as HTMLInputElement).value).toBe('Pizzas');
    const mine = stored().find((r) => r.title === 'Pizzas' && !r.pub);
    expect(mine?.items.map((i) => i.label)).toEqual(['Margherita', 'Regina', 'Calzone']);
    expect(mine?.items.map((i) => i.id)).not.toContain('p0');
    expect(mine?.history).toEqual([]);
    click('[data-action="back"]');
  });
});

describe('sharing', () => {
  const DUEL = 'Du3dEf7hJk';

  it('opens a duel link on that duel, and drops the query from the address', () => {
    history.pushState(null, '', `/b/${DUEL}?duel=p1.p2`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(location.pathname).toBe(`/b/${DUEL}`);
    expect(location.search).toBe('');
    const ws = FakeSocket.last();
    ws.open();
    expect(ws.sent[0]).toEqual({ t: 'hello', v: 1, voter: expect.any(String), pair: ['p1', 'p2'] });
    ws.receive({
      ...state(),
      pairs: [
        ['p1', 'p2'],
        ['p0', 'p2'],
      ],
    } as ServerMessage);
    expect($('.card-a')?.textContent).toContain('Regina');
  });

  it('shares the board as an image; the link’s preview is its author’s to draw', async () => {
    respond = (c) =>
      c.method === 'PUT' ? { status: 201, body: { url: 'http://localhost:3000/og/x.png' } } : { status: 404, body: {} };
    expect($('.b-head [data-action="b-make-mine"]')).not.toBeNull();
    click('[data-action="share-board"]');
    expect($('#m-title')?.textContent).toBe('Share this ranking');
    await flush();
    expect($('#share-preview canvas')).not.toBeNull();
    const msg = $('.share-msg')?.textContent ?? '';
    expect(msg).toContain('Pizzas · 3 votes · 2 voters');
    expect(msg).toContain('1. Margherita');
    expect(msg).toContain(`Vote too: http://localhost:3000/b/${DUEL}`);
    // A visitor sends no card for the board.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    click('#m-ok');
  });

  it('shares the duel on screen, with a link that opens on it', async () => {
    // The duel's card is drawn by whoever shares it first; the next ones are told it exists, and keep quiet.
    respond = (c) => (c.method === 'PUT' ? { status: 409, body: { error: 'exists' } } : { status: 404, body: {} });
    click('[data-action="share-duel"]');
    expect($('#m-title')?.textContent).toBe('Share this duel');
    await flush();
    expect($('.share-msg')?.textContent).toBe(
      `Regina or Calzone? Vote too: http://localhost:3000/b/${DUEL}?duel=p1.p2`,
    );
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: `/api/boards/${DUEL}/card?duel=p1.p2`,
      auth: null,
    });
    click('#m-ok');
    calls.length = 0;
    click('[data-action="share-duel"]');
    await flush();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('#toast')?.textContent).not.toContain('didn’t work');
    click('#m-ok');
  });

  it('shares the end-of-vote page as the picture on screen, and offers the others', async () => {
    const ws = FakeSocket.last();
    ws.receive({
      ...state(),
      mine: [
        { a: 'p0', b: 'p1', s: 1 },
        { a: 'p1', b: 'p2', s: 1 },
        { a: 'p0', b: 'p2', s: 1 },
      ],
      pairs: [],
    } as ServerMessage);
    click('[data-action="b-finale"]');
    expect($('#fin [data-action="b-make-mine"]')).not.toBeNull();
    // The page shows the crowd's podium: so does the picture.
    click('[data-action="b-finale-view"][data-view="podium"]');
    click('[data-action="share-finale"]');
    expect($('#m-title')?.textContent).toBe('Share your result');
    await flush();
    const pressed = () => $('[data-action="share-view"][aria-pressed="true"]')?.dataset.view;
    expect([...document.querySelectorAll<HTMLElement>('[data-action="share-view"]')].map((b) => b.textContent)).toEqual(
      ['The crowd’s podium', 'Your podium', 'You vs the crowd'],
    );
    expect(pressed()).toBe('crowd');
    expect($('#share-preview canvas')).not.toBeNull();
    expect($('.share-msg')?.textContent).toContain('Pizzas · 3 votes · 2 voters · 100% in agreement with the crowd');
    // Another picture: the card and the message follow, the format stays.
    click('[data-action="share-view"][data-view="duo"]');
    await flush();
    expect(pressed()).toBe('duo');
    expect($('#share-preview canvas')).not.toBeNull();
    const msg = $('.share-msg')?.textContent ?? '';
    expect(msg).toContain('I agree with the crowd 100% of the time.');
    expect(msg).toContain('My top 3: Margherita · Regina · Calzone');
    expect(msg).toContain('The crowd’s top 3: Margherita · Regina · Calzone');
    click('[data-action="share-view"][data-view="mine"]');
    expect($('.share-msg')?.textContent).toContain('Pizzas · 3 votes · You');
    click('#m-ok');
    // On the lines, the picture opens on the lines.
    click('[data-action="b-finale-view"][data-view="duo"]');
    click('[data-action="share-finale"]');
    expect(pressed()).toBe('duo');
    click('#m-ok');
    // On the voter's podium, on theirs.
    click('[data-action="b-finale-view"][data-view="podium"]');
    click('[data-action="b-finale-who"][data-who="me"]');
    click('[data-action="share-finale"]');
    expect(pressed()).toBe('mine');
    click('#m-ok');
    click('[data-action="b-make-mine"]');
    expect(($('#rank-title') as HTMLInputElement).value).toBe('Pizzas');
    expect($('#toast')?.textContent).toBe('Your own version, ready to change and publish');
  });

  it('shows no "make my own" to the author, who shares from the Ranking tab', () => {
    click('[data-action="back"]');
    history.pushState(null, '', `/b/${ALIAS}#owner=${OWNER}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state({}, true));
    expect($('[data-action="b-make-mine"]')).toBeNull();
    click('.tab[data-tab="results"]');
    expect($('.b-results [data-action="share-board"]')).not.toBeNull();
    click('.tab[data-tab="duel"]');
    click('[data-action="back"]');
  });

  it('sends the board’s card with the author’s token when the author shares', async () => {
    const MINE = 'Au7hEf7hJk';
    respond = (c) =>
      c.method === 'PUT' ? { status: 201, body: { url: 'http://localhost:3000/og/x.png' } } : { status: 404, body: {} };
    history.pushState(null, '', `/b/${MINE}#owner=${OWNER}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state({ settings: { ...view().settings, visibility: 'blind' } }, true));
    click('.tab[data-tab="results"]');
    calls.length = 0;
    click('.b-results [data-action="share-board"]');
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: `/api/boards/${MINE}/card`,
      auth: `Bearer ${OWNER}`,
    });
    // The author sees the standings in the panel; the preview, public, doesn't show them (core/share.ts).
    expect($('.share-msg')?.textContent).toContain('1. Margherita');
    click('#m-ok');
    click('.tab[data-tab="duel"]');
    click('[data-action="back"]');
  });
});

describe('human check', () => {
  const OFFICIAL = 'Ch3ckEd7bd';
  const queue: [string, string][] = [
    ['p0', 'p1'],
    ['p1', 'p2'],
  ];

  it('shows the check when the server holds a first vote, sends its token, then lets the voter vote', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    const render = vi.fn(() => 'w1');
    const remove = vi.fn();
    (window as { turnstile?: unknown }).turnstile = { render, getResponse: () => 'human-token', remove };
    history.pushState(null, '', `/b/${OFFICIAL}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state());
    click('[data-action="b-pick"][data-side="a"]');
    ws.receive({ t: 'error', code: 'captcha' });
    ws.receive({ t: 'pairs', pairs: queue, mine: 0 });
    await flush();
    expect($('#m-title')?.textContent).toBe('One check before your first vote');
    expect(render).toHaveBeenCalledWith($('#vote-captcha'), { sitekey: 'site-key' });
    click('#m-ok');
    await flush();
    expect(ws.sent.at(-1)).toEqual({ t: 'check', token: 'human-token' });
    expect(remove).toHaveBeenCalledWith('w1');
    // Votes wait for the server's answer.
    await vi.advanceTimersByTimeAsync(600);
    const sent = ws.sent.length;
    click('[data-action="b-pick"][data-side="a"]');
    expect(ws.sent).toHaveLength(sent);
    ws.receive({ t: 'pairs', pairs: queue, mine: 0 });
    click('[data-action="b-pick"][data-side="a"]');
    expect(ws.sent.at(-1)).toEqual({ t: 'vote', a: 'p0', b: 'p1', s: 1 });
    ws.receive({ t: 'pairs', pairs: queue.slice(1), mine: 1 });
    await vi.advanceTimersByTimeAsync(600);
  });

  it('says so when the check is refused or left undone', async () => {
    const ws = FakeSocket.last();
    ws.receive(state());
    click('[data-action="b-pick"][data-side="a"]');
    ws.receive({ t: 'error', code: 'captcha' });
    ws.receive({ t: 'pairs', pairs: queue, mine: 0 });
    await flush();
    click('#m-ok');
    await flush();
    expect(ws.sent.at(-1)).toEqual({ t: 'check', token: 'human-token' });
    ws.receive({ t: 'error', code: 'captcha' });
    ws.receive({ t: 'pairs', pairs: queue, mine: 0 });
    expect($('#toast')?.textContent).toBe('The check failed. Try again.');
    // Confirmed without solving it: nothing is sent.
    (window as { turnstile?: unknown }).turnstile = { render: () => 'w2', getResponse: () => undefined, remove() {} };
    await vi.advanceTimersByTimeAsync(600);
    click('[data-action="b-pick"][data-side="a"]');
    ws.receive({ t: 'error', code: 'captcha' });
    ws.receive({ t: 'pairs', pairs: queue, mine: 0 });
    await flush();
    const sent = ws.sent.length;
    click('#m-ok');
    await flush();
    expect(ws.sent).toHaveLength(sent);
    expect($('#toast')?.textContent).toBe('Complete the check to vote.');
    // A build without a site key never shows one.
    vi.unstubAllEnvs();
    await vi.advanceTimersByTimeAsync(600);
    click('[data-action="b-pick"][data-side="a"]');
    ws.receive({ t: 'error', code: 'captcha' });
    ws.receive({ t: 'pairs', pairs: queue, mine: 0 });
    await flush();
    expect($('#modal')?.hidden).toBe(true);
    expect($('#toast')?.textContent).toBe('The check failed. Try again.');
    delete (window as { turnstile?: unknown }).turnstile;
    await vi.advanceTimersByTimeAsync(600);
    click('.board [data-action="back"]');
  });
});

describe('reporting', () => {
  const REPORTED = 'Rep7rTbxAr';

  it('lets a voter report the board with a reason and a note', async () => {
    respond = (c) =>
      c.method === 'POST' && c.url.endsWith('/report') ? { status: 200, body: true } : { status: 404, body: {} };
    history.pushState(null, '', `/b/${REPORTED}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state());
    click('[data-action="b-report"]');
    expect($('#m-title')?.textContent).toBe('Report this ranking');
    ($('input[name="report-reason"][value="personal"]') as HTMLInputElement).checked = true;
    ($('#report-note') as HTMLTextAreaElement).value = ' It names my neighbour ';
    click('#m-ok');
    await flush();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: `/api/boards/${REPORTED}/report`,
      body: { voter: expect.any(String), reason: 'personal', note: 'It names my neighbour' },
    });
    expect($('#toast')?.textContent).toBe('Thanks, your report was sent.');
    // A visitor who hasn't voted yet is told why the report didn't go.
    respond = () => ({ status: 403, body: { error: 'forbidden' } });
    click('[data-action="b-report"]');
    click('#m-ok');
    await flush();
    expect($('#toast')?.textContent).toBe('Vote at least once to report this ranking.');
  });

  it('shows no report link to the author', () => {
    FakeSocket.last().receive(state({}, true));
    expect($('[data-action="b-report"]')).toBeNull();
    click('[data-action="back"]');
  });
});

describe('pictures for review', () => {
  const PICS = 'P1cTuReS7b';

  it('tells the author when the server takes no pictures', async () => {
    respond = (c) => (c.url === '/api/config' ? { status: 200, body: { images: 'off' } } : { status: 404, body: {} });
    history.pushState(null, '', `/b/${ALIAS}#owner=${OWNER}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(state({}, true));
    expect($('[data-action="pick-files"]')).toBeNull();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    const file = new File(['x'], 'beach.jpg', { type: 'image/jpeg' });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    document.body.dispatchEvent(drop);
    await flush();
    expect($('#toast')?.textContent).toBe('Pictures aren’t open on published rankings yet. Add a name instead.');
    // Nothing became a ranking of this browser.
    expect(stored().some((r) => r.title.startsWith('Images'))).toBe(false);
    click('[data-action="back"]');
  });

  it('announces the pictures and sends them after publishing, when the server reviews them', async () => {
    respond = (c) => {
      if (c.url === '/api/config') return { status: 200, body: { images: 'review' } };
      if (c.method === 'POST') return { status: 201, body: { alias: PICS, owner: OWNER } };
      return { status: 201, body: { url: `http://localhost:3000/og/b/${PICS}/1.png`, ok: true } };
    };
    click('.rcard [data-action="open"][data-id="with-image"][data-tab="duel"]');
    click('[data-action="publish"]');
    await flush();
    expect($('#m-title')?.textContent).toBe('Publish this ranking?');
    expect($('.pub-pictures')?.textContent).toContain('Your 1 picture will be sent to the moderator');
    click('#m-ok');
    await flush();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/boards');
    const sent = (post?.body as { items: { id: string; img: string | null; pic?: string }[] } | undefined)?.items;
    expect(sent).toEqual([
      { id: 'i1', label: 'Beach', img: null, fill: null, h: 1, pic: 'pending' },
      { id: 'i2', label: 'Hills', img: null, fill: null, h: 2 },
    ]);
    await flush();
    await flush();
    expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/image'))).toMatchObject({
      url: `/api/boards/${PICS}/items/i1/image`,
      body: { blob: 'image/jpeg' },
      auth: `Bearer ${OWNER}`,
    });
    expect($('#toast')?.textContent).toBe('1 picture sent for review.');
    // The author panel says the picture waits.
    const ws = FakeSocket.last();
    ws.open();
    ws.receive(
      state(
        {
          title: 'Photos',
          items: [
            { id: 'i1', label: 'Beach', img: null, fill: null, h: 1, pic: 'pending' },
            { id: 'i2', label: 'Hills', img: null, fill: null, h: 2 },
          ],
          ranking: null,
        },
        true,
      ),
    );
    expect($('#item-list li[data-id="i1"] .row-note')?.textContent).toBe('Picture awaiting review');
    // Images added later go the same way: announced, then sent.
    await flush();
    expect($('[data-action="pick-files"]')).not.toBeNull();
    click('[data-action="back"]');
  });
});
