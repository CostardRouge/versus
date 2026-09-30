import { ALIAS_RE, isRecord, makeAlias, parsePublish } from '../../src/core/board';
import { parseSummaryRequest } from '../../src/core/protocol';
import { CARD_MAX_BYTES, parseDuelQuery } from '../../src/core/share';
import type { ErrorCode, Result } from '../../src/core/types';
import { cardURL, preview, readCard, rewriteHead, storeCard } from './cards';
import type { Env } from './env';
import { isFilter, listBoards, totals } from './registry';
import { verifyTurnstile } from './turnstile';

export { BoardObject } from './board-object';

/**
 * API for published boards. Every board lives in its own Durable Object, named by its alias; anything
 * outside /api is the site itself: static files first, then the app's page for every view under /app/
 * (D92; a board's page gets its own link preview, `cards.ts`), the cards under /og/, and the 404 page for
 * the rest (`site()` below).
 *
 *   POST   /api/boards                          publish (PublishInput + Turnstile token) → { alias, owner }
 *   GET    /api/boards/:alias                   public view, or a WebSocket for voters (Upgrade: websocket)
 *   PATCH  /api/boards/:alias                   settings                         (owner)
 *   POST   /api/boards/:alias/close | reopen    freeze votes and reveal / reopen (owner)
 *   POST   /api/boards/:alias/items             add an item                      (owner)
 *   PATCH  /api/boards/:alias/items/:id         recolor a color item ({ fill }); its votes are dropped (owner)
 *   DELETE /api/boards/:alias/items/:id         remove an item and its votes     (owner)
 *   DELETE /api/boards/:alias                   withdraw; returns the local copy (owner)
 *   PUT    /api/boards/:alias/card[?duel=a.b]   the card the board's link (or one duel's) unfurls with: a
 *                                               1200×630 PNG drawn by the app → { url }
 *   POST   /api/boards/:alias/report            { voter, reason, note? }: a visitor reports the board
 *
 *   GET    /og/b/:alias[/:a.:b]/:version.png    a stored card, or the site's card when there is none
 *
 *   POST   /api/summaries                       { voter, aliases } → { [alias]: summary, or null when gone }:
 *                                               the boards of a voter's "Your votes", as that voter may see them
 *
 *   GET    /api/admin/stats                     totals from the registry         (admin)
 *   GET    /api/admin/boards?limit&offset&filter&q   boards, most recently active first; `filter` is one of
 *                                               all, reported, featured, hidden, open, closed; `q` words of the title
 *   GET    /api/admin/boards/:alias             full view, ranking, flags and reports included
 *   PATCH  /api/admin/boards/:alias             { hidden?, featured? }: moderation flags
 *   POST   /api/admin/boards/:alias/close | reopen
 *   DELETE /api/admin/boards/:alias/items/:id   remove an item (moderation)
 *   DELETE /api/admin/boards/:alias/reports     the reports were reviewed
 *   DELETE /api/admin/boards/:alias             take the board down
 *
 * Owners send `Authorization: Bearer <owner token>`, admins `Authorization: Bearer <ADMIN_TOKEN>`. The admin
 * page (`/admin/`, built with the app) calls the admin routes with the token typed on it; put Cloudflare Access
 * in front of `/admin/*` and `/api/admin/*` once deployed (docs/online-architecture.md#moderation).
 */

const MAX_BODY = 512 * 1024;

const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  captcha: 403,
  exists: 409,
  closed: 409,
  full: 409,
  too_few: 409,
  too_large: 413,
  unsupported: 415,
  rate_limited: 429,
};

type Code = ErrorCode | 'too_large' | 'unsupported';

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const error = (code: Code): Response => json({ error: code }, STATUS[code] ?? 400);

const reply = <T>(r: Result<T>): Response => (r.ok ? json(r.value) : error(r.error));

const bearer = (req: Request): string => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';

const clientIp = (req: Request): string => req.headers.get('CF-Connecting-IP') ?? 'unknown';

const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** Parsed JSON body, `undefined` when invalid, `null` when too large. */
async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** False when this IP went over the limit. Without the binding (local tools), everything passes. */
async function allowed(limit: RateLimit | undefined, req: Request): Promise<boolean> {
  return !limit || (await limit.limit({ key: clientIp(req) })).success;
}

