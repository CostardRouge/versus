import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestHarness } from 'wrangler';
import { ACTION_INTERVAL_MS, ALIAS_RE, LIMITS, NEW_VOTERS_PER_ADDRESS } from '../src/core/board';
import type {
  AdminBoardView,
  AdminList,
  AdminTotals,
  BoardSummary,
  BoardView,
  ClientMessage,
  PopularBoard,
  ServerMessage,
} from '../src/core/protocol';
import { PROTOCOL_VERSION } from '../src/core/protocol';
import { pairKey } from '../src/core/scoring';
import { CARD_LIMIT, CARD_MAX_BYTES, CARD_SIZES } from '../src/core/share';
import { TEMPLATES } from '../src/core/templates';
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

/** The legal page's shell, as the build writes it: the template pages are rendered into it. */
const legalPage = (lang: 'en' | 'fr', path: string) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>Legal notice · Versus</title><meta name="description" content="Who publishes Versus." />
<link rel="canonical" href="https://versus.example.com/${path}" />
<link rel="alternate" hreflang="en" href="https://versus.example.com/legal/" /><link rel="alternate" hreflang="fr" href="https://versus.example.com/fr/mentions-legales/" />
<link rel="alternate" hreflang="x-default" href="https://versus.example.com/legal/" />
<meta name="robots" content="index, follow" /><meta property="og:title" content="Legal" /><meta property="og:description" content="Legal" />
<meta property="og:url" content="https://versus.example.com/${path}" /><meta property="og:image" content="https://versus.example.com/og.png" />
<meta property="og:image:alt" content="Versus" /><meta name="twitter:title" content="Legal" /><meta name="twitter:description" content="Legal" />
<meta name="twitter:image" content="https://versus.example.com/og.png" /><meta name="twitter:image:alt" content="Versus" />
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[]}</script>
</head><body class="lg-page"><header class="nav"><nav class="langs"><a href="../legal/" data-lang="en">EN</a><a href="../fr/mentions-legales/" data-lang="fr">FR</a></nav></header>
<main id="main" class="wrap lg"><h1>Legal notice</h1></main><footer class="foot"><nav class="foot-langs"><a href="../legal/" data-lang="en">English</a><a href="../fr/mentions-legales/" data-lang="fr">Français</a></nav></footer></body></html>`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://versus.example.com/</loc><lastmod>2026-09-30</lastmod></url>
  <url><loc>https://versus.example.com/fr/</loc><lastmod>2026-09-30</lastmod></url>
</urlset>
`;

