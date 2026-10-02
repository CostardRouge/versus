import {
  ALIAS_RE,
  DEFAULT_SETTINGS,
  isOutcome,
  isRecord,
  parseFill,
  patchSettings,
  picturePath,
  TOKEN_RE,
  VOTER_RE,
} from './board';
import { DEMOS } from './demos';
import { parseJoined } from './joined';
import { LABEL_MAX } from './list';
import { METHOD_KEYS } from './scoring';
import type { BoardStatus, Duel, Item, Joined, MethodKey, Ranking } from './types';
import { hueOf } from './util';

/**
 * Export and import (docs/pwa.md): the rankings of this browser in a JSON file. A backup holds everything, to
 * move to another browser or into the installed app on iOS, which has its own storage. A shared file holds one
 * ranking, a copy for someone else. Files come from outside: everything is validated, and what can't be
 * trusted (an image that isn't an image data URL, a malformed color) is dropped before it reaches the page.
 */

export const FORMAT = 'versus';
export const VERSION = 1;

export interface Backup {
  format: typeof FORMAT;
  version: typeof VERSION;
  /** When the file was made (ms). */
  exported: number;
  rankings: Ranking[];
  /** Owner tokens of published boards, by alias. Backup only: whoever has one controls the board. */
  owners: Record<string, string>;
  /** "Your votes" cards. Backup only. */
  joined: Joined[];
  /** This browser's anonymous voter id. Backup only. */
  voter: string | null;
}

/** What this browser keeps, as read from storage. */
export interface Local {
  ranks: Ranking[];
  owners: Record<string, string>;
  joined: Joined[];
  voter: string;
}

/** Everything of this browser except the demos, which are the same for everyone. */
export function makeBackup(local: Local, now: number): Backup {
  return {
    format: FORMAT,
    version: VERSION,
    exported: now,
    rankings: local.ranks.filter((r) => !r.demo),
    owners: { ...local.owners },
    joined: local.joined,
    voter: local.voter,
  };
}

/** One ranking to give away: its items and duels, without its link to a published board. */
export function makeShare(r: Ranking, now: number): Backup {
  const { id, title, method, items, history, created, updated } = r;
  return {
    format: FORMAT,
    version: VERSION,
    exported: now,
    rankings: [{ id, title, method, items, history, pair: null, created, updated }],
    owners: {},
    joined: [],
    voter: null,
  };
}

/** Whether this browser holds anything worth a backup. */
export const hasBackup = (local: Local): boolean =>
  local.ranks.some((r) => !r.demo) || local.joined.length > 0 || Object.keys(local.owners).length > 0;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `versus-2026-09-30.json`, in local time. */
