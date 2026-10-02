import { ALIAS_RE, type ImagePolicy, isRecord, LIMITS, parsePublish } from '../../src/core/board';
import { parseSummaryRequest, type ServerConfig } from '../../src/core/protocol';
import { CARD_MAX_BYTES, parseDuelQuery } from '../../src/core/share';
import type { BoardLang, ErrorCode, Result } from '../../src/core/types';
import { cardURL, preview, readCard, rewriteHead, storeCard } from './cards';
import type { Env } from './env';
import { approvePicture, deletePicture, parsePicturePath, readPicture, storePicture } from './pictures';
import { newAlias, newOwnerToken } from './random';
import { isFilter, listBoards, popularBoards, totals } from './registry';
import { ensureTemplates, sitemap, templatePage } from './templates';
import { verifyTurnstile } from './turnstile';
import { vapidKeys } from './webpush';

export { BoardObject } from './board-object';

/**
 * API for published boards. Every board lives in its own Durable Object, named by its alias; anything
 * outside /api is the site itself: static files first, then the app's page for every view under /app/
 * (D92; a board's page gets its own link preview, `cards.ts`), the cards under /og/, and the 404 page for
 * the rest (`site()` below).
 *
 *   POST   /api/boards                          publish (PublishInput + Turnstile token) → { alias, owner }
 *   GET    /api/boards/:alias                   public view, or a WebSocket for voters (Upgrade: websocket)
 *   PATCH  /api/boards/:alias                   settings, and { title }          (owner)
 *   POST   /api/boards/:alias/close | reopen    freeze votes and reveal / reopen (owner)
 *   POST   /api/boards/:alias/items             add an item, or { items: [...] } (owner)
 *   PATCH  /api/boards/:alias/items/:id         { label?, fill?, reset }: rename or recolor; its votes stay
 *                                               unless `reset` (D116) → votes dropped            (owner)
 *   DELETE /api/boards/:alias/items/:id         remove an item and its votes     (owner)
 *   DELETE /api/boards/:alias                   withdraw; returns the local copy (owner)
 *   PUT    /api/boards/:alias/card[?duel=a.b]   the card the board's link (or one duel's) unfurls with: a
 *                                               1200×630 PNG drawn by the app → { url }
 *   POST   /api/boards/:alias/report            { voter, reason, note? }: a visitor reports the board
 *   PUT    /api/boards/:alias/items/:id/image   the picture an item announced (`pic: 'pending'`): a JPEG, kept
 *                                               for the admin's review                             (owner)
 *   POST   /api/boards/:alias/push              { subscription, role, lang }: notify this browser, a voter when
 *                                               the vote closes, the author (owner token) of milestones and pictures
 *   DELETE /api/boards/:alias/push              { endpoint, role? }: stop notifying it
 *   GET    /api/config                          { images, push }: whether pictures may be published (`review`) or
 *                                               not, and the public key for notifications (null when off)
 *
 *   GET    /img/b/:alias/:id.jpg                an item's picture, once the admin approved it
 *
 *   GET    /og/b/:alias[/:a.:b]/:version.png    a stored card, or the site's card when there is none
 *
 *   POST   /api/summaries                       { voter, aliases } → { [alias]: summary, or null when gone }:
 *                                               the boards of a voter's "Your votes", as that voter may see them
 *   GET    /api/popular?lang=en|fr              the Popular section: featured boards and the official templates
 *                                               of that language, the liveliest first (never a hidden board)
 *
 *   GET    /t/:slug/, /fr/t/:slug/              an official template's page (the Worker publishes the board the
 *                                               first time), indexable once it has a crowd
 *   GET    /sitemap.xml                         the static sitemap plus the template pages that have a crowd
 *
 *   GET    /api/admin/stats                     totals from the registry         (admin)
 *   GET    /api/admin/boards?limit&offset&filter&q   boards, most recently active first; `filter` is one of
 *                                               all, reported, featured, hidden, open, closed; `q` words of the title
 *   GET    /api/admin/boards/:alias             full view, ranking, flags and reports included
 *   PATCH  /api/admin/boards/:alias             { hidden?, featured? }: moderation flags
 *   POST   /api/admin/boards/:alias/close | reopen
 *   DELETE /api/admin/boards/:alias/items/:id   remove an item (moderation)
 *   GET    /api/admin/boards/:alias/items/:id/image    a picture awaiting review, to look at it
 *   POST   /api/admin/boards/:alias/items/:id/picture  { decision: 'ok' | 'refused' }
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

/** Whether authors may publish pictures (sent for review): the IMAGES_UPLOAD variable, off unless `review`. */
const imagePolicy = (env: Env): ImagePolicy & ServerConfig['images'] =>
  env.IMAGES_UPLOAD === 'review' ? 'review' : 'off';