async function publish(req: Request, env: Env): Promise<Response> {
  if (!(await allowed(env.PUBLISH_LIMIT, req))) return error('rate_limited');
  const body = await readJson(req);
  if (body === null) return error('too_large');
  const input = parsePublish(body);
  if (!input.ok) return error(input.error);
  if (env.TURNSTILE_SECRET) {
    const token = isRecord(body) ? body.turnstile : undefined;
    const ip = req.headers.get('CF-Connecting-IP');
    if (!(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) return error('captcha');
  }
  const owner = toHex(randomBytes(32));
  // 58^10 aliases: a collision is practically impossible, but the object refuses to be published twice.
  for (let attempt = 0; attempt < 3; attempt++) {
    const alias = makeAlias(randomBytes);
    const board = env.BOARDS.getByName(alias);
    if ((await board.publish(input.value, owner, alias)) === 'ok') return json({ alias, owner }, 201);
  }
  return error('exists');
}

/** The cards under "Your votes": each board as this voter may see it (the voter id stays out of URLs). */
async function summaries(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (body === null) return error('too_large');
  const input = parseSummaryRequest(body);
  if (!input.ok) return error(input.error);
  const { voter, aliases } = input.value;
  const found = await Promise.all(aliases.map((alias) => env.BOARDS.getByName(alias).summary(voter)));
  return json(Object.fromEntries(aliases.map((alias, i) => [alias, found[i] ?? null])));
}

/**
 * The card a board's link (or one of its duels' links) unfurls with, drawn by the app: stored when the board
 * exists and the bytes are the expected PNG. Off (404) without the images bucket.
 */
async function putCard(req: Request, env: Env, alias: string): Promise<Response> {
  const bucket = env.IMAGES;
  if (!bucket) return error('not_found');
  if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('image/png')) return error('unsupported');
  if (Number(req.headers.get('Content-Length') ?? 0) > CARD_MAX_BYTES) return error('too_large');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > CARD_MAX_BYTES) return error('too_large');
  const unfurl = await env.BOARDS.getByName(alias).unfurl();
  if (!unfurl) return error('not_found');
  const pair = parseDuelQuery(new URL(req.url).search);
  const stored = await storeCard(bucket, alias, unfurl, pair, bytes);
  if (stored !== 'ok') return error(stored);
  return json({ url: cardURL(new URL(req.url).origin, alias, pair, new Date()) }, 201);
}