export function backupName(now: number): string {
  const d = new Date(now);
  return `versus-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** `versus-next-destination.json`: the title without accents or punctuation. */
export function shareName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return `versus-${slug || 'ranking'}.json`;
}

// ─── Reading a file ─────────────────────────────────────────────────────────

export type ImportError = 'not-versus' | 'newer' | 'empty';
export type Parsed = { ok: true; value: Backup } | { ok: false; error: ImportError };

const ID_RE = /^[\w-]{1,40}$/;
/** Images are stored as data URLs (items.ts downscales them to JPEG); nothing else may reach an src or url(). */
const IMG_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const TITLE_MAX = 80;

const clip = (s: string, max: number): string => Array.from(s.trim()).slice(0, max).join('').trim();
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * An item from a file. A doubtful image or color is dropped and the item kept for its label; for the items of a
 * published board (`board`, its alias: a "Your votes" card) it refuses the item instead, since they came from the
 * server: no image, or the address of the board's own approved picture.
 */
function parseItem(x: unknown, board: string | null): Item | null {
  if (!isRecord(x) || typeof x.id !== 'string' || !ID_RE.test(x.id)) return null;
  const parsed = parseFill(x.fill);
  const path = board === null ? null : picturePath(board, x.id);
  const picture = path !== null && x.img === path ? path : null;
  if (board !== null && (parsed === undefined || (x.img !== null && x.img !== undefined && !picture))) return null;
  const label = typeof x.label === 'string' ? clip(x.label, LABEL_MAX) : '';
  const img = board === null ? (typeof x.img === 'string' && IMG_RE.test(x.img) ? x.img : null) : picture;
  const fill = parsed ?? null;
  if (!label && !img && !fill) return null;
  const h = isNum(x.h) ? ((Math.round(x.h) % 360) + 360) % 360 : hueOf(label);
  return { id: x.id, label, img, fill, h };
}

/** Items with unique ids; null if it isn't a list, or if any of a published board's is refused (`board`). */
function parseItems(x: unknown, board: string | null): Item[] | null {
  if (!Array.isArray(x)) return null;
  const items: Item[] = [];
  for (const raw of x) {
    const it = parseItem(raw, board);
    if (!it && board !== null) return null;
    if (it && !items.some((i) => i.id === it.id)) items.push(it);
  }
  return items;
}

const isStatus = (x: unknown): x is BoardStatus => x === 'open' || x === 'closed';

/** A ranking from a file. Duels and the current pair on unknown items are dropped, like the app does. */
function parseRanking(x: unknown, now: number): Ranking | null {
  if (!isRecord(x) || typeof x.id !== 'string' || !ID_RE.test(x.id)) return null;
  const items = parseItems(x.items, null);
  if (!items) return null;
  const ids = new Set(items.map((i) => i.id));
  const known = (a: unknown): a is string => typeof a === 'string' && ids.has(a);
  const history: Duel[] = [];
  if (Array.isArray(x.history)) {
    for (const d of x.history) {
      if (isRecord(d) && known(d.a) && known(d.b) && d.a !== d.b && isOutcome(d.s)) {
        history.push({ a: d.a, b: d.b, s: d.s });
      }
    }
  }
  const p = x.pair;
  const pair: [string, string] | null =
    Array.isArray(p) && p.length === 2 && known(p[0]) && known(p[1]) && p[0] !== p[1] ? [p[0], p[1]] : null;
  const r: Ranking = {
    id: x.id,
    title: typeof x.title === 'string' ? clip(x.title, TITLE_MAX) : '',
    method: METHOD_KEYS.includes(x.method as MethodKey) ? (x.method as MethodKey) : 'bt',
    items,
    history,
    pair,
    created: isNum(x.created) ? x.created : now,
    updated: isNum(x.updated) ? x.updated : now,
  };
  const pub = x.pub;
  if (isRecord(pub) && typeof pub.alias === 'string' && ALIAS_RE.test(pub.alias)) {
    r.pub = isStatus(pub.status) ? { alias: pub.alias, status: pub.status } : { alias: pub.alias };
  }
  return r;
}

/** A "Your votes" card: its items come from the server, so any that isn't clean means the file was edited. */
function cleanJoined(j: Joined): Joined | null {
  const items = parseItems(j.items, j.alias);
  if (!items) return null;
  return { ...j, title: clip(j.title, TITLE_MAX), items, settings: patchSettings(DEFAULT_SETTINGS, j.settings) };
}

function parseOwners(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(x)) return out;
  for (const [alias, token] of Object.entries(x)) {
    if (ALIAS_RE.test(alias) && typeof token === 'string' && TOKEN_RE.test(token)) out[alias] = token;
  }
  return out;
}

/** Reads a file made by makeBackup or makeShare. A file from a newer version is refused rather than half read. */
export function parseBackup(text: string, now: number): Parsed {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-versus' };
  }
  if (!isRecord(x) || x.format !== FORMAT || !Number.isInteger(x.version) || (x.version as number) < 1) {
    return { ok: false, error: 'not-versus' };
  }
  if ((x.version as number) > VERSION) return { ok: false, error: 'newer' };
  const rankings: Ranking[] = [];
  for (const raw of Array.isArray(x.rankings) ? x.rankings : []) {
    const r = parseRanking(raw, now);
    if (r && !rankings.some((o) => o.id === r.id)) rankings.push(r);
  }
  const joined = parseJoined(x.joined)
    .map(cleanJoined)
    .filter((j): j is Joined => j !== null);
  if (!rankings.length && !joined.length) return { ok: false, error: 'empty' };
  const voter = typeof x.voter === 'string' && VOTER_RE.test(x.voter) ? x.voter : null;
  const exported = isNum(x.exported) ? x.exported : now;
  return {
    ok: true,
    value: { format: FORMAT, version: VERSION, exported, rankings, owners: parseOwners(x.owners), joined, voter },
  };
}

// ─── Merging into this browser ──────────────────────────────────────────────

export interface Merged {
  local: Local;
  /** Rankings added (new ones, and copies of ones that differ from the local version). */
  added: number;
  /** Rankings already here, identical. */
  same: number;
  /** "Your votes" cards added. */
  votes: number;
}

/** What makes two versions of a ranking the same: its content, not when it was last opened. */
const content = (r: Ranking): string =>
  JSON.stringify([r.title, r.method, r.items.map((i) => [i.id, i.label, i.img, i.fill]), r.history]);

/**
 * Adds a file's content to this browser without ever replacing anything. A ranking whose id is free keeps it
 * (its address stays the same from one device to the other); one that differs from the local version, or
 * takes a demo's id, comes in as a copy. The file's voter id is taken only by a browser that has neither
 * voted nor published, so votes already cast here keep their voter.
 */
export function mergeBackup(
  local: Local,
  file: Backup,
  opts: { newId: () => string; copyTitle: (title: string) => string },
): Merged {
  const ranks = [...local.ranks];
  let added = 0;
  let same = 0;
  for (const r of file.rankings) {
    const mine = ranks.find((x) => x.id === r.id);
    if (mine && content(mine) === content(r)) {
      same++;
      continue;
    }
    const taken = mine || DEMOS.some((d) => d.id === r.id);
    const next: Ranking = taken ? { ...r, id: opts.newId(), title: opts.copyTitle(r.title) } : { ...r };
    // One local ranking per published board.
    if (next.pub && ranks.some((x) => x.pub?.alias === next.pub?.alias)) delete next.pub;
    ranks.push(next);
    added++;
  }
  const joined = [...local.joined];
  let votes = 0;
  for (const j of file.joined) {
    if (joined.some((o) => o.alias === j.alias)) continue;
    joined.push(j);
    votes++;
  }
  const fresh = !local.joined.length && !local.ranks.some((r) => r.pub);
  return {
    local: {
      ranks,
      owners: { ...file.owners, ...local.owners },
      joined,
      voter: fresh && file.voter ? file.voter : local.voter,
    },
    added,
    same,
    votes,
  };
}
