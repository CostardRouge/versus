// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardView, ClientMessage, ServerMessage } from '../src/core/protocol';
import { fromBase64url } from '../src/core/push';
import type { Duel } from '../src/core/types';

/** Notifications of published boards in the app: the voter's bell, the author's setting, a tapped notification. */

const ALIAS = 'Ab3dEf7hJk';
const OLD = 'Pqd7dEf7hJ';
const OWNER = 'b'.repeat(64);
const KEY = `B${'Q'.repeat(86)}`;
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

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
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    for (const fn of this.listeners.open ?? []) fn({});
  }
  receive(msg: ServerMessage): void {
    for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(msg) });
  }
  static last(): FakeSocket {
    const s = FakeSocket.all.at(-1);
    if (!s) throw new Error('no socket');
    return s;
  }
}

/** The browser's push side: a permission, one subscription, and the service worker's messages. */
const browser = {
  permission: 'granted' as NotificationPermission,
  answer: 'granted' as NotificationPermission,
  sub: null as FakeSub | null,
};
class FakeSub {
  endpoint = ENDPOINT;
  options: { applicationServerKey: ArrayBuffer };
  unsubscribe = vi.fn(async () => {
    browser.sub = null;
    return true;
  });
  constructor(key: Uint8Array) {
    this.options = { applicationServerKey: key.slice().buffer };
  }
  toJSON() {
    return {
      endpoint: this.endpoint,
      expirationTime: null,
      keys: { p256dh: `B${'x'.repeat(86)}`, auth: 'y'.repeat(22) },
    };
  }
}
const pushManager = {
  getSubscription: async () => browser.sub,
  subscribe: vi.fn(async (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
    browser.sub = new FakeSub(o.applicationServerKey);
    return browser.sub;
  }),
};
const swListeners: ((e: MessageEvent) => void)[] = [];
const requestPermission = vi.fn(async () => {
  browser.permission = browser.answer;
  return browser.answer;
});

type Call = { method: string; url: string; body: unknown; auth: string | null };
const calls: Call[] = [];

const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = (sel: string) => {
  const el = $(sel);
  if (!el) throw new Error(`missing ${sel}`);
  el.click();
};
const flush = () => vi.advanceTimersByTimeAsync(0);
const stored = () =>
  JSON.parse(localStorage.getItem('versus-push') ?? 'null') as {
    endpoint: string;
    boards: Record<string, string[]>;
  } | null;

const items = ['Margherita', 'Regina', 'Calzone'].map((label, i) => ({
  id: `p${i}`,
  label,
  img: null,
  fill: null,
  h: 10,
}));
const view = (over: Partial<BoardView> = {}): BoardView => ({
  title: 'Pizzas',
  items,
  settings: { method: 'bt', visibility: 'blind', revealAfter: 2, allowChange: true, visitorsAddItems: false },
  status: 'open',
  created: 1,
  counts: { votes: 3, voters: 2, online: 2 },
  ranking: null,
  ...over,
});
const state = (over: Partial<BoardView> = {}, owner = false, mine: Duel[] = []) =>
  ({
    t: 'state',
    board: view(over),
    owner,
    mine,
    pairs: [
      ['p0', 'p1'],
      ['p1', 'p2'],
    ],
  }) as ServerMessage;

async function openBoard(alias: string, msg: ServerMessage = state()): Promise<FakeSocket> {
  history.pushState(null, '', `/b/${alias}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
  const ws = FakeSocket.last();
  ws.open();
  ws.receive(msg);
  await flush();
  return ws;
}

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/popular')) return Response.json({ boards: [] });
      if (url.includes('/api/config')) return Response.json({ images: 'off', push: KEY });
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        auth: headers.Authorization ?? null,
      });
      return Response.json(true);
    }),
  );
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    get permission() {
      return browser.permission;
    },
    requestPermission,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager }),
      addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
        if (type === 'message') swListeners.push(fn);
      },
    },
  });
  window.scrollTo = () => {};
  localStorage.clear();
  // Asked before, on a board that knows an older endpoint: the browser renewed it since.
  localStorage.setItem(
    'versus-push',
    JSON.stringify({ endpoint: 'https://fcm.googleapis.com/old', boards: { [OLD]: ['voter'] } }),
  );
  browser.sub = new FakeSub(fromBase64url(KEY));
  document.body.innerHTML = body;
  const { mount } = await import('../src/app/ui');
  mount(document);
});

beforeEach(() => {
  calls.length = 0;
});

describe('at startup', () => {
  it('tells the boards a renewed subscription', async () => {
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/boards/${OLD}/push`,
        body: { subscription: browser.sub?.toJSON(), role: 'voter', lang: 'en' },
        auth: null,
      },
    ]);
    expect(stored()).toEqual({ endpoint: ENDPOINT, boards: { [OLD]: ['voter'] } });
    // From here on, a browser that never asked.
    localStorage.removeItem('versus-push');
    browser.sub = null;
    browser.permission = 'default';
  });
});

