import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestHarness } from 'wrangler';
import { ACTION_INTERVAL_MS, ALIAS_RE } from '../src/core/board';
import type {
  AdminBoardView,
  AdminList,
  AdminTotals,
  BoardSummary,
  BoardView,
  ClientMessage,
  ServerMessage,
} from '../src/core/protocol';
import { pairKey } from '../src/core/scoring';
import { CARD_LIMIT, CARD_SIZES } from '../src/core/share';
import type { BoardSettings, Ranking } from '../src/core/types';
import { fakePng } from './helpers/png';

/** End-to-end tests of the Worker and its Durable Object, running in the local workerd runtime. */

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

const CONFIG = 'worker/wrangler.jsonc';
const ADMIN = 'admin-secret-for-tests';
const server = createTestHarness({ workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN } }] });
let base: URL;

/** The app page's head, as the build writes it (the tags a board's link preview rewrites). */
const APP_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Versus — Rank anything</title>
<meta name="description" content="Rank anything by pairwise comparison." />
<meta property="og:title" content="Versus — Rank anything" /><meta property="og:description" content="Rank anything." />
<meta property="og:url" content="https://versus.example.com/app/" /><meta property="og:image" content="https://versus.example.com/og.png" />
<meta property="og:image:alt" content="Versus" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:title" content="Versus — Rank anything" /><meta name="twitter:description" content="Rank anything." />
<meta name="twitter:image" content="https://versus.example.com/og.png" /><meta name="twitter:image:alt" content="Versus" />
</head><body><main id="view"></main></body></html>`;

beforeAll(async () => {
  // The Worker serves the site from dist/; the tests run before any build, so a folder with the app's page
  // (for link previews) and the site's card (the fallback under /og/) is enough. A real build is left as it is.
  mkdirSync('dist/app', { recursive: true });
  if (!existsSync('dist/app/index.html')) writeFileSync('dist/app/index.html', APP_PAGE);
  if (!existsSync('dist/og.png')) writeFileSync('dist/og.png', fakePng(1200, 630));
  base = (await server.listen()).url;
  await server.getWorker().applyD1Migrations('REGISTRY');
});

afterAll(() => server.close());

const AUTHOR = 'author-voter-1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const items = ['Margherita', 'Regina', 'Calzone', 'Napoli', 'Diavola'].map((label, i) => ({
  id: `p${i}`,
  label,
  img: null,
  fill: null,
  h: 20,
}));

let ipCount = 0;
/** Each request gets its own client address unless one is given, so per-IP limits stay out of the way. */
const nextIp = () => `10.0.${Math.floor(++ipCount / 250)}.${ipCount % 250}`;

function api(path: string, init: { method?: string; body?: unknown; token?: string; ip?: string; root?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': init.ip ?? nextIp(),
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const body =
    typeof init.body === 'string' ? init.body : init.body === undefined ? undefined : JSON.stringify(init.body);
  return server.fetch(`${init.root ?? '/api/boards'}${path}`, { method: init.method ?? 'GET', headers, body });
}

const adminApi = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  api(path, { ...init, root: '/api/admin', token: init.token ?? ADMIN });

async function publish(settings: Partial<BoardSettings> = {}, duels: unknown[] = []) {
  const res = await api('', { method: 'POST', body: { title: 'Pizzas', items, settings, voter: AUTHOR, duels } });
  expect(res.status).toBe(201);
  return (await res.json()) as { alias: string; owner: string };
}

async function view(alias: string) {
  const res = await api(`/${alias}`);
  return { status: res.status, body: (await res.json()) as BoardView & { error?: string } };
}

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** A voter's WebSocket, with an inbox to wait for a given message type. */
class Client {
  private inbox: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.inbox.push(JSON.parse(String(e.data)) as ServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
    this.closed = new Promise((resolve) =>
      ws.addEventListener('close', (e) => resolve({ code: e.code, reason: e.reason })),
    );
  }

  static async open(alias: string, voter: string, owner?: string, pair?: [string, string]): Promise<Client> {
    const url = new URL(`/api/boards/${alias}`, base);
    url.protocol = 'ws:';
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const client = new Client(ws);
    client.send({ t: 'hello', voter, ...(owner ? { owner } : {}), ...(pair ? { pair } : {}) });
    return client;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Next message of type `t`, skipping (and dropping) other types received before it. */
  async next<T extends ServerMessage['t']>(t: T, timeout = 5000): Promise<Of<T>> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) return this.inbox.splice(0, i + 1).at(-1) as Of<T>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no "${t}" message within ${timeout} ms`);
      await Promise.race([new Promise<void>((resolve) => this.waiters.push(resolve)), sleep(left)]);
    }
  }

  close(): void {
    this.ws.close();
  }
}

