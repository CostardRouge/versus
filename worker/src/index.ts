import { ALIAS_RE, isRecord, makeAlias, parsePublish } from '../../src/core/board';
import type { ErrorCode, Result } from '../../src/core/types';
import type { Env } from './env';
import { listBoards, totals } from './registry';
import { verifyTurnstile } from './turnstile';

export { BoardObject } from './board-object';

/**
 * API for published boards. Every board lives in its own Durable Object, named by its alias; anything
 * outside /api is the app itself (static assets).
 *
 *   POST   /api/boards                          publish (PublishInput + Turnstile token) → { alias, owner }
 *   GET    /api/boards/:alias                   public view, or a WebSocket for voters (Upgrade: websocket)
 *   PATCH  /api/boards/:alias                   settings                         (owner)
 *   POST   /api/boards/:alias/close | reopen    freeze votes and reveal / reopen (owner)
 *   POST   /api/boards/:alias/items             add an item                      (owner)
 *   PATCH  /api/boards/:alias/items/:id         recolor a color item ({ fill }); its votes are dropped (owner)
 *   DELETE /api/boards/:alias/items/:id         remove an item and its votes     (owner)
 *   DELETE /api/boards/:alias                   withdraw; returns the local copy (owner)
 *
 *   GET    /api/admin/stats                     totals from the registry         (admin)
 *   GET    /api/admin/boards?limit&offset       boards, most recently active first
 *   GET    /api/admin/boards/:alias             full view, ranking included
 *   POST   /api/admin/boards/:alias/close | reopen
 *   DELETE /api/admin/boards/:alias/items/:id   remove an item (moderation)
 *   DELETE /api/admin/boards/:alias             take the board down
 *
 * Owners send `Authorization: Bearer <owner token>`, admins `Authorization: Bearer <ADMIN_TOKEN>`.
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
  rate_limited: 429,
};

type Code = ErrorCode | 'too_large';

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

/** Routes under /api/boards/:alias. */
async function board(req: Request, env: Env, alias: string, rest: string[]): Promise<Response> {
  const stub = env.BOARDS.getByName(alias);
  const [action, id, ...extra] = rest;
  if (extra.length) return error('not_found');
  const m = req.method;
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
    return json({ boards: await listBoards(env.REGISTRY, limit, offset), limit, offset });
  }
  if (!ALIAS_RE.test(alias)) return error('not_found');
  const stub = env.BOARDS.getByName(alias);
  if (action === undefined) {
    if (m === 'GET') {
      const view = await stub.adminView();
      return view ? json(view) : error('not_found');
    }
    if (m === 'DELETE') return reply(await stub.adminDelete());
  } else if (m === 'POST' && id === undefined && (action === 'close' || action === 'reopen')) {
    return reply(await stub.adminStatus(action === 'close' ? 'closed' : 'open'));
  } else if (action === 'items' && id !== undefined && m === 'DELETE') {
    return reply(await stub.adminRemoveItem(id));
  }
  return error('not_found');
}

export default {
  async fetch(req, env): Promise<Response> {
    const [api, section, ...rest] = new URL(req.url).pathname.split('/').filter(Boolean);
    // Static assets are served before the Worker runs; anything else outside /api doesn't exist.
    if (api !== 'api') return error('not_found');
    if (!(await allowed(env.API_LIMIT, req))) return error('rate_limited');
    if (section === 'admin') return admin(req, env, rest);
    if (section !== 'boards') return error('not_found');
    const [alias, ...more] = rest;
    if (alias === undefined) return req.method === 'POST' ? publish(req, env) : error('not_found');
    if (!ALIAS_RE.test(alias)) return error('not_found');
    return board(req, env, alias, more);
  },
} satisfies ExportedHandler<Env>;
