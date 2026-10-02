import { type UnfurlLang, unfurlPlural, unfurlText } from '../i18n/unfurl';
import { ALIAS_RE, isRecord } from './board';
import { routePath } from './route';
import type { BoardLang, Result } from './types';

/**
 * Notifications of published boards (Web Push, D125 to D127, docs/published-boards.md#notifications): who may ask
 * for them, what a board keeps of a subscription, when one goes out and what it says. The Worker encrypts and
 * sends them (worker/src/webpush.ts), the app subscribes (src/app/push.ts), the service worker shows them.
 *
 * A voter asks to be told when the vote closes; the author when the crowd passes a milestone and when the
 * moderator decided on a picture. A board keeps a subscription until it is used (a voter's), turned off, refused
 * by the push service, or the board is gone.
 */

export type PushRole = 'voter' | 'owner';

/** What a board keeps of a browser's subscription: where to send, the keys to encrypt with, in which language. */
export interface PushTarget {
  endpoint: string;
  /** The browser's public key (P-256, 65 bytes) and its secret (16 bytes), base64url. */
  p256dh: string;
  auth: string;
}

export interface PushSubscribeInput extends PushTarget {
  role: PushRole;
  lang: BoardLang;
}

/** Subscriptions a board keeps at most, voters and author together. */
export const PUSH_MAX = 1000;
/** Messages sent per run: a run makes one request per message, and the free plan allows 50. */
export const PUSH_BATCH = 40;

const ENDPOINT_MAX = 1024;
/** The push services of the browsers: Chrome and most others (FCM), Firefox, Safari, Edge on Windows. */
const PUSH_HOST_RE =
  /^(?:fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com)$/;