describe('publishing', () => {
  it('publishes a board with the author votes and serves its public view', async () => {
    const { alias, owner } = await publish({ method: 'elo' }, [
      { a: 'p0', b: 'p1', s: 1 },
      { a: 'p1', b: 'p0', s: 1 },
      { a: 'p2', b: 'p3', s: 0.5 },
    ]);
    expect(alias).toMatch(ALIAS_RE);
    expect(owner).toMatch(/^[0-9a-f]{64}$/);
    const { status, body } = await view(alias);
    expect(status).toBe(200);
    expect(body).toMatchObject({ title: 'Pizzas', status: 'open', counts: { votes: 2, voters: 1, online: 0 } });
    expect(body.settings.method).toBe('elo');
    expect(body.ranking?.order).toHaveLength(items.length);
  });

  it('rejects invalid publications and unknown routes', async () => {
    const image = { title: 'x', voter: AUTHOR, items: [{ ...items[0], img: 'data:image/jpeg;base64,' }, items[1]] };
    expect(await (await api('', { method: 'POST', body: image })).json()).toEqual({ error: 'images_not_allowed' });
    const bad = await api('', { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await api('', { method: 'POST', body: 'x'.repeat(600 * 1024) })).status).toBe(413);
    expect((await api('')).status).toBe(404);
    expect((await view('0OIl0OIl0O')).status).toBe(404);
    expect((await view('1111111111')).status).toBe(404);
    expect((await server.fetch('/elsewhere')).status).toBe(404);
    // Every view of the app gets the app's page, whatever the build in dist/ holds.
    const app = await server.fetch('/app/');
    const page = await server.fetch('/app/demo/destinations/ranking');
    expect(page.status).toBe(app.status);
    expect(await page.text()).toBe(await app.text());
    expect((await server.fetch('/app/b/Ab3dEf7hJk', { method: 'POST' })).status).toBe(404);
    expect((await api('/1111111111/close/now', { method: 'POST' })).status).toBe(404);
  });

  it('creates no tables for unknown aliases', async () => {
    const unknown = ['1111111112', '1111111113', '1111111114'];
    expect((await view('1111111112')).status).toBe(404);
    await expect(Client.open('1111111113', 'voter-one-1')).rejects.toBeTruthy();
    expect((await api('/1111111114', { method: 'DELETE', token: 'f'.repeat(64) })).status).toBe(404);
    // The local runtime keeps a file for any object it started; what matters is that nothing was written.
    for (const name of unknown) {
      const sql = await server.getWorker().getDurableObjectStorage('BoardObject', { name });
      expect(await sql.exec("SELECT name FROM sqlite_master WHERE name IN ('meta', 'votes')")).toEqual([]);
    }
  });
});