/** Routes under /api/boards/:alias. */
async function board(req: Request, env: Env, alias: string, rest: string[]): Promise<Response> {
  const stub = env.BOARDS.getByName(alias);
  const [action, id, ...extra] = rest;
  if (extra.length) return error('not_found');
  const m = req.method;
  if (action === 'card' && id === undefined) return m === 'PUT' ? putCard(req, env, alias) : error('not_found');
  if (action === 'report' && id === undefined) {
    if (m !== 'POST') return error('not_found');
    const body = await readJson(req);
    return body === null ? error('too_large') : reply(await stub.report(body));
  }
  if (action === undefined) {
    if (m === 'GET') {
      if (req.headers.get('Upgrade')?.toLowerCase() === 'websocket') return stub.fetch(req);
      const view = await stub.view();
      return view ? json(view) : error('not_found');
    }
    if (m === 'PATCH') {
      const patch = await readJson(req);
      return patch === null ? error('too_large') : reply(await stub.updateSettings(bearer(req), patch));
    }
    if (m === 'DELETE') return reply(await stub.withdraw(bearer(req)));
  } else if (m === 'POST' && id === undefined && (action === 'close' || action === 'reopen')) {
    return reply(await stub.setStatus(bearer(req), action === 'close' ? 'closed' : 'open'));
  } else if (action === 'items') {
    if (m === 'POST' && id === undefined) {
      const item = await readJson(req);
      return item === null ? error('too_large') : reply(await stub.addItem(bearer(req), item));
    }
    if (m === 'PATCH' && id !== undefined) {
      const body = await readJson(req);
      if (body === null) return error('too_large');
      return reply(await stub.recolorItem(bearer(req), id, isRecord(body) ? body.fill : undefined));
    }
    if (m === 'DELETE' && id !== undefined) return reply(await stub.removeItem(bearer(req), id));
  }
  return error('not_found');
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

/** Constant-time check of the admin token (both sides hashed to the same length first). */
async function isAdmin(req: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const [given, expected] = await Promise.all([sha256(bearer(req)), sha256(env.ADMIN_TOKEN)]);
  return crypto.subtle.timingSafeEqual(given, expected);
}

/** Routes under /api/admin. Off (404) until ADMIN_TOKEN is set. */
async function admin(req: Request, env: Env, parts: string[]): Promise<Response> {
  if (!env.ADMIN_TOKEN) return error('not_found');
  if (!(await isAdmin(req, env))) return error('forbidden');
  const [section, alias, action, id, ...extra] = parts;
  const m = req.method;
  if (extra.length) return error('not_found');
  if (section === 'stats' && alias === undefined && m === 'GET') {
    return env.REGISTRY ? json(await totals(env.REGISTRY)) : error('not_found');
  }
  if (section !== 'boards') return error('not_found');
  if (alias === undefined) {
    if (m !== 'GET' || !env.REGISTRY) return error('not_found');
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const rawFilter = url.searchParams.get('filter') ?? 'all';
    const filter = isFilter(rawFilter) ? rawFilter : 'all';
    const q = (url.searchParams.get('q') ?? '').slice(0, 80);
    const boards = await listBoards(env.REGISTRY, { limit, offset, filter, q });
    return json({ boards, limit, offset, filter, q });
  }
  if (!ALIAS_RE.test(alias)) return error('not_found');
  const stub = env.BOARDS.getByName(alias);
  if (action === undefined) {
    if (m === 'GET') {
      const view = await stub.adminView();
      return view ? json(view) : error('not_found');
    }
    if (m === 'PATCH') {
      const patch = await readJson(req);
      return patch === null ? error('too_large') : reply(await stub.adminModerate(patch));
    }
    if (m === 'DELETE') return reply(await stub.adminDelete());
  } else if (m === 'POST' && id === undefined && (action === 'close' || action === 'reopen')) {
    return reply(await stub.adminStatus(action === 'close' ? 'closed' : 'open'));
  } else if (action === 'items' && id !== undefined && m === 'DELETE') {
    return reply(await stub.adminRemoveItem(id));
  } else if (action === 'reports' && id === undefined && m === 'DELETE') {
    return reply(await stub.adminClearReports());
  }
  return error('not_found');
}

/**
 * The app's page for a board (`/app/b/<alias>`, with `?duel=a.b` for one of its duels): its head says what the
 * link is about, in the board's language, with the card the app drew when there is one. A board that is gone
 * gets the page as it is (the app then says so).
 */
async function boardPage(req: Request, env: Env, assets: Fetcher, alias: string): Promise<Response> {
  const url = new URL(req.url);
  const page = assets.fetch(new Request(new URL('/app/', url), req));
  if (!ALIAS_RE.test(alias)) return page;
  const unfurl = await env.BOARDS.getByName(alias).unfurl();
  if (!unfurl) return page;
  const p = await preview(env.IMAGES, url.origin, alias, unfurl, url.search);
  return rewriteHead(await page, p, `${url.origin}${url.pathname}${url.search}`);
}

/**
 * What no static file matched outside /api: a view of the app (`/app/demo/…`, `/app/b/…`) gets the app's page,
 * which reads its path; a card under /og/ comes from the bucket, or is the site's card; anything else gets the
 * 404 page with a 404 status.
 */
async function site(req: Request, env: Env, parts: string[]): Promise<Response> {
  const url = new URL(req.url);
  if (!env.ASSETS || (req.method !== 'GET' && req.method !== 'HEAD')) return error('not_found');
  if (parts[0] === 'og') {
    const card = await readCard(env.IMAGES, parts);
    return card ?? env.ASSETS.fetch(new Request(new URL('/og.png', url), req));
  }
  if (url.pathname.startsWith('/app/')) {
    const [, kind, alias, ...more] = parts;
    if (kind === 'b' && alias && !more.length) return boardPage(req, env, env.ASSETS, alias);
    return env.ASSETS.fetch(new Request(new URL('/app/', url), req));
  }
  // `/404`, not `/404.html`: the platform redirects .html addresses to their short form.
  const page = await env.ASSETS.fetch(new Request(new URL('/404', url), req));
  return new Response(page.body, { status: 404, headers: page.headers });
}

export default {
  async fetch(req, env): Promise<Response> {
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    const [api, section, ...rest] = parts;
    // Static files are served before the Worker runs.
    if (api !== 'api') return site(req, env, parts);
    if (!(await allowed(env.API_LIMIT, req))) return error('rate_limited');
    if (section === 'admin') return admin(req, env, rest);
    if (section === 'summaries')
      return req.method === 'POST' && !rest.length ? summaries(req, env) : error('not_found');
    if (section !== 'boards') return error('not_found');
    const [alias, ...more] = rest;
    if (alias === undefined) return req.method === 'POST' ? publish(req, env) : error('not_found');
    if (!ALIAS_RE.test(alias)) return error('not_found');
    return board(req, env, alias, more);
  },
} satisfies ExportedHandler<Env>;