beforeAll(async () => {
  // The Worker serves the site from dist/; the tests run before any build, so a folder with the app's page
  // (for link previews), the legal pages (the template pages' shells), the sitemap and the site's card (the
  // fallback under /og/) is enough. A real build is left as it is.
  mkdirSync('dist/app', { recursive: true });
  mkdirSync('dist/legal', { recursive: true });
  mkdirSync('dist/fr/mentions-legales', { recursive: true });
  if (!existsSync('dist/app/index.html')) writeFileSync('dist/app/index.html', APP_PAGE);
  if (!existsSync('dist/legal/index.html')) writeFileSync('dist/legal/index.html', legalPage('en', 'legal/'));
  if (!existsSync('dist/fr/mentions-legales/index.html')) {
    writeFileSync('dist/fr/mentions-legales/index.html', legalPage('fr', 'fr/mentions-legales/'));
  }
  if (!existsSync('dist/sitemap.xml')) writeFileSync('dist/sitemap.xml', SITEMAP);
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

  /** `ip` is the client address the platform would give (CF-Connecting-IP); Node's WebSocket can send headers. */
  static async open(
    alias: string,
    voter: string,
    owner?: string,
    pair?: [string, string],
    ip?: string,
  ): Promise<Client> {
    const url = new URL(`/api/boards/${alias}`, base);
    url.protocol = 'ws:';
    const init = ip ? { headers: { 'CF-Connecting-IP': ip } } : undefined;
    const ws = new WebSocket(url, init as unknown as string[]);
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
    // A protocol version must be a whole number from 1; this app's is served.
    ws.send(JSON.stringify({ t: 'hello', voter: 'voter-one-1', v: 0 }));
    ws.send(JSON.stringify({ t: 'hello', voter: 'voter-one-1', v: PROTOCOL_VERSION }));
    await vi.waitFor(() => expect(replies).toHaveLength(4));
    expect(replies.slice(0, 3)).toEqual([
      { t: 'error', code: 'hello_first' },
      { t: 'error', code: 'bad_request' },
      { t: 'error', code: 'bad_request' },
    ]);
    expect(replies[3]?.t).toBe('state');
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

describe('new voters per address', () => {
  it('refuses the first vote of a 31st new voter from one address within 10 minutes', async () => {
    const { alias } = await publish();
    /** A new voter from `ip` casts their first vote: what the server answers. */
    const firstVote = async (voter: string, ip: string) => {
      const c = await Client.open(alias, voter, undefined, undefined, ip);
      const [a, b] = (await c.next('state')).pairs[0] as [string, string];
      c.send({ t: 'vote', a, b, s: 1 });
      const pairs = await c.next('pairs');
      return { c, mine: pairs.mine };
    };
    for (let i = 0; i < NEW_VOTERS_PER_ADDRESS; i++) {
      const { c, mine } = await firstVote(`crowd-voter-${i}`, '198.51.100.7');
      expect(mine).toBe(1);
      c.close();
    }
    const refused = await Client.open(alias, 'crowd-voter-x', undefined, undefined, '198.51.100.7');
    const [a, b] = (await refused.next('state')).pairs[0] as [string, string];
    refused.send({ t: 'vote', a, b, s: 1 });
    expect((await refused.next('error')).code).toBe('rate_limited');
    expect((await refused.next('pairs')).mine).toBe(0);
    refused.close();
    // Another address is not affected, nor a voter of this address who already voted.
    const other = await firstVote('crowd-voter-y', '198.51.100.8');
    expect(other.mine).toBe(1);
    other.c.close();
    const known = await Client.open(alias, 'crowd-voter-0', undefined, undefined, '198.51.100.7');
    const [c, d] = (await known.next('state')).pairs[0] as [string, string];
    known.send({ t: 'vote', a: c, b: d, s: 0 });
    expect((await known.next('pairs')).mine).toBe(2);
    known.close();
    expect((await view(alias)).body.counts.voters).toBe(NEW_VOTERS_PER_ADDRESS + 1);
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
  const upload = (alias: string, bytes: Uint8Array, query = '', token = '', type = 'image/png') =>
    server.fetch(`/api/boards/${alias}/card${query}`, {
      method: 'PUT',
      headers: {
        'Content-Type': type,
        'CF-Connecting-IP': nextIp(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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

  it('escapes a hostile title and labels in the head', async () => {
    const title = 'Q" onfocus="alert(1)" x="</title><script>alert(2)</script>';
    const res = await api('', {
      method: 'POST',
      body: { title, items: [{ ...items[0], label: '"><img src=x>' }, ...items.slice(1)], voter: AUTHOR },
    });
    const { alias } = (await res.json()) as { alias: string };
    const decode = (s = '') =>
      s
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    // Read back the way a browser does: an unescaped quote or tag would cut the title or the attribute short.
    const board = (await page(`/app/b/${alias}`)).html;
    expect(decode(board.match(/<title>([^<]*)<\/title>/)?.[1])).toBe(`${title} · Versus`);
    expect(decode(content(board, 'og:title'))).toBe(`${title} · Versus`);
    const duel = (await page(`/app/b/${alias}?duel=p0.p1`)).html;
    expect(decode(content(duel, 'og:title'))).toBe(`"><img src=x> vs Regina · ${title}`);
  });

  it('writes ampersands and entities of a title back exactly', async () => {
    const title = 'Fish & "Chips" &quot;x&amp; &lt;b&gt;';
    const res = await api('', { method: 'POST', body: { title, items, voter: AUTHOR } });
    const { alias } = (await res.json()) as { alias: string };
    const named: Record<string, string> = { quot: '"', lt: '<', gt: '>', amp: '&', '#39': "'" };
    // Decoded the way a browser does, in one pass.
    const decode = (s = '') => s.replace(/&(quot|lt|gt|amp|#39);/g, (_, e: string) => named[e] ?? '');
    const { html } = await page(`/app/b/${alias}`);
    expect(decode(content(html, 'og:title'))).toBe(`${title} · Versus`);
    expect(decode(content(html, 'twitter:title'))).toBe(`${title} · Versus`);
    expect(decode(html.match(/<title>([^<]*)<\/title>/)?.[1])).toBe(`${title} · Versus`);
  });

  it('stores the card the app drew, serves it under /og/ and puts it in the head', async () => {
    const { alias, owner } = await publish();
    expect((await upload(alias, card, '', owner, 'text/plain')).status).toBe(415);
    expect((await upload(alias, fakePng(1080, 1350), '', owner)).status).toBe(400);
    expect((await upload('1111111117', card, '', owner)).status).toBe(404);
    expect((await upload(alias, card, '?duel=p0.zz')).status).toBe(400);
    // The board's own card is its author's to draw.
    expect((await upload(alias, card)).status).toBe(403);
    expect((await upload(alias, card, '', 'f'.repeat(64))).status).toBe(403);
    const stored = await upload(alias, card, '', owner);
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

    // A duel card of its own, from whoever shares it first; the board's link keeps the board's card.
    const duelCard = fakePng(CARD_SIZES.landscape.width, CARD_SIZES.landscape.height, 2048);
    expect((await upload(alias, duelCard, '?duel=p1.p0')).status).toBe(201);
    const duel = await page(`/app/b/${alias}?duel=p0.p1`);
    expect(content(duel.html, 'og:image')).toMatch(new RegExp(`^${base.origin}/og/b/${alias}/p0\\.p1/\\d+\\.png$`));
    expect(content(duel.html, 'og:image:alt')).toBe(
      'Margherita against Regina, a duel of the ranking “Pizzas” on Versus',
    );
    const bytes = await (await server.fetch(content(duel.html, 'og:image') ?? '')).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(duelCard);
    // Another visitor can't replace it; the author can.
    expect((await upload(alias, card, '?duel=p0.p1')).status).toBe(409);
    expect((await upload(alias, card, '?duel=p0.p1', owner)).status).toBe(201);
    const redrawn = content((await page(`/app/b/${alias}?duel=p0.p1`)).html, 'og:image') ?? '';
    expect(new Uint8Array(await (await server.fetch(redrawn)).arrayBuffer())).toEqual(card);
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
    // Drawing a card again for a duel that has one is its author's to do.
    expect((await upload(alias, card, '?duel=q0.q1')).status).toBe(409);
    expect((await upload(alias, card, '?duel=q0.q1', owner)).status).toBe(201);
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

  it('takes no card from visitors on the site’s own boards', async () => {
    const alias = (await (await server.fetch('/t/pizzas/')).text()).match(/\/app\/b\/([1-9A-HJ-NP-Za-km-z]{10})/)?.[1];
    expect(alias).toBeDefined();
    expect((await upload(alias ?? '', card)).status).toBe(403);
    const { items: list } = (await view(alias ?? '')).body;
    expect((await upload(alias ?? '', card, `?duel=${list[0]?.id}.${list[1]?.id}`)).status).toBe(403);
  });

  it('drops the board’s card once its ranking no longer shows to everyone', async () => {
    const image = async (alias: string) => content((await page(`/app/b/${alias}`)).html, 'og:image') ?? '';
    const gone = { timeout: 5000, interval: 200 };
    // Results hidden again.
    const open = await publish();
    expect((await upload(open.alias, card, '', open.owner)).status).toBe(201);
    expect(await image(open.alias)).toContain(`/og/b/${open.alias}/`);
    await api(`/${open.alias}`, { method: 'PATCH', token: open.owner, body: { visibility: 'blind' } });
    await vi.waitFor(async () => expect(await image(open.alias)).toMatch(/\/og\.png$/), gone);
    // A blind vote reopened after its close showed the ranking to everyone.
    const blind = await publish({ visibility: 'blind' });
    await api(`/${blind.alias}/close`, { method: 'POST', token: blind.owner });
    expect((await upload(blind.alias, card, '', blind.owner)).status).toBe(201);
    await api(`/${blind.alias}/reopen`, { method: 'POST', token: blind.owner });
    await vi.waitFor(async () => expect(await image(blind.alias)).toMatch(/\/og\.png$/), gone);
    // Nothing goes while it stays public.
    expect((await upload(open.alias, card, '?duel=p0.p1')).status).toBe(201);
    await api(`/${open.alias}`, { method: 'PATCH', token: open.owner, body: { visibility: 'always' } });
    expect((await upload(open.alias, card, '', open.owner)).status).toBe(201);
    await api(`/${open.alias}`, { method: 'PATCH', token: open.owner, body: { allowChange: false } });
    expect(await image(open.alias)).toContain(`/og/b/${open.alias}/`);
  });

  it('lets the admin delete a board’s cards', async () => {
    const { alias, owner } = await publish();
    expect((await upload(alias, card, '', owner)).status).toBe(201);
    expect((await upload(alias, card, '?duel=p0.p1')).status).toBe(201);
    expect((await adminApi(`/boards/${alias}/cards`, { method: 'DELETE', token: 'wrong' })).status).toBe(403);
    expect(await (await adminApi(`/boards/${alias}/cards`, { method: 'DELETE' })).json()).toBe(2);
    expect(content((await page(`/app/b/${alias}`)).html, 'og:image')).toMatch(/\/og\.png$/);
    expect(content((await page(`/app/b/${alias}?duel=p0.p1`)).html, 'og:image')).toMatch(/\/og\.png$/);
    expect(await (await adminApi(`/boards/${alias}/cards`, { method: 'DELETE' })).json()).toBe(0);
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

  it('renames the board for the author; the registry follows', async () => {
    const { alias, owner } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    await api(`/${alias}`, { method: 'PATCH', token: owner, body: { title: '  Pizzas du vendredi ' } });
    expect((await voter.next('state')).board.title).toBe('Pizzas du vendredi');
    await vi.waitFor(async () => {
      const list = (await (await adminApi('/boards?q=vendredi')).json()) as AdminList;
      expect(list.boards.map((r) => r.alias)).toContain(alias);
    });
    // An empty title changes nothing.
    await api(`/${alias}`, { method: 'PATCH', token: owner, body: { title: ' ' } });
    expect((await voter.next('state')).board.title).toBe('Pizzas du vendredi');
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

  it('adds a pasted list in one request, leaving out labels already there', async () => {
    const { alias, owner } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    const add = (body: unknown) => api(`/${alias}/items`, { method: 'POST', body, token: owner });
    const res = await add({ items: [{ label: 'Hawaii' }, { label: 'regina' }, { label: 'Quattro' }] });
    expect(((await res.json()) as { label: string }[]).map((i) => i.label)).toEqual(['Hawaii', 'Quattro']);
    // One state for the whole list.
    expect((await voter.next('state')).board.items).toHaveLength(items.length + 2);
    expect((await add({ items: [{ label: 'Margherita' }] })).status).toBe(409);
    expect((await add({ items: [] })).status).toBe(400);
    expect((await add({ items: [{ label: 'Ok' }, { label: 3 }] })).status).toBe(400);
    voter.close();
  });

  it('lets the author rename an item, keeping its votes or starting it again', async () => {
    const { alias, owner } = await publish({}, [
      { a: 'p0', b: 'p1', s: 1 },
      { a: 'p2', b: 'p3', s: 1 },
    ]);
    const voter = await Client.open(alias, 'voter-one-1');
    await voter.next('state');
    const edit = (id: string, body: unknown, token = owner) =>
      api(`/${alias}/items/${id}`, { method: 'PATCH', body, token });
    expect((await edit('p0', { label: 'Marinara' }, 'f'.repeat(64))).status).toBe(403);
    expect((await edit('p0', { label: 'Regina' })).status).toBe(409);
    expect((await edit('p0', { label: ' ' })).status).toBe(400);
    expect(await (await edit('p0', { label: 'Marinara', reset: false })).json()).toBe(0);
    const kept = await voter.next('state');
    expect(kept.board.items.find((i) => i.id === 'p0')?.label).toBe('Marinara');
    expect(kept.board.counts.votes).toBe(2);
    expect(await (await edit('p2', { label: 'Quattro', reset: true })).json()).toBe(1);
    const reset = await voter.next('state');
    expect(reset.board.items.find((i) => i.id === 'p2')?.label).toBe('Quattro');
    expect(reset.board.counts.votes).toBe(1);
    await api(`/${alias}/close`, { method: 'POST', token: owner });
    expect((await edit('p2', { label: 'Late' })).status).toBe(409);
    voter.close();
  });

  it('lets the author recolor a color item; its votes go unless kept', async () => {
    const red = { type: 'solid', colors: ['#aa0000'] };
    const colored = items.map((it, i) => (i < 2 ? { ...it, label: i ? '#AA0000' : 'Rouge', fill: red } : it));
    const duels = [
      { a: 'p0', b: 'p1', s: 1 },
      { a: 'p0', b: 'p2', s: 1 },
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
    // A shade kept: its votes stay.
    expect(await (await recolor('p0', { fill: { type: 'solid', colors: ['#ab0000'] }, reset: false })).json()).toBe(0);
    expect((await voter.next('state')).board.counts.votes).toBe(3);
    // A color alone, as apps from before D116 send it: its votes go.
    expect(await (await recolor('p1', { fill: blue })).json()).toBe(1);
    const state = await voter.next('state');
    expect(state.board.items.find((i) => i.id === 'p1')).toMatchObject({ label: '#2743F5', fill: blue });
    expect(state.board.counts.votes).toBe(2);
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
    // Saying hello again doesn't reset the delay.
    voter.send({ t: 'hello', voter: 'voter-one-1' });
    await voter.next('state');
    voter.send({ t: 'add', item: { label: 'Funghi' } });
    expect((await voter.next('error')).code).toBe('too_fast');
    voter.close();
  });
});

describe('one voter per connection', () => {
  it('refuses a hello as another voter on the same connection', async () => {
    const { alias } = await publish();
    const voter = await Client.open(alias, 'voter-one-1');
    const [a, b] = (await voter.next('state')).pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    await voter.next('pairs');
    voter.send({ t: 'hello', voter: 'someone-else-2' });
    expect((await voter.next('error')).code).toBe('forbidden');
    // The connection keeps its voter: its next vote is still theirs.
    voter.send({ t: 'hello', voter: 'voter-one-1' });
    const { pairs, mine } = await voter.next('state');
    expect(mine).toHaveLength(1);
    const [c, d] = pairs[0] as [string, string];
    await sleep(ACTION_INTERVAL_MS + 20);
    voter.send({ t: 'vote', a: c, b: d, s: 0 });
    expect((await voter.next('pairs')).mine).toBe(2);
    expect((await view(alias)).body.counts).toMatchObject({ votes: 2, voters: 1 });
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
    // Only from the board's voters: someone who voted at least once.
    expect((await report({ voter: 'voter-one-1', reason: 'spam' })).status).toBe(403);
    for (const voter of ['voter-one-1', 'voter-two-2']) {
      const c = await Client.open(alias, voter);
      const [a, b] = (await c.next('state')).pairs[0] as [string, string];
      c.send({ t: 'vote', a, b, s: 1 });
      expect((await c.next('pairs')).mine).toBe(1);
      c.close();
    }
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

describe('official templates', () => {
  const ALIAS_IN_PAGE = /\/app\/b\/([1-9A-HJ-NP-Za-km-z]{10})/;

  it('publishes a template on its first visit and serves its page in each language', async () => {
    const res = await server.fetch('/t/game-consoles/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('The best game console of all time · Versus</title>');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/t\/game-consoles\/" \/>/);
    expect(html).toMatch(/hreflang="fr" href="https?:\/\/[^"]+\/fr\/t\/consoles-de-jeu\/"/);
    expect(html).toMatch(/hreflang="x-default" href="https?:\/\/[^"]+\/t\/game-consoles\/"/);
    expect(html).toContain('<h1 class="lg-h">The best game console of all time</h1>');
    // The shell's relative addresses (its styles, its script) keep resolving from the legal page's folder.
    expect(html).toContain('<head><base href="/legal/" />');
    expect(html).toContain('Nintendo Switch');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toMatch(/href="\/fr\/t\/consoles-de-jeu\/"[^>]*data-lang="fr"/);
    expect(html).toContain('href="/t/video-games/"');
    const alias = html.match(ALIAS_IN_PAGE)?.[1];
    expect(alias).toBeDefined();
    // The same board again, and in French a board of its own.
    expect(await (await server.fetch('/t/game-consoles/')).text()).toContain(`/app/b/${alias}`);
    const fr = await server.fetch('/fr/t/consoles-de-jeu/');
    expect(fr.status).toBe(200);
    const frHtml = await fr.text();
    expect(frHtml).toContain('<html lang="fr">');
    expect(frHtml).toContain('La meilleure console de jeu de tous les temps');
    expect(frHtml).not.toContain(`/app/b/${alias}`);
    // A real board, open, results always visible; the admin sees it as official.
    const v = await view(alias ?? '');
    expect(v.body).toMatchObject({ title: 'The best game console of all time', status: 'open' });
    expect(v.body.items).toHaveLength(12);
    expect(v.body.ranking).not.toBeNull();
    const full = (await (await adminApi(`/boards/${alias}`)).json()) as AdminBoardView;
    expect(full.alias).toBe(alias);
    await vi.waitFor(
      async () => {
        const list = (await (await adminApi('/boards?q=console')).json()) as AdminList;
        expect(list.boards.find((b) => b.alias === alias)).toMatchObject({ template: 'game-consoles', lang: 'en' });
      },
      { timeout: 5000, interval: 200 },
    );
    // Unknown slug, a slug of the other language, a missing slash.
    expect((await server.fetch('/t/nothing-here/')).status).toBe(404);
    expect((await server.fetch('/t/consoles-de-jeu/')).status).toBe(404);
    expect((await server.fetch('/t/game-consoles/more/')).status).toBe(404);
    const moved = await server.fetch('/t/game-consoles', { redirect: 'manual' });
    expect(moved.status).toBe(301);
    expect(moved.headers.get('Location')).toMatch(/\/t\/game-consoles\/$/);
  });

  it('publishes a template again when its registry row outlived its board', async () => {
    const first = (await (await server.fetch('/t/computers/')).text()).match(ALIAS_IN_PAGE)?.[1] ?? '';
    expect(first).not.toBe('');
    // The board is gone but its row stays (as when the registry delete failed): its storage wiped behind the row.
    const sql = await server.getWorker().getDurableObjectStorage('BoardObject', { name: first });
    await sql.exec('DELETE FROM meta');
    await server.getWorker().evictDurableObject('BoardObject', { name: first });
    expect((await view(first)).status).toBe(404);
    const res = await server.fetch('/t/computers/');
    expect(res.status).toBe(200);
    const again = (await res.text()).match(ALIAS_IN_PAGE)?.[1] ?? '';
    expect(again).not.toBe(first);
    expect((await view(again)).body.title).toBe('Mac or PC: the best computer to work on');
    // The same board from now on.
    expect(await (await server.fetch('/t/computers/')).text()).toContain(`/app/b/${again}`);
  });

  it('writes a template page’s JSON-LD so that it parses back exactly', async () => {
    const alias = (await (await server.fetch('/t/cameras/')).text()).match(ALIAS_IN_PAGE)?.[1] ?? '';
    // A label no template has, written straight into the board's storage.
    const label = 'Fish & <Chips> "</script><script>alert(1)</script>';
    const sql = await server.getWorker().getDurableObjectStorage('BoardObject', { name: alias });
    await sql.exec("UPDATE meta SET v = json_set(v, '$[0].label', ?) WHERE k = 'items'", label);
    await server.getWorker().evictDurableObject('BoardObject', { name: alias });
    const html = await (await server.fetch('/t/cameras/')).text();
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '';
    const graph = JSON.parse(ld) as { '@graph': { '@type': string; itemListElement?: { name: string }[] }[] };
    const list = graph['@graph'].find((node) => node['@type'] === 'ItemList');
    expect(list?.itemListElement?.map((e) => e.name)).toContain(label);
    expect(html).not.toContain('<script>alert(1)');
  });

  it('lists the templates and the featured boards as Popular, never a hidden one', async () => {
    const fr = (await (await server.fetch('/api/popular?lang=fr')).json()) as { boards: PopularBoard[] };
    expect(fr.boards).toHaveLength(TEMPLATES.length);
    for (const b of fr.boards) {
      expect(b.lang).toBe('fr');
      expect(b.template).not.toBe('');
      expect(b.top).toHaveLength(3);
      expect(Object.keys(b)).not.toContain('hidden');
      expect(Object.keys(b)).not.toContain('reports');
    }
    expect(fr.boards.map((b) => b.title)).toContain('La meilleure pâtisserie française');
    // The first call in a language publishes the templates still missing (once).
    const en0 = (await (await server.fetch('/api/popular?lang=en')).json()) as { boards: PopularBoard[] };
    expect(en0.boards.filter((b) => b.template).length).toBe(TEMPLATES.length);
    // A board the admin puts forward comes first; hidden, it leaves the list.
    const { alias } = await publish();
    await adminApi(`/boards/${alias}`, { method: 'PATCH', body: { featured: true } });
    await vi.waitFor(
      async () => {
        const en = (await (await server.fetch('/api/popular?lang=en')).json()) as { boards: PopularBoard[] };
        const i = en.boards.findIndex((b) => b.alias === alias);
        expect(en.boards[i]).toMatchObject({ alias, featured: true, title: 'Pizzas', template: '' });
        // Featured boards (this one, and the one an earlier test featured) all come before the templates.
        expect(en.boards.slice(0, i + 1).every((b) => b.featured)).toBe(true);
        expect(en.boards.slice(i + 1).some((b) => b.template)).toBe(true);
      },
      { timeout: 5000, interval: 200 },
    );
    await adminApi(`/boards/${alias}`, { method: 'PATCH', body: { hidden: true } });
    await vi.waitFor(
      async () => {
        const en = (await (await server.fetch('/api/popular?lang=en')).json()) as { boards: PopularBoard[] };
        expect(en.boards.some((b) => b.alias === alias)).toBe(false);
      },
      { timeout: 5000, interval: 200 },
    );
    expect((await server.fetch('/api/popular', { method: 'POST' })).status).toBe(404);
  });

  it('adds the template pages that have a crowd to the sitemap, and asks to index them', async () => {
    const before = await (await server.fetch('/sitemap.xml')).text();
    expect(before).toContain('<urlset');
    expect(before).not.toContain('/t/');
    // One voter is a crowd for this test.
    await server.update({
      workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN }, vars: { TEMPLATE_INDEX_VOTERS: '1' } }],
    });
    const page = await (await server.fetch('/t/game-consoles/')).text();
    const alias = page.match(ALIAS_IN_PAGE)?.[1] ?? '';
    const voter = await Client.open(alias, 'voter-tpl-1');
    const st = await voter.next('state');
    const [a, b] = st.pairs[0] as [string, string];
    voter.send({ t: 'vote', a, b, s: 1 });
    await voter.next('pairs');
    voter.close();
    await vi.waitFor(
      async () => {
        const res = await server.fetch('/sitemap.xml');
        expect(res.headers.get('Content-Type')).toContain('application/xml');
        const xml = await res.text();
        expect(xml).toMatch(
          /<url><loc>https?:\/\/[^<]+\/t\/game-consoles\/<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod><\/url>/,
        );
        expect(xml).not.toContain('/fr/t/consoles-de-jeu/');
        expect(xml.trim().endsWith('</urlset>')).toBe(true);
      },
      { timeout: 5000, interval: 200 },
    );
    const res = await server.fetch('/t/game-consoles/');
    expect(res.headers.get('X-Robots-Tag')).toBe('all');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="index, follow');
    expect(html).toContain('1 vote');
  });
});

describe('pictures for review', () => {
  const fakeJpeg = (size = 1024) => {
    const b = new Uint8Array(size);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return b;
  };
  const sendPicture = (alias: string, id: string, bytes: Uint8Array, token?: string, type = 'image/jpeg') =>
    server.fetch(`/api/boards/${alias}/items/${id}/image`, {
      method: 'PUT',
      headers: {
        'Content-Type': type,
        'CF-Connecting-IP': nextIp(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: bytes,
    });
  const announced = (...ids: string[]) => items.map((it) => (ids.includes(it.id) ? { ...it, pic: 'pending' } : it));
  const publishPics = async (list: unknown[]) => {
    const res = await api('', { method: 'POST', body: { title: 'Photos', items: list, voter: AUTHOR } });
    expect(res.status).toBe(201);
    return (await res.json()) as { alias: string; owner: string };
  };
  const decide = (alias: string, id: string, decision: string, etag?: string) =>
    adminApi(`/boards/${alias}/items/${id}/picture`, { method: 'POST', body: { decision, etag } });
  /** The picture as the admin sees it, and the ETag an approval sends back. */
  const look = async (alias: string, id: string) => {
    const res = await adminApi(`/boards/${alias}/items/${id}/image`);
    return { status: res.status, etag: res.headers.get('ETag') ?? '', bytes: new Uint8Array(await res.arrayBuffer()) };
  };

  it('refuses announced pictures while they are off, and says so in its config', async () => {
    expect(await (await server.fetch('/api/config')).json()).toEqual({ images: 'off' });
    const res = await api('', { method: 'POST', body: { title: 'Photos', items: announced('p0'), voter: AUTHOR } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'images_not_allowed' });
  });

  it('keeps a picture for review, shows it to the admin only, then to everyone once approved', async () => {
    await server.update({
      workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN }, vars: { IMAGES_UPLOAD: 'review' } }],
    });
    expect(await (await server.fetch('/api/config')).json()).toEqual({ images: 'review' });
    const { alias, owner } = await publishPics(announced('p0'));
    const first = (await view(alias)).body.items;
    expect(first[0]).toMatchObject({ id: 'p0', img: null, pic: 'pending' });
    expect(Object.keys(first[1] ?? {})).not.toContain('pic');
    // Only the author, only for an item that announced one, only a JPEG within the limit.
    expect((await sendPicture(alias, 'p0', fakeJpeg())).status).toBe(403);
    expect((await sendPicture(alias, 'p1', fakeJpeg(), owner)).status).toBe(404);
    expect((await sendPicture(alias, 'p0', fakeJpeg(), owner, 'image/png')).status).toBe(415);
    expect((await sendPicture(alias, 'p0', fakeJpeg(LIMITS.picture + 1), owner)).status).toBe(413);
    expect((await sendPicture(alias, 'p0', new Uint8Array([1, 2, 3, 4, 5]), owner)).status).toBe(400);
    expect((await sendPicture(alias, 'p0', fakeJpeg(), owner)).status).toBe(201);
    // Not public yet; the admin sees it.
    expect((await server.fetch(`/img/b/${alias}/p0.jpg`)).status).toBe(404);
    expect((await server.fetch(`/img/b/${alias}/p0.png`)).status).toBe(404);
    expect((await server.fetch('/img/b/nope/p0.jpg')).status).toBe(404);
    const mine = await adminApi(`/boards/${alias}/items/p0/image`);
    expect(mine.status).toBe(200);
    expect(mine.headers.get('Content-Type')).toBe('image/jpeg');
    const etag = mine.headers.get('ETag') ?? '';
    expect(etag).not.toBe('');
    expect((await adminApi(`/boards/${alias}/items/p0/image`, { token: 'wrong' })).status).toBe(403);
    expect((await adminApi(`/boards/${alias}/items/p0/other`)).status).toBe(404);
    await vi.waitFor(
      async () => {
        const list = (await (await adminApi('/boards?filter=pictures')).json()) as AdminList;
        expect(list.boards.find((b) => b.alias === alias)).toMatchObject({ pictures: 1 });
      },
      { timeout: 5000, interval: 200 },
    );
    expect(((await (await adminApi('/stats')).json()) as AdminTotals).pictures).toBeGreaterThan(0);
    // Approved: the item shows it from its public address, voters included, right away.
    const voter = await Client.open(alias, 'voter-pic-1');
    await voter.next('state');
    expect((await decide(alias, 'p0', 'maybe')).status).toBe(400);
    const ok = await decide(alias, 'p0', 'ok', etag);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: 'p0', img: `/img/b/${alias}/p0.jpg` });
    const pushed = await voter.next('state');
    expect(pushed.board.items[0]).toMatchObject({ id: 'p0', img: `/img/b/${alias}/p0.jpg` });
    expect(Object.keys(pushed.board.items[0] ?? {})).not.toContain('pic');
    voter.close();
    const shown = await server.fetch(`/img/b/${alias}/p0.jpg`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get('Content-Type')).toBe('image/jpeg');
    // Decided once; the board leaves the list of pictures to review.
    expect((await decide(alias, 'p0', 'ok', etag)).status).toBe(400);
    expect((await server.fetch(`/img/b/${alias}/p0.jpg`)).status).toBe(200);
    await vi.waitFor(
      async () => {
        const list = (await (await adminApi('/boards?filter=pictures')).json()) as AdminList;
        expect(list.boards.some((b) => b.alias === alias)).toBe(false);
      },
      { timeout: 5000, interval: 200 },
    );
  });

  it('takes pictures for items the author adds after publication', async () => {
    const { alias, owner } = await publishPics(items);
    const res = await api(`/${alias}/items`, {
      method: 'POST',
      token: owner,
      body: {
        items: [
          { label: 'Dunes', fill: null, pic: 'pending' },
          { label: 'Cliffs', fill: null },
        ],
      },
    });
    const [dunes, cliffs] = (await res.json()) as { id: string; pic?: string }[];
    expect(dunes?.pic).toBe('pending');
    expect(cliffs?.pic).toBeUndefined();
    expect((await sendPicture(alias, dunes?.id ?? '', fakeJpeg(), owner)).status).toBe(201);
    expect((await sendPicture(alias, cliffs?.id ?? '', fakeJpeg(), owner)).status).toBe(404);
    expect((await adminApi(`/boards/${alias}/items/${dunes?.id}/image`)).status).toBe(200);
  });

  it('approves the picture the admin saw, not one sent since', async () => {
    const { alias, owner } = await publishPics(announced('p0'));
    const seen = fakeJpeg(1024);
    const sentSince = fakeJpeg(2048);
    expect((await sendPicture(alias, 'p0', seen, owner)).status).toBe(201);
    const first = await look(alias, 'p0');
    expect(first.bytes).toEqual(seen);
    expect((await sendPicture(alias, 'p0', sentSince, owner)).status).toBe(201);
    const stale = await decide(alias, 'p0', 'ok', first.etag);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'changed' });
    expect((await decide(alias, 'p0', 'ok')).status).toBe(409);
    expect((await server.fetch(`/img/b/${alias}/p0.jpg`)).status).toBe(404);
    expect((await view(alias)).body.items[0]).toMatchObject({ id: 'p0', pic: 'pending' });
    // Looked at again: that one is approved, and it is what everyone sees.
    const second = await look(alias, 'p0');
    expect(second.etag).not.toBe(first.etag);
    expect((await decide(alias, 'p0', 'ok', second.etag)).status).toBe(200);
    const shown = await server.fetch(`/img/b/${alias}/p0.jpg`);
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(sentSince);
  });

  it('leaves nothing public when the board no longer waits for the picture approved', async () => {
    const { alias } = await publishPics(announced('p0'));
    // A picture stored for an item that awaits none (as after the item went meanwhile), straight into R2.
    const env = await server
      .getWorker<{ IMAGES: { put(key: string, value: Uint8Array, options: unknown): Promise<unknown> } }>()
      .getEnv();
    await env.IMAGES.put(`img/${alias}/p1.jpg`, fakeJpeg(), {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { state: 'pending' },
    });
    const { etag } = await look(alias, 'p1');
    expect((await decide(alias, 'p1', 'ok', etag)).status).toBe(400);
    expect((await server.fetch(`/img/b/${alias}/p1.jpg`)).status).toBe(404);
    expect((await look(alias, 'p1')).status).toBe(404);
  });

  it('deletes a refused picture, needs one to approve, and drops them all with the board', async () => {
    const { alias, owner } = await publishPics(announced('p1', 'p2', 'p3'));
    expect((await sendPicture(alias, 'p1', fakeJpeg(), owner)).status).toBe(201);
    expect((await sendPicture(alias, 'p2', fakeJpeg(), owner)).status).toBe(201);
    const no = await decide(alias, 'p1', 'refused');
    expect(await no.json()).toMatchObject({ id: 'p1', img: null, pic: 'refused' });
    expect((await adminApi(`/boards/${alias}/items/p1/image`)).status).toBe(404);
    expect((await view(alias)).body.items[1]).toMatchObject({ id: 'p1', img: null, pic: 'refused' });
    // Nothing arrived for p3: nothing to approve.
    expect((await decide(alias, 'p3', 'ok')).status).toBe(404);
    // Removing an item takes its picture along; taking the board down takes the rest.
    expect((await adminApi(`/boards/${alias}/items/p2`, { method: 'DELETE' })).status).toBe(200);
    await vi.waitFor(async () => expect((await adminApi(`/boards/${alias}/items/p2/image`)).status).toBe(404), {
      timeout: 5000,
      interval: 200,
    });
    const { alias: other, owner: owner2 } = await publishPics(announced('p0'));
    expect((await sendPicture(other, 'p0', fakeJpeg(), owner2)).status).toBe(201);
    expect((await adminApi(`/boards/${other}`, { method: 'DELETE' })).status).toBe(200);
    await vi.waitFor(async () => expect((await adminApi(`/boards/${other}/items/p0/image`)).status).toBe(404), {
      timeout: 5000,
      interval: 200,
    });
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

  it('limits "Your votes" refreshes per IP, before waking any board', async () => {
    const body = { voter: 'voter-one-1', aliases: ['1111111111'] };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await api('', { method: 'POST', root: '/api/summaries', body, ip: '203.0.113.9' })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    expect((await api('', { method: 'POST', root: '/api/summaries', body, ip: '203.0.113.10' })).status).toBe(200);
  });

  it('counts a body sent without a length, and refuses it past the limit', async () => {
    /** A body of spaces sent in chunks (no Content-Length): the Worker counts the bytes as they come. */
    const chunked = (bytes: number) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let sent = 0; sent < bytes; sent += 64 * 1024) {
            c.enqueue(new Uint8Array(Math.min(64 * 1024, bytes - sent)).fill(0x20));
          }
          c.close();
        },
      });
    const send = (path: string, method: string, type: string, body: ReadableStream<Uint8Array>) =>
      server.fetch(path, {
        method,
        headers: { 'Content-Type': type, 'CF-Connecting-IP': nextIp() },
        body,
        duplex: 'half',
      } as Parameters<typeof server.fetch>[1]);
    // Within the limit, a chunked body is read as usual.
    const json = new TextEncoder().encode(JSON.stringify({ title: 'Chunked', items, voter: AUTHOR }));
    const small = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(json.slice(0, 10));
        c.enqueue(json.slice(10));
        c.close();
      },
    });
    const res = await send('/api/boards', 'POST', 'application/json', small);
    expect(res.status).toBe(201);
    const { alias } = (await res.json()) as { alias: string };
    // One byte over: refused, for JSON, a card and a picture alike.
    expect((await send('/api/boards', 'POST', 'application/json', chunked(512 * 1024 + 1))).status).toBe(413);
    expect(
      (await send(`/api/boards/${alias}/card?duel=p0.p1`, 'PUT', 'image/png', chunked(CARD_MAX_BYTES + 1))).status,
    ).toBe(413);
    const picture = `/api/boards/${alias}/items/p0/image`;
    expect((await send(picture, 'PUT', 'image/jpeg', chunked(LIMITS.picture + 1))).status).toBe(413);
  });

  it('asks for a Turnstile token once a secret is set', async () => {
    await server.update({ workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN, TURNSTILE_SECRET: 'x' } }] });
    const res = await api('', { method: 'POST', body: { title: 'Pizzas', items, voter: AUTHOR } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'captcha' });
  });
});

describe('human checks', () => {
  it('asks for one before a first vote on the site’s own boards, once a secret is set', async () => {
    await server.update({ workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN } }] });
    const page = await (await server.fetch('/t/superheroes/')).text();
    const alias = page.match(/\/app\/b\/([1-9A-HJ-NP-Za-km-z]{10})/)?.[1] ?? '';
    const vote = async (c: Client) => {
      const [a, b] = (await c.next('state')).pairs[0] as [string, string];
      c.send({ t: 'vote', a, b, s: 1 });
    };
    const early = await Client.open(alias, 'early-voter-1');
    await vote(early);
    expect((await early.next('pairs')).mine).toBe(1);
    early.close();
    const { alias: theirs } = await publish();
    await server.update({ workers: [{ configPath: CONFIG, secrets: { ADMIN_TOKEN: ADMIN, TURNSTILE_SECRET: 'x' } }] });
    // A new voter is asked first; the vote isn't recorded.
    const fresh = await Client.open(alias, 'fresh-voter-1');
    await vote(fresh);
    expect((await fresh.next('error')).code).toBe('captcha');
    expect((await fresh.next('pairs')).mine).toBe(0);
    // A token Turnstile refuses keeps them out (an empty one is refused without asking Turnstile).
    fresh.send({ t: 'check', token: '' });
    expect((await fresh.next('error')).code).toBe('captcha');
    expect((await fresh.next('pairs')).mine).toBe(0);
    fresh.close();
    // A voter who already voted there is never asked, nor is anyone on someone's own board.
    const back = await Client.open(alias, 'early-voter-1');
    await vote(back);
    expect((await back.next('pairs')).mine).toBe(2);
    back.close();
    const visitor = await Client.open(theirs, 'fresh-voter-1');
    await vote(visitor);
    expect((await visitor.next('pairs')).mine).toBe(1);
    visitor.close();
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