describe('voting', () => {
  it('assigns pairs, keeps one voice per pair and broadcasts the ranking', async () => {
    const { alias } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    const state = await voter.next('state');
    expect(state.owner).toBe(false);
    expect(state.mine).toEqual([]);
    expect(state.pairs).toHaveLength(3);
    expect(state.board.ranking).not.toBeNull();

    const assigned = state.pairs.map(([a, b]) => pairKey(a, b));
    const all = items.flatMap((x, i) => items.slice(i + 1).map((y) => [x.id, y.id] as const));
    const unassigned = all.find(([a, b]) => !assigned.includes(pairKey(a, b))) as [string, string];
    voter.send({ t: 'vote', a: unassigned[0], b: unassigned[1], s: 1 });
    expect((await voter.next('error')).code).toBe('not_assigned');
    // The queue is resent after an error, so the client can resync.
    expect((await voter.next('pairs')).pairs).toEqual(state.pairs);

    const [a, b] = state.pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    const after = await voter.next('pairs');
    expect(after.mine).toBe(1);
    expect(after.pairs.map(([x, y]) => pairKey(x, y))).not.toContain(pairKey(a, b));
    const ranking = await voter.next('ranking');
    expect(ranking.counts).toMatchObject({ votes: 1, voters: 1, online: 1 });
    expect(ranking.ranking?.stats[a]?.w).toBe(1);

    // Changing a vote: undo puts the pair back first, then vote again.
    voter.send({ t: 'undo', a, b });
    const undone = await voter.next('pairs');
    expect(undone.mine).toBe(0);
    expect(undone.pairs[0]).toEqual([a, b]);
    await sleep(ACTION_INTERVAL_MS + 20);
    voter.send({ t: 'vote', a, b, s: 0 });
    expect((await voter.next('pairs')).mine).toBe(1);
    expect((await view(alias)).body.counts.votes).toBe(1);

    voter.send({ t: 'reset' });
    expect((await voter.next('pairs')).mine).toBe(0);
    voter.close();
  });

  it('requires a hello first and rejects malformed messages', async () => {
    const { alias } = await publish();
    const url = new URL(`/api/boards/${alias}`, base);
    url.protocol = 'ws:';
    const ws = new WebSocket(url);
    const replies: ServerMessage[] = [];
    ws.addEventListener('message', (e) => replies.push(JSON.parse(String(e.data)) as ServerMessage));
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    ws.send(JSON.stringify({ t: 'reset' }));
    ws.send('not json');
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(replies).toEqual([
      { t: 'error', code: 'hello_first' },
      { t: 'error', code: 'bad_request' },
    ]);
    ws.close();
    expect((await api(`/${alias}`, { method: 'GET' })).status).toBe(200);
  });

  it('counts open connections', async () => {
    const { alias } = await publish();
    const first = await Client.open(alias, 'voter-one-1');
    const second = await Client.open(alias, 'voter-two-2');
    await first.next('state');
    expect((await second.next('state')).board.counts.online).toBe(2);
    second.close();
    await vi.waitFor(async () => expect((await first.next('ranking')).counts.online).toBe(1));
    first.close();
  });

  it('serves the duel a shared link asked for first', async () => {
    const { alias } = await publish();
    const voter = await Client.open(alias, 'voter-one-1', undefined, ['p3', 'p4']);
    const state = await voter.next('state');
    expect(state.pairs[0]).toEqual(['p3', 'p4']);
    expect(state.pairs).toHaveLength(3);
    voter.send({ t: 'vote', a: 'p3', b: 'p4', s: 1 });
    await voter.next('pairs');
    voter.close();
    // Already voted on: the link opens on whatever comes next.
    const again = await Client.open(alias, 'voter-one-1', undefined, ['p4', 'p3']);
    const back = await again.next('state');
    expect(back.pairs.map(([a, b]) => pairKey(a, b))).not.toContain(pairKey('p3', 'p4'));
    again.close();
    // An unknown item: ignored.
    const other = await Client.open(alias, 'voter-two-2', undefined, ['p0', 'nope']);
    expect((await other.next('state')).pairs).toHaveLength(3);
    other.close();
  });

  it('keeps sessions and votes across hibernation', async () => {
    const { alias } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    const [a, b] = (await voter.next('state')).pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    const { pairs } = await voter.next('pairs');
    await server.getWorker().evictDurableObject('BoardObject', { name: alias, webSockets: 'hibernate' });
    const [c, d] = pairs[0] as [string, string];
    await sleep(ACTION_INTERVAL_MS + 20);
    voter.send({ t: 'vote', a: c, b: d, s: 0.5 });
    expect((await voter.next('pairs')).mine).toBe(2);
    expect((await view(alias)).body.counts.votes).toBe(2);
    voter.close();
  });
});