const config = (env: Env): Response =>
  Response.json({ images: imagePolicy(env), push: vapidKeys(env)?.publicKey ?? null } satisfies ServerConfig, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });

async function publish(req: Request, env: Env): Promise<Response> {
  if (!(await allowed(env.PUBLISH_LIMIT, req))) return error('rate_limited');
  const body = await readJson(req);
  if (body === null) return error('too_large');
  const input = parsePublish(body, imagePolicy(env));
  if (!input.ok) return error(input.error);
  if (env.TURNSTILE_SECRET) {
    const token = isRecord(body) ? body.turnstile : undefined;
    const ip = req.headers.get('CF-Connecting-IP');
    if (!(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) return error('captcha');
  }
  const owner = newOwnerToken();
  // 58^10 aliases: a collision is practically impossible, but the object refuses to be published twice.
  for (let attempt = 0; attempt < 3; attempt++) {
    const alias = newAlias();
    const board = env.BOARDS.getByName(alias);
    if ((await board.publish(input.value, owner, alias)) === 'ok') return json({ alias, owner }, 201);
  }
  return error('exists');
}

/** The Popular section of one language, from the registry; the templates are published first when missing. */
async function popular(req: Request, env: Env): Promise<Response> {
  const db = env.REGISTRY;
  if (!db) return json({ boards: [] });
  const lang: BoardLang = new URL(req.url).searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  await ensureTemplates(env, lang);
  const boards = await popularBoards(db, lang, 16);
  return Response.json({ boards }, { headers: { 'Cache-Control': 'public, max-age=300' } });
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

/**
 * The picture an item announced at publication, sent by the author for the admin's review: a JPEG within the
 * size limit, for an item still waiting for one. Off (404) without the images bucket.
 */
async function putPicture(req: Request, env: Env, alias: string, id: string): Promise<Response> {
  const bucket = env.IMAGES;
  if (!bucket) return error('not_found');
  if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('image/jpeg')) return error('unsupported');
  if (Number(req.headers.get('Content-Length') ?? 0) > LIMITS.picture) return error('too_large');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > LIMITS.picture) return error('too_large');
  const slot = await env.BOARDS.getByName(alias).pictureSlot(bearer(req), id);
  if (!slot.ok) return error(slot.error);
  const stored = await storePicture(bucket, alias, id, bytes);
  return stored === 'ok' ? json({ ok: true }, 201) : error(stored);
}