/** An uncompressed P-256 point (0x04, x, y) in base64url: the browser's key, and the server's public VAPID key. */
export const PUBLIC_KEY_RE = /^B[A-Za-z0-9_-]{86}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{22}$/;
/** The server's private VAPID key: a P-256 scalar (32 bytes) in base64url. */
export const PRIVATE_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A push service's address. Only the browsers' services: the server posts to it, so it must not be any address.
 * `local` lets `http://localhost` and `http://127.0.0.1` through (the Worker's tests).
 */
export function parseEndpoint(x: unknown, local = false): string | null {
  if (typeof x !== 'string' || x.length > ENDPOINT_MAX) return null;
  let url: URL;
  try {
    url = new URL(x);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:' && !url.port && PUSH_HOST_RE.test(url.hostname)) return url.href;
  if (local && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return url.href;
  }
  return null;
}

/** Base64url as browsers give it, with or without padding; null when it isn't. */
const key = (x: unknown, re: RegExp): string | null => {
  if (typeof x !== 'string') return null;
  const s = x.replace(/=+$/, '');
  return re.test(s) ? s : null;
};

/**
 * What the app sends to subscribe: the browser's `PushSubscription.toJSON()`, the role asked for and the
 * language to write in.
 */
export function parsePushSubscription(x: unknown, local = false): Result<PushSubscribeInput> {
  const bad = { ok: false, error: 'bad_request' } as const;
  if (!isRecord(x) || !isRecord(x.subscription)) return bad;
  const s = x.subscription;
  const keys = isRecord(s.keys) ? s.keys : {};
  const endpoint = parseEndpoint(s.endpoint, local);
  const p256dh = key(keys.p256dh, PUBLIC_KEY_RE);
  const auth = key(keys.auth, AUTH_RE);
  if (!endpoint || !p256dh || !auth) return bad;
  if (x.role !== 'voter' && x.role !== 'owner') return bad;
  return { ok: true, value: { endpoint, p256dh, auth, role: x.role, lang: x.lang === 'fr' ? 'fr' : 'en' } };
}

/** What the app sends to turn notifications off: the subscription's endpoint, and a role (both when absent). */
export function parseUnsubscribe(x: unknown): Result<{ endpoint: string; role: PushRole | null }> {
  if (!isRecord(x) || typeof x.endpoint !== 'string' || !x.endpoint || x.endpoint.length > ENDPOINT_MAX) {
    return { ok: false, error: 'bad_request' };
  }
  const role = x.role === 'voter' || x.role === 'owner' ? x.role : null;
  return { ok: true, value: { endpoint: x.endpoint, role } };
}

// ─── When ───────────────────────────────────────────────────────────────────

/** Voters a board passes for its author to be told. */
export const VOTER_MILESTONES: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000];

/** The highest milestone `voters` has reached, or 0. */
export function milestoneOf(voters: number): number {
  let m = 0;
  for (const x of VOTER_MILESTONES) if (x <= voters) m = x;
  return m;
}

/** The milestone just passed, when it is above the last one the author was told about; null otherwise. */
export function newMilestone(voters: number, last: number): number | null {
  const m = milestoneOf(voters);
  return m > last ? m : null;
}

// ─── What ───────────────────────────────────────────────────────────────────

export type PushEvent =
  | { kind: 'closed' }
  | { kind: 'voters'; voters: number }
  | { kind: 'picture'; label: string; ok: boolean };

/** Who each event is for. */
export const PUSH_AUDIENCE: Record<PushEvent['kind'], PushRole> = {
  closed: 'voter',
  voters: 'owner',
  picture: 'owner',
};

/** How long the push service keeps a message for a device that is off, in seconds. */
export const PUSH_TTL: Record<PushEvent['kind'], number> = { closed: 7 * 86_400, voters: 86_400, picture: 2 * 86_400 };

/**
 * What the service worker shows: a title, a line, the app's path to open (relative to the site's root), and a tag
 * (a newer notification with the same tag replaces the older one). The tag is also the message's Topic header: a
 * push service replaces a message still waiting with a newer one of the same topic.
 */
export interface PushMessage {
  title: string;
  body: string;
  path: string;
  tag: string;
}

/** The notification of an event, in the subscriber's language. */
export function pushMessage(e: PushEvent, board: { alias: string; title: string }, lang: UnfurlLang): PushMessage {
  const path = `app/${routePath({ view: 'board', alias: board.alias })}`;
  const tag = `${e.kind}-${board.alias}`;
  const title = board.title;
  if (e.kind === 'closed') return { title, body: unfurlText(lang, 'pushClosed'), path, tag };
  if (e.kind === 'voters') {
    return {
      title,
      body: unfurlText(lang, 'pushVoters', { voters: unfurlPlural(lang, e.voters, 'voter') }),
      path,
      tag,
    };
  }
  return {
    title,
    body: unfurlText(lang, e.ok ? 'pushPictureOk' : 'pushPictureRefused', { label: e.label }),
    path,
    tag,
  };
}

// ─── This browser ───────────────────────────────────────────────────────────

/**
 * What a browser remembers (`versus-push`): the endpoint its boards know, and the roles it asked for, by board
 * alias. The bells show from it; the boards hold the truth.
 */
export interface PushPrefs {
  endpoint: string;
  boards: Record<string, PushRole[]>;
}

export function parsePushPrefs(x: unknown): PushPrefs {
  const boards: Record<string, PushRole[]> = {};
  if (!isRecord(x)) return { endpoint: '', boards };
  for (const [alias, roles] of Object.entries(isRecord(x.boards) ? x.boards : {})) {
    if (!ALIAS_RE.test(alias) || !Array.isArray(roles)) continue;
    const ok = [...new Set(roles.filter((r): r is PushRole => r === 'voter' || r === 'owner'))];
    if (ok.length) boards[alias] = ok;
  }
  return { endpoint: typeof x.endpoint === 'string' ? x.endpoint : '', boards };
}

/** The same, with a role of a board turned on or off (`role` null: every role of that board off). */
export function withPush(p: PushPrefs, alias: string, role: PushRole | null, on: boolean): PushPrefs {
  const boards = { ...p.boards };
  const roles = (boards[alias] ?? []).filter((r) => role !== null && r !== role);
  if (on && role) roles.push(role);
  if (roles.length) boards[alias] = roles;
  else delete boards[alias];
  return { ...p, boards };
}

export const pushOn = (p: PushPrefs, alias: string, role: PushRole): boolean => !!p.boards[alias]?.includes(role);

// ─── Encoding ───────────────────────────────────────────────────────────────

export function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