describe('your votes', () => {
  it('summarizes boards as this voter may see them, gone boards as null', async () => {
    const { alias, owner } = await publish({ visibility: 'blind' });
    const other = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    const [a, b] = (await voter.next('state')).pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    expect((await voter.next('pairs')).mine).toBe(1);
    voter.close();

    const ask = (aliases: unknown, voterId = 'voter-one-1', path = '') =>
      api(path, { method: 'POST', root: '/api/summaries', body: { voter: voterId, aliases } });
    const read = async (aliases: string[]) =>
      (await (await ask(aliases)).json()) as Record<string, BoardSummary | null>;

    const first = await read([alias, other.alias, '1111111115']);
    expect(first[alias]).toMatchObject({ title: 'Pizzas', status: 'open', mine: 1, counts: { votes: 1, voters: 1 } });
    // Blind: the crowd order stays on the server, as on the board page.
    expect(first[alias]?.order).toBeNull();
    expect(first[other.alias]).toMatchObject({ mine: 0 });
    expect(first[other.alias]?.order).toHaveLength(items.length);
    expect(first['1111111115']).toBeNull();

    await api(`/${alias}/close`, { method: 'POST', token: owner });
    const closed = await read([alias]);
    expect(closed[alias]?.status).toBe('closed');
    expect(closed[alias]?.order).toHaveLength(items.length);

    await api(`/${other.alias}`, { method: 'DELETE', token: other.owner });
    expect(await read([other.alias])).toEqual({ [other.alias]: null });

    expect((await ask([])).status).toBe(400);
    expect((await ask([alias], 'x')).status).toBe(400);
    expect((await ask([alias], 'voter-one-1', '/more')).status).toBe(404);
    expect((await api('', { root: '/api/summaries' })).status).toBe(404);
  });
});

