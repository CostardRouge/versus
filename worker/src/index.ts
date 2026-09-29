import { ALIAS_RE, makeAlias, parsePublish } from '../../src/core/board';
import type { ErrorCode, Result } from '../../src/core/types';
import type { Env } from './env';

export { BoardObject } from './board-object';

/**
 * API router for published boards. Every board lives in its own Durable Object, named by its alias.
 *
 *   POST   /api/boards                   publish (body: PublishInput) → { alias, owner }
 *   GET    /api/boards/:alias            public view, or a WebSocket for voters (Upgrade: websocket)
 *   PATCH  /api/boards/:alias            settings (owner)
 *   POST   /api/boards/:alias/close      freeze votes, reveal results (owner)
 *   POST   /api/boards/:alias/reopen     (owner)
 *   DELETE /api/boards/:alias            withdraw; returns the author's local copy (owner)
 *
 * The owner authenticates with `Authorization: Bearer <owner token>`.
 */

const MAX_BODY = 512 * 1024;

const STATUS: Record<string, number> = { not_found: 404, forbidden: 403, exists: 409, closed: 409, too_large: 413 };

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const error = (code: ErrorCode | 'too_large'): Response => json({ error: code }, STATUS[code] ?? 400);

const reply = <T>(r: Result<T>): Response => (r.ok ? json(r.value) : error(r.error));

const bearer = (req: Request): string => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';

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

async function publish(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (body === null) return error('too_large');
  const input = parsePublish(body);
  if (!input.ok) return error(input.error);
  const owner = toHex(randomBytes(32));
  // 58^10 aliases: a collision is practically impossible, but the object refuses to be published twice.
  for (let attempt = 0; attempt < 3; attempt++) {
    const alias = makeAlias(randomBytes);
    if ((await env.BOARDS.getByName(alias).publish(input.value, owner)) === 'ok') return json({ alias, owner }, 201);
  }
  return error('exists');
}

export default {
  async fetch(req, env): Promise<Response> {
    const [api, boards, alias, action, ...rest] = new URL(req.url).pathname.split('/').filter(Boolean);
    if (api !== 'api' || boards !== 'boards' || rest.length) return error('not_found');
    if (alias === undefined) return req.method === 'POST' ? publish(req, env) : error('not_found');
    if (!ALIAS_RE.test(alias)) return error('not_found');
    const board = env.BOARDS.getByName(alias);

    if (action === undefined) {
      if (req.method === 'GET') {
        if (req.headers.get('Upgrade')?.toLowerCase() === 'websocket') return board.fetch(req);
        const view = await board.view();
        return view ? json(view) : error('not_found');
      }
      if (req.method === 'PATCH') {
        const patch = await readJson(req);
        return patch === null ? error('too_large') : reply(await board.updateSettings(bearer(req), patch));
      }
      if (req.method === 'DELETE') return reply(await board.withdraw(bearer(req)));
    } else if (req.method === 'POST' && (action === 'close' || action === 'reopen')) {
      return reply(await board.setStatus(bearer(req), action === 'close' ? 'closed' : 'open'));
    }
    return error('not_found');
  },
} satisfies ExportedHandler<Env>;