/** Routes under /api/boards/:alias. */
async function board(req: Request, env: Env, alias: string, rest: string[]): Promise<Response> {
  const stub = env.BOARDS.getByName(alias);
  const [action, id, ...extra] = rest;
  const m = req.method;
  if (action === 'items' && id !== undefined && extra.length === 1 && extra[0] === 'image') {
    return m === 'PUT' ? putPicture(req, env, alias, id) : error('not_found');
  }
  if (extra.length) return error('not_found');
  if (action === 'card' && id === undefined) return m === 'PUT' ? putCard(req, env, alias) : error('not_found');
  if (action === 'report' && id === undefined) {
    if (m !== 'POST') return error('not_found');
    const body = await readJson(req);
    return body === null ? error('too_large') : reply(await stub.report(body));
  }
  if (action === 'push' && id === undefined) {
    if ((m !== 'POST' && m !== 'DELETE') || !vapidKeys(env)) return error('not_found');
    const body = await readJson(req);
    if (body === null) return error('too_large');
    if (m === 'DELETE') return reply(await stub.unsubscribePush(body));
    return reply(await stub.subscribePush(bearer(req), body, new URL(req.url).origin));
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
      return body === null ? error('too_large') : reply(await stub.editItem(bearer(req), id, body));
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
  // An item's picture: look at it, then decide.
  if (section === 'boards' && alias && ALIAS_RE.test(alias) && action === 'items' && id && extra.length === 1) {
    if (extra[0] === 'image' && m === 'GET')
      return (await readPicture(env.IMAGES, alias, id, true)) ?? error('not_found');
    if (extra[0] === 'picture' && m === 'POST') return decidePictureRoute(req, env, alias, id);
    return error('not_found');
  }
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
 * The admin's decision on a picture: approved, the stored picture becomes public and the item shows it;
 * refused, the picture is deleted and the item stays as text.
 */
async function decidePictureRoute(req: Request, env: Env, alias: string, id: string): Promise<Response> {
  const bucket = env.IMAGES;
  if (!bucket) return error('not_found');
  const body = await readJson(req);
  if (body === null) return error('too_large');
  const decision = isRecord(body) ? body.decision : undefined;
  if (decision !== 'ok' && decision !== 'refused') return error('bad_request');
  const stub = env.BOARDS.getByName(alias);
  if (decision === 'ok' && !(await approvePicture(bucket, alias, id))) return error('not_found');
  const r = await stub.adminPicture(id, decision);
  if (r.ok && decision === 'refused') await deletePicture(bucket, alias, id);
  return reply(r);
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
  const assets = env.ASSETS;
  if (!assets || (req.method !== 'GET' && req.method !== 'HEAD')) return error('not_found');
  // `/404`, not `/404.html`: the platform redirects .html addresses to their short form.
  const notFound = async () => {
    const page = await assets.fetch(new Request(new URL('/404', url), req));
    return new Response(page.body, { status: 404, headers: page.headers });
  };
  if (parts[0] === 'og') {
    const card = await readCard(env.IMAGES, parts);
    return card ?? assets.fetch(new Request(new URL('/og.png', url), req));
  }
  if (parts[0] === 'img') {
    const named = parsePicturePath(parts);
    const picture = named ? await readPicture(env.IMAGES, named.alias, named.id, false) : null;
    return picture ?? error('not_found');
  }
  if (url.pathname.startsWith('/app/')) {
    const [, kind, alias, ...more] = parts;
    if (kind === 'b' && alias && !more.length) return boardPage(req, env, assets, alias);
    return assets.fetch(new Request(new URL('/app/', url), req));
  }
  if (parts.length === 1 && parts[0] === 'sitemap.xml') return sitemap(req, env, assets);
  // The template pages: /t/<slug>/ in English, /fr/t/<slug>/ in French.
  if (parts.length === 2 && parts[0] === 't' && parts[1])
    return templatePage(req, env, assets, 'en', parts[1], notFound);
  if (parts.length === 3 && parts[0] === 'fr' && parts[1] === 't' && parts[2]) {
    return templatePage(req, env, assets, 'fr', parts[2], notFound);
  }
  return notFound();
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
    if (section === 'popular') return req.method === 'GET' && !rest.length ? popular(req, env) : error('not_found');
    if (section === 'config') return req.method === 'GET' && !rest.length ? config(env) : error('not_found');
    if (section !== 'boards') return error('not_found');
    const [alias, ...more] = rest;
    if (alias === undefined) return req.method === 'POST' ? publish(req, env) : error('not_found');
    if (!ALIAS_RE.test(alias)) return error('not_found');
    return board(req, env, alias, more);
  },
} satisfies ExportedHandler<Env>;