describe('link previews', () => {
  const card = fakePng(CARD_SIZES.landscape.width, CARD_SIZES.landscape.height, 4096);
  const upload = (alias: string, bytes: Uint8Array, query = '', type = 'image/png') =>
    server.fetch(`/api/boards/${alias}/card${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': type, 'CF-Connecting-IP': nextIp() },
      body: bytes,
    });
  const page = async (path: string) => {
    const res = await server.fetch(path, { headers: { 'CF-Connecting-IP': nextIp() } });
    return { status: res.status, html: await res.text() };
  };
  const content = (html: string, key: string) =>
    html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

  it('writes the board into the head of its page, in its language, with the site’s card until one is drawn', async () => {
    const res = await api('', {
      method: 'POST',
      body: { title: 'Pizzas', items, voter: AUTHOR, lang: 'fr', duels: [{ a: 'p0', b: 'p1', s: 1 }] },
    });
    const { alias } = (await res.json()) as { alias: string };
    const { status, html } = await page(`/app/b/${alias}`);
    expect(status).toBe(200);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('<title>Pizzas · Versus</title>');
    expect(content(html, 'og:title')).toBe('Pizzas · Versus');
    expect(content(html, 'og:description')).toContain('5 éléments · 1 vote · 1 votant');
    expect(content(html, 'og:url')).toBe(`${base.origin}/app/b/${alias}`);
    expect(content(html, 'og:image')).toMatch(/\/og\.png$/);
    // A duel link names its two items.
    const duel = await page(`/app/b/${alias}?duel=p2.p0`);
    expect(content(duel.html, 'og:title')).toBe('Calzone vs Margherita · Pizzas');
    expect(content(duel.html, 'og:description')).toContain('Calzone ou Margherita ?');
    expect(content(duel.html, 'og:url')).toBe(`${base.origin}/app/b/${alias}?duel=p2.p0`);
    // An unknown duel: the board's preview; a board that is gone: the page as the build wrote it.
    expect(content((await page(`/app/b/${alias}?duel=p2.zz`)).html, 'og:title')).toBe('Pizzas · Versus');
    const untouched = content((await page('/app/demo/destinations')).html, 'og:title');
    expect(untouched).toMatch(/^Versus — /);
    expect(content((await page('/app/b/1111111116')).html, 'og:title')).toBe(untouched);
  });

  it('stores the card the app drew, serves it under /og/ and puts it in the head', async () => {
    const { alias } = await publish();
    expect((await upload(alias, card, '', 'text/plain')).status).toBe(415);
    expect((await upload(alias, fakePng(1080, 1350))).status).toBe(400);
    expect((await upload('1111111117', card)).status).toBe(404);
    expect((await upload(alias, card, '?duel=p0.zz')).status).toBe(400);
    const stored = await upload(alias, card);
    expect(stored.status).toBe(201);
    const { url } = (await stored.json()) as { url: string };
    expect(url).toMatch(new RegExp(`^${base.origin}/og/b/${alias}/\\d+\\.png$`));
    const served = await server.fetch(url);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(card);
    const { html } = await page(`/app/b/${alias}`);
    expect(content(html, 'og:image')).toMatch(new RegExp(`^${base.origin}/og/b/${alias}/\\d+\\.png$`));
    expect(content(html, 'twitter:image')).toBe(content(html, 'og:image'));
    expect(content(html, 'og:image:alt')).toBe('The ranking “Pizzas” on Versus');

    // A duel card of its own; the board's link keeps the board's card.
    const duelCard = fakePng(CARD_SIZES.landscape.width, CARD_SIZES.landscape.height, 2048);
    expect((await upload(alias, duelCard, '?duel=p1.p0')).status).toBe(201);
    const duel = await page(`/app/b/${alias}?duel=p0.p1`);
    expect(content(duel.html, 'og:image')).toMatch(new RegExp(`^${base.origin}/og/b/${alias}/p0\\.p1/\\d+\\.png$`));
    expect(content(duel.html, 'og:image:alt')).toBe(
      'Margherita against Regina, a duel of the ranking “Pizzas” on Versus',
    );
    const bytes = await (await server.fetch(content(duel.html, 'og:image') ?? '')).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(duelCard);
    // A duel without a card: the board's link preview falls back to the site's card.
    expect(content((await page(`/app/b/${alias}?duel=p3.p4`)).html, 'og:image')).toMatch(/\/og\.png$/);
    // An address that names no stored card gets the site's card.
    expect((await server.fetch(`/og/b/${alias}/p3.p4/1.png`)).status).toBe(200);
    expect((await server.fetch('/og/b/1111111118/1.png')).status).toBe(200);
    expect((await server.fetch('/og/nothing')).status).toBe(200);
  });

  it('keeps at most a few duel cards per board, and drops every card with the board', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...items[0], id: `q${i}`, label: `Q${i}` }));
    const res = await api('', { method: 'POST', body: { title: 'Many', items: many, voter: AUTHOR } });
    const { alias, owner } = (await res.json()) as { alias: string; owner: string };
    let stored = 0;
    for (let i = 1; i < many.length && stored < CARD_LIMIT + 1; i++) {
      for (let j = 0; j < i && stored < CARD_LIMIT + 1; j++) {
        const r = await upload(alias, card, `?duel=q${j}.q${i}`);
        if (stored < CARD_LIMIT) expect(r.status).toBe(201);
        else expect(r.status).toBe(409);
        stored++;
      }
    }
    // Drawing a card again for a duel that has one is always fine.
    expect((await upload(alias, card, '?duel=q0.q1')).status).toBe(201);
    const first = content((await page(`/app/b/${alias}?duel=q0.q1`)).html, 'og:image') ?? '';
    expect(first).toContain(`/og/b/${alias}/q0.q1/`);
    await api(`/${alias}`, { method: 'DELETE', token: owner });
    // The cards are gone with the board: the address falls back to the site's card.
    await vi.waitFor(
      async () => {
        const res = await server.fetch(first);
        expect(new Uint8Array(await res.arrayBuffer())).not.toEqual(card);
      },
      { timeout: 5000, interval: 200 },
    );
  });
});

describe('author controls', () => {
  it('hides the ranking in blind mode until the author closes the vote', async () => {
    const { alias, owner } = await publish({ visibility: 'blind' });
    const voter = await Client.open(alias, 'voter-one-1');
    const author = await Client.open(alias, AUTHOR, owner);
    const vs = await voter.next('state');
    expect(vs.board.ranking).toBeNull();
    const as = await author.next('state');
    expect(as.owner).toBe(true);
    expect(as.board.ranking).not.toBeNull();
    expect((await view(alias)).body.ranking).toBeNull();

    const [a, b] = vs.pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    expect((await voter.next('ranking')).ranking).toBeNull();
    expect((await author.next('ranking')).ranking?.stats[a]?.w).toBe(1);

    expect((await api(`/${alias}/close`, { method: 'POST' })).status).toBe(403);
    expect((await api(`/${alias}/close`, { method: 'POST', token: 'f'.repeat(64) })).status).toBe(403);
    const closed = await api(`/${alias}/close`, { method: 'POST', token: owner });
    expect(await closed.json()).toBe('closed');
    const revealed = await voter.next('state');
    expect(revealed.board.status).toBe('closed');
    expect(revealed.board.ranking?.stats[a]?.w).toBe(1);
    expect(revealed.pairs).toEqual([]);
    voter.send({ t: 'vote', a, b, s: 0 });
    expect((await voter.next('error')).code).toBe('closed');

    await api(`/${alias}/reopen`, { method: 'POST', token: owner });
    const reopened = await voter.next('state');
    expect(reopened.board.status).toBe('open');
    expect(reopened.board.ranking).toBeNull();
    expect(reopened.pairs).toHaveLength(3);
    voter.close();
    author.close();
  });

  it('updates settings for the author only', async () => {
    const { alias, owner } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    expect((await api(`/${alias}`, { method: 'PATCH', body: { visibility: 'after' } })).status).toBe(403);
    const res = await api(`/${alias}`, {
      method: 'PATCH',
      token: owner,
      body: { visibility: 'after', revealAfter: 1 },
    });
    expect(await res.json()).toMatchObject({ visibility: 'after', revealAfter: 1 });
    const hidden = await voter.next('state');
    expect(hidden.board.ranking).toBeNull();
    const [a, b] = hidden.pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    expect((await voter.next('ranking')).ranking).not.toBeNull();
    voter.close();
  });

  it('withdraws a board and hands the author a local copy', async () => {
    const { alias, owner } = await publish({}, [{ a: 'p0', b: 'p1', s: 1 }]);
    const voter = await Client.open(alias, 'voter-one-1');
    const [a, b] = (await voter.next('state')).pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    await voter.next('pairs');
    expect((await api(`/${alias}`, { method: 'DELETE', token: 'f'.repeat(64) })).status).toBe(403);
    const res = await api(`/${alias}`, { method: 'DELETE', token: owner });
    const copy = (await res.json()) as Ranking;
    expect(copy.title).toBe('Pizzas');
    expect(copy.items).toHaveLength(items.length);
    expect(copy.history).toHaveLength(2);
    expect(await voter.closed).toEqual({ code: 4004, reason: 'withdrawn' });
    expect((await view(alias)).status).toBe(404);
    expect((await api(`/${alias}`, { method: 'DELETE', token: owner })).status).toBe(404);
  });
});

describe('items after publication', () => {
  it('lets the author add and remove items; removing drops their votes', async () => {
    const { alias, owner } = await publish({}, [
      { a: 'p0', b: 'p1', s: 1 },
      { a: 'p2', b: 'p3', s: 1 },
    ]);
    const add = (item: unknown, token = owner) => api(`/${alias}/items`, { method: 'POST', body: item, token });
    expect((await add({ label: 'Hawaii' }, 'f'.repeat(64))).status).toBe(403);
    const res = await add({ label: '  Hawaii ' });
    const item = (await res.json()) as { id: string; label: string };
    expect(item.label).toBe('Hawaii');
    expect((await add({ label: 'hawaii' })).status).toBe(409);
    expect((await add({ label: 'x', img: 'data:image/png;base64,' })).status).toBe(400);
    expect((await view(alias)).body.items).toHaveLength(items.length + 1);

    const remove = (id: string) => api(`/${alias}/items/${id}`, { method: 'DELETE', token: owner });
    expect(await (await remove('p0')).json()).toBe(1);
    const after = (await view(alias)).body;
    expect(after.items.map((i) => i.id)).not.toContain('p0');
    expect(after.counts.votes).toBe(1);
    expect((await remove('nope')).status).toBe(404);
    for (const id of ['p1', 'p2', 'p3']) expect((await remove(id)).status).toBe(200);
    // Two items left: a board can't go below that.
    expect((await remove('p4')).status).toBe(409);
  });

  it('lets the author recolor a color item; its votes are dropped', async () => {
    const red = { type: 'solid', colors: ['#aa0000'] };
    const colored = items.map((it, i) => (i < 2 ? { ...it, label: i ? '#AA0000' : 'Rouge', fill: red } : it));
    const duels = [
      { a: 'p0', b: 'p1', s: 1 },
      { a: 'p2', b: 'p3', s: 1 },
    ];
    const res = await api('', { method: 'POST', body: { title: 'Couleurs', items: colored, voter: AUTHOR, duels } });
    const { alias, owner } = (await res.json()) as { alias: string; owner: string };
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    const blue = { type: 'solid', colors: ['#2743f5'] };
    const recolor = (id: string, body: unknown, token = owner) =>
      api(`/${alias}/items/${id}`, { method: 'PATCH', body, token });
    expect((await recolor('p1', { fill: blue }, 'f'.repeat(64))).status).toBe(403);
    expect((await recolor('p2', { fill: blue })).status).toBe(400);
    expect((await recolor('p1', {})).status).toBe(400);
    expect((await recolor('nope', { fill: blue })).status).toBe(404);
    expect(await (await recolor('p1', { fill: blue })).json()).toBe(1);
    const state = await voter.next('state');
    expect(state.board.items.find((i) => i.id === 'p1')).toMatchObject({ label: '#2743F5', fill: blue });
    expect(state.board.counts.votes).toBe(1);
    voter.close();
  });

  it('lets visitors add items only when the author allows it, a few seconds apart', async () => {
    const { alias, owner } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    voter.send({ t: 'add', item: { label: 'Hawaii' } });
    expect((await voter.next('error')).code).toBe('forbidden');
    await api(`/${alias}`, { method: 'PATCH', token: owner, body: { visitorsAddItems: true } });
    expect((await voter.next('state')).board.settings.visitorsAddItems).toBe(true);
    voter.send({ t: 'add', item: { label: 'Hawaii', fill: null } });
    const added = await voter.next('state');
    expect(added.board.items.map((i) => i.label)).toContain('Hawaii');
    voter.send({ t: 'add', item: { label: '#FF8800', fill: { type: 'solid', colors: ['#ff8800'] } } });
    expect((await voter.next('error')).code).toBe('too_fast');
    voter.close();
  });
});

describe('registry and admin', () => {
  it('lists boards and totals for the admin only', async () => {
    const { alias } = await publish({}, [{ a: 'p0', b: 'p1', s: 1 }]);
    expect((await adminApi('/stats', { token: 'wrong' })).status).toBe(403);
    await vi.waitFor(
      async () => {
        const res = await adminApi('/boards?limit=100');
        const list = (await res.json()) as { boards: { alias: string; votes: number; status: string }[] };
        expect(list.boards.find((b) => b.alias === alias)).toMatchObject({ votes: 1, status: 'open' });
      },
      { timeout: 5000, interval: 200 },
    );
    const stats = (await (await adminApi('/stats')).json()) as { boards: number; votes: number };
    expect(stats.boards).toBeGreaterThan(0);
    expect(stats.votes).toBeGreaterThan(0);
  });

  it('inspects, closes, moderates and takes down any board', async () => {
    const { alias } = await publish({ visibility: 'blind' });
    expect((await view(alias)).body.ranking).toBeNull();
    const full = (await (await adminApi(`/boards/${alias}`)).json()) as BoardView;
    expect(full.ranking?.order).toHaveLength(items.length);
    expect((await adminApi(`/boards/${alias}/close`, { method: 'POST' })).status).toBe(200);
    expect((await view(alias)).body.status).toBe('closed');
    expect((await adminApi(`/boards/${alias}/items/p0`, { method: 'DELETE' })).status).toBe(200);
    expect((await view(alias)).body.items).toHaveLength(items.length - 1);
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    expect((await adminApi(`/boards/${alias}`, { method: 'DELETE' })).status).toBe(200);
    expect(await voter.closed).toEqual({ code: 4004, reason: 'removed' });
    expect((await view(alias)).status).toBe(404);
    await vi.waitFor(
      async () => {
        const list = (await (await adminApi('/boards?limit=100')).json()) as { boards: { alias: string }[] };
        expect(list.boards.some((b) => b.alias === alias)).toBe(false);
      },
      { timeout: 5000, interval: 200 },
    );
    expect((await adminApi('/boards/1111111111')).status).toBe(404);
    expect((await adminApi('/nothing')).status).toBe(404);
  });

  it('takes visitors’ reports, one per voter, and lists reported boards first', async () => {
    const { alias } = await publish();
    const report = (body: unknown) => api(`/${alias}/report`, { method: 'POST', body });
    expect((await report({ voter: 'voter-one-1', reason: 'spam', note: '  Ads everywhere  ' })).status).toBe(200);
    expect((await report({ voter: 'voter-one-1', reason: 'offensive' })).status).toBe(200);
    expect((await report({ voter: 'voter-two-2', reason: 'other', note: 'x'.repeat(400) })).status).toBe(200);
    expect((await report({ voter: 'voter-two-2', reason: 'nope' })).status).toBe(400);
    expect((await report({ voter: 'bad', reason: 'spam' })).status).toBe(400);
    expect((await report({ voter: 'voter-two-2' })).status).toBe(400);
    const gone = { voter: 'voter-one-1', reason: 'spam' };
    expect((await api('/1111111111/report', { method: 'POST', body: gone })).status).toBe(404);
    expect((await api(`/${alias}/report`)).status).toBe(404);
    const full = (await (await adminApi(`/boards/${alias}`)).json()) as AdminBoardView;
    expect(full.alias).toBe(alias);
    expect(full.mod).toEqual({ hidden: false, featured: false });
    expect(full.reports).toEqual([
      { reason: 'offensive', note: '', t: expect.any(Number) },
      { reason: 'other', note: 'x'.repeat(300), t: expect.any(Number) },
    ]);
    expect(JSON.stringify(full.reports)).not.toContain('voter-one-1');
    await vi.waitFor(
      async () => {
        const list = (await (await adminApi('/boards?filter=reported')).json()) as AdminList;
        expect(list.filter).toBe('reported');
        expect(list.boards[0]).toMatchObject({ alias, reports: 2, lang: 'en' });
      },
      { timeout: 5000, interval: 200 },
    );
    const stats = (await (await adminApi('/stats')).json()) as AdminTotals;
    expect(stats.reported).toBeGreaterThan(0);
    // Reviewed: the reports go and the board leaves the list.
    expect(await (await adminApi(`/boards/${alias}/reports`, { method: 'DELETE' })).json()).toBe(2);
    expect(((await (await adminApi(`/boards/${alias}`)).json()) as AdminBoardView).reports).toEqual([]);
    await vi.waitFor(
      async () => {
        const list = (await (await adminApi('/boards?filter=reported')).json()) as AdminList;
        expect(list.boards.some((b) => b.alias === alias)).toBe(false);
      },
      { timeout: 5000, interval: 200 },
    );
  });

  it('hides and features boards, and filters and searches the list', async () => {
    const { alias } = await publish();
    const patch = (body: unknown) => adminApi(`/boards/${alias}`, { method: 'PATCH', body });
    expect(await (await patch({ hidden: true, featured: 'yes' })).json()).toEqual({ hidden: true, featured: false });
    expect(await (await patch({ featured: true })).json()).toEqual({ hidden: true, featured: true });
    expect((await adminApi('/boards/1111111111', { method: 'PATCH', body: { hidden: true } })).status).toBe(404);
    await vi.waitFor(
      async () => {
        const hidden = (await (await adminApi('/boards?filter=hidden')).json()) as AdminList;
        expect(hidden.boards.find((b) => b.alias === alias)).toMatchObject({ hidden: true, featured: true });
      },
      { timeout: 5000, interval: 200 },
    );
    const featured = (await (await adminApi('/boards?filter=featured&q=PIZZ')).json()) as AdminList;
    expect(featured).toMatchObject({ filter: 'featured', q: 'PIZZ' });
    expect(featured.boards.some((b) => b.alias === alias)).toBe(true);
    const none = (await (await adminApi('/boards?filter=featured&q=nothing-like-this')).json()) as AdminList;
    expect(none.boards).toEqual([]);
    expect(((await (await adminApi('/boards?filter=bogus&limit=1')).json()) as AdminList).filter).toBe('all');
    const stats = (await (await adminApi('/stats')).json()) as AdminTotals;
    expect(stats.hidden).toBeGreaterThan(0);
    expect(stats.featured).toBeGreaterThan(0);
    // Voters see none of it: the board keeps working for whoever has the link.
    const { status, body } = await view(alias);
    expect(status).toBe(200);
    expect(Object.keys(body)).not.toContain('mod');
    expect((await patch({ hidden: false })).status).toBe(200);
  });
});

describe('limits', () => {
  it('limits publications per IP', async () => {
    const body = { title: 'Pizzas', items, voter: AUTHOR };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await api('', { method: 'POST', body, ip: '203.0.113.7' })).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
    // Another address is not affected.
    expect((await api('', { method: 'POST', body, ip: '203.0.113.8' })).status).toBe(201);
  });

  it('asks for a Turnstile token once a secret is set', async () => {
    await server.update({ workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN, TURNSTILE_SECRET: 'x' } }] });
    const res = await api('', { method: 'POST', body: { title: 'Pizzas', items, voter: AUTHOR } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'captcha' });
  });
});

describe('cleanup', () => {
  it('deletes a board after the inactivity TTL', async () => {
    await server.update({ workers: [{ configPath: CONFIG, vars: { BOARD_TTL_SECONDS: '1' } }] });
    const { alias } = await publish();
    expect((await view(alias)).status).toBe(200);
    await vi.waitFor(async () => expect((await view(alias)).status).toBe(404), { timeout: 8000, interval: 250 });
  });
});