describe('a voter', () => {
  it('asks to be told when the vote closes, from the board’s bell', async () => {
    await openBoard(ALIAS);
    const bell = $('[data-action="b-notify"]');
    expect(bell?.textContent).toBe('Notify me');
    expect(bell?.getAttribute('aria-pressed')).toBe('false');
    click('[data-action="b-notify"]');
    await flush();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const opts = pushManager.subscribe.mock.calls.at(-1)?.[0];
    expect(opts?.userVisibleOnly).toBe(true);
    expect([...(opts?.applicationServerKey ?? [])]).toEqual([...fromBase64url(KEY)]);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/boards/${ALIAS}/push`,
        body: { subscription: browser.sub?.toJSON(), role: 'voter', lang: 'en' },
        auth: null,
      },
    ]);
    expect($('#toast')?.textContent).toBe('You’ll be notified when the vote closes.');
    expect($('[data-action="b-notify"]')?.textContent).toBe('Notifications on');
    expect($('[data-action="b-notify"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(stored()).toEqual({ endpoint: ENDPOINT, boards: { [ALIAS]: ['voter'] } });
  });

  it('finds the bell on the end-of-vote page too, still on', async () => {
    const all: Duel[] = [
      { a: 'p0', b: 'p1', s: 1 },
      { a: 'p1', b: 'p2', s: 1 },
      { a: 'p0', b: 'p2', s: 1 },
    ];
    FakeSocket.last().receive({ ...(state({}, false, all) as Extract<ServerMessage, { t: 'state' }>), pairs: [] });
    click('[data-action="b-finale"]');
    expect($('.fin-btns [data-action="b-notify"]')?.getAttribute('aria-pressed')).toBe('true');
    click('[data-action="b-finale-close"]');
  });

  it('turns it off with a second tap', async () => {
    click('[data-action="b-notify"]');
    await flush();
    expect(calls).toEqual([
      { method: 'DELETE', url: `/api/boards/${ALIAS}/push`, body: { endpoint: ENDPOINT, role: 'voter' }, auth: null },
    ]);
    expect($('#toast')?.textContent).toBe('Notifications off for this ranking.');
    expect($('[data-action="b-notify"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(stored()).toBeNull();
    // Nothing left to hear about: the browser's subscription goes too.
    expect(browser.sub).toBeNull();
  });

  it('is told how to unblock notifications the browser refused', async () => {
    browser.permission = 'default';
    browser.answer = 'denied';
    click('[data-action="b-notify"]');
    await flush();
    expect(calls).toEqual([]);
    expect($('#toast')?.textContent).toContain('Notifications are blocked for Versus');
    expect($('[data-action="b-notify"]')?.getAttribute('aria-pressed')).toBe('false');
    browser.answer = 'granted';
  });

  it('has no bell once the vote is closed, and forgets what it asked', async () => {
    click('[data-action="b-notify"]');
    await flush();
    expect(stored()?.boards[ALIAS]).toEqual(['voter']);
    FakeSocket.last().receive(state({ status: 'closed' }));
    expect($('[data-action="b-notify"]')).toBeNull();
    expect(stored()).toBeNull();
  });

  it('has no bell on the site’s own boards, which never close', async () => {
    await openBoard('Tpm7dEf7hJ', state({ official: true }));
    expect($('#view .b-head')).not.toBeNull();
    expect($('[data-action="b-notify"]')).toBeNull();
  });
});

describe('the author', () => {
  it('turns notifications on in the board’s settings, with their token', async () => {
    localStorage.setItem('versus-owners', JSON.stringify({ [ALIAS]: OWNER }));
    await openBoard(ALIAS, state({}, true));
    click('[data-action="b-settings"]');
    const box = $('#b-push') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.closest('label')?.textContent?.trim()).toBe('Notify me as voters come in (5, 10, 25…)');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/boards/${ALIAS}/push`,
        body: { subscription: browser.sub?.toJSON(), role: 'owner', lang: 'en' },
        auth: `Bearer ${OWNER}`,
      },
    ]);
    // Nothing else of the settings was sent.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(box.checked).toBe(true);
    expect($('#toast')?.textContent).toBe('You’ll be notified on this device.');
    expect(stored()?.boards[ALIAS]).toEqual(['owner']);
    click('#m-ok');
  });
});

describe('a tapped notification', () => {
  it('opens its board in the app already open', async () => {
    click('[data-action="back"]');
    expect(location.pathname).toBe('/');
    const before = FakeSocket.all.length;
    for (const fn of swListeners) fn(new MessageEvent('message', { data: { t: 'open', path: `app/b/${OLD}` } }));
    expect(location.pathname).toBe(`/b/${OLD}`);
    expect(FakeSocket.all.length).toBe(before + 1);
    // Anything else is ignored.
    for (const fn of swListeners) fn(new MessageEvent('message', { data: { t: 'open', path: 'legal/' } }));
    expect(location.pathname).toBe(`/b/${OLD}`);
  });
});
