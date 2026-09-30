import { fillCode, sameFill } from './colors';
import { mkRank } from './model';
import { compute, pairKey } from './scoring';
import type {
  BoardMeta,
  BoardSettings,
  BoardStatus,
  Computed,
  Duel,
  ErrorCode,
  Fill,
  Item,
  MethodKey,
  Outcome,
  Ranking,
  Result,
  Rng,
  Session,
  SharedBoard,
  Visibility,
  Vote,
} from './types';
import { hueOf } from './util';

/**
 * Published boards: one voice per voter and pair, server-assigned pairs, results visibility.
 * Pure logic shared by the browser and the Cloudflare Worker (see docs/published-boards.md).
 */

/** Methods a crowd can use: binary insertion needs one sequence of comparisons, not concurrent voters. */
export const CROWD_METHODS: readonly MethodKey[] = ['bt', 'elo', 'win'];
const VISIBILITIES: readonly Visibility[] = ['always', 'after', 'blind'];

export const LIMITS = { title: 120, label: 200, items: 100, duels: 5000, revealAfter: 1000, queue: 3, skipped: 12 };
/** Undoing the very last vote stays possible this long when votes are final (mis-taps). */
export const UNDO_GRACE_MS = 10_000;
/** Minimum delay between two votes or skips of one connection (each one triggers pair assignment). */
export const ACTION_INTERVAL_MS = 150;
/** Minimum delay between two items added by one connection. */
export const ADD_INTERVAL_MS = 5_000;
/** Inactive published boards are deleted after this many days without activity. */
export const TTL_DAYS = 60;

export const DEFAULT_SETTINGS: BoardSettings = {
  method: 'bt',
  visibility: 'always',
  revealAfter: 10,
  allowChange: true,
  visitorsAddItems: false,
};

export const VOTER_RE = /^[\w-]{8,64}$/;
const ITEM_ID_RE = /^[\w-]{1,32}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const ALIAS_LENGTH = 10;
export const ALIAS_RE = /^[1-9A-HJ-NP-Za-km-z]{10}$/;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: ErrorCode): Result<T> => ({ ok: false, error });

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
export const isOutcome = (x: unknown): x is Outcome => x === 0 || x === 0.5 || x === 1;

/** Short shareable alias in base58 (no 0, O, I, l), drawn without modulo bias. */
export function makeAlias(randomBytes: (n: number) => Uint8Array): string {
  let out = '';
  while (out.length < ALIAS_LENGTH) {
    for (const b of randomBytes(16)) {
      // 232 = 4 × 58: rejecting higher bytes keeps every character equally likely.
      if (b < 232 && out.length < ALIAS_LENGTH) out += BASE58[b % 58];
    }
  }
  return out;
}

// ─── Validation of untrusted input ──────────────────────────────────────────

function parseFill(x: unknown): Fill | null | undefined {
  if (x === null || x === undefined) return null;
  if (!isRecord(x) || (x.type !== 'solid' && x.type !== 'gradient') || !Array.isArray(x.colors)) return undefined;
  const [min, max] = x.type === 'solid' ? [1, 1] : [2, 3];
  const colors: unknown[] = x.colors;
  if (colors.length < min || colors.length > max) return undefined;
  if (!colors.every((c): c is string => typeof c === 'string' && HEX_RE.test(c))) return undefined;
  return { type: x.type, colors: [...colors] };
}

export interface NewItem {
  label: string;
  fill: Fill | null;
}

/** An item's content: a label, and a fill for colors. No images on published boards (v1). */
export function parseNewItem(x: unknown): Result<NewItem> {
  if (!isRecord(x) || typeof x.label !== 'string') return fail('bad_request');
  if (x.img !== null && x.img !== undefined) return fail('images_not_allowed');
  const fill = parseFill(x.fill);
  if (fill === undefined) return fail('bad_request');
  const label = x.label.trim();
  if (label.length > LIMITS.label || (!label && !fill)) return fail('bad_request');
  return ok({ label, fill });
}

function parseItem(x: unknown): Result<Item> {
  if (!isRecord(x) || typeof x.id !== 'string' || !ITEM_ID_RE.test(x.id)) return fail('bad_request');
  const content = parseNewItem(x);
  if (!content.ok) return content;
  const { label, fill } = content.value;
  const h = typeof x.h === 'number' && Number.isInteger(x.h) && x.h >= 0 && x.h < 360 ? x.h : hueOf(label);
  return ok({ id: x.id, label, img: null, fill, h });
}

/** Applies the valid fields of `patch`; anything else keeps its current value. */
export function patchSettings(current: BoardSettings, patch: unknown): BoardSettings {
  const next = { ...current };
  if (!isRecord(patch)) return next;
  const { method, visibility, revealAfter, allowChange, visitorsAddItems } = patch;
  if (CROWD_METHODS.includes(method as MethodKey)) next.method = method as MethodKey;
  if (VISIBILITIES.includes(visibility as Visibility)) next.visibility = visibility as Visibility;
  if (Number.isInteger(revealAfter) && (revealAfter as number) >= 1 && (revealAfter as number) <= LIMITS.revealAfter) {
    next.revealAfter = revealAfter as number;
  }
  if (typeof allowChange === 'boolean') next.allowChange = allowChange;
  if (typeof visitorsAddItems === 'boolean') next.visitorsAddItems = visitorsAddItems;
  return next;
}

export interface PublishInput {
  title: string;
  items: Item[];
  settings: BoardSettings;
  /** The author's voter id. */
  voter: string;
  /** The author's local duels, pushed as their votes (empty to start without votes). */
  duels: Duel[];
}

/** Validates a publish request. Duels on unknown items are dropped, like the local history does. */
export function parsePublish(x: unknown): Result<PublishInput> {
  if (!isRecord(x) || typeof x.title !== 'string' || !Array.isArray(x.items)) return fail('bad_request');
  const title = x.title.trim();
  if (!title || title.length > LIMITS.title) return fail('bad_request');
  if (typeof x.voter !== 'string' || !VOTER_RE.test(x.voter)) return fail('bad_request');
  if (x.items.length < 2 || x.items.length > LIMITS.items) return fail('bad_request');
  const items: Item[] = [];
  const ids = new Set<string>();
  for (const raw of x.items) {
    const r = parseItem(raw);
    if (!r.ok) return r;
    if (ids.has(r.value.id)) return fail('bad_request');
    ids.add(r.value.id);
    items.push(r.value);
  }
  const rawDuels = x.duels ?? [];
  if (!Array.isArray(rawDuels) || rawDuels.length > LIMITS.duels) return fail('bad_request');
  const duels: Duel[] = [];
  for (const d of rawDuels) {
    if (!isRecord(d) || typeof d.a !== 'string' || typeof d.b !== 'string' || !isOutcome(d.s))
      return fail('bad_request');
    if (d.a !== d.b && ids.has(d.a) && ids.has(d.b)) duels.push({ a: d.a, b: d.b, s: d.s });
  }
  // The method comes from the local ranking; exact sort falls back to Balanced.
  const settings = patchSettings(DEFAULT_SETTINGS, x.settings);
  return ok({ title, items, settings, voter: x.voter, duels });
}

// ─── Board state ────────────────────────────────────────────────────────────

const voteKey = (voter: string, pk: string): string => `${voter} ${pk}`;

function removeVote(board: SharedBoard, voter: string, pk: string): Vote | null {
  const mine = board.voters.get(voter);
  const prev = mine?.get(pk);
  if (!mine || !prev) return null;
  mine.delete(pk);
  if (mine.size === 0) board.voters.delete(voter);
  board.votes.delete(voteKey(voter, pk));
  return prev;
}

/** Records a vote at the end of the arrival order, replacing the voter's previous vote on that pair. */
function putVote(board: SharedBoard, v: Vote): Vote | null {
  const pk = pairKey(v.a, v.b);
  const prev = removeVote(board, v.voter, pk);
  board.votes.set(voteKey(v.voter, pk), v);
  let mine = board.voters.get(v.voter);
  if (!mine) {
    mine = new Map();
    board.voters.set(v.voter, mine);
  }
  mine.set(pk, v);
  return prev;
}

/** Rebuilds a board from stored parts; `votes` must be in arrival order. */
export function restoreBoard(meta: BoardMeta, items: Item[], votes: Iterable<Vote>): SharedBoard {
  const board: SharedBoard = { ...meta, items, votes: new Map(), voters: new Map() };
  for (const v of votes) putVote(board, v);
  return board;
}

/** A new board; the author's duels become their votes, repeated pairs collapsing to the last duel. */
export function createBoard(input: PublishInput, now: number): SharedBoard {
  const meta: BoardMeta = { title: input.title, settings: input.settings, status: 'open', created: now, touched: now };
  return restoreBoard(
    meta,
    input.items,
    input.duels.map((d) => ({ ...d, voter: input.voter, t: now })),
  );
}

export const boardMeta = ({ title, settings, status, created, touched }: SharedBoard): BoardMeta => ({
  title,
  settings,
  status,
  created,
  touched,
});

export const voteCount = (board: SharedBoard, voter: string): number => board.voters.get(voter)?.size ?? 0;

export const votesOf = (board: SharedBoard, voter: string): Vote[] => [...(board.voters.get(voter)?.values() ?? [])];

export function lastVote(board: SharedBoard, voter: string): Vote | null {
  let last: Vote | null = null;
  for (const v of board.voters.get(voter)?.values() ?? []) last = v;
  return last;
}

/** Most recent activity, vote or not: the inactivity TTL counts from here. */
export function lastActivity(board: SharedBoard): number {
  let t = board.touched;
  for (const v of board.votes.values()) t = Math.max(t, v.t);
  return t;
}

export function setStatus(board: SharedBoard, status: BoardStatus, now: number): void {
  board.status = status;
  board.touched = now;
}

export function updateSettings(board: SharedBoard, patch: unknown, now: number): void {
  board.settings = patchSettings(board.settings, patch);
  board.touched = now;
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Id for an item added after publication, drawn by the server. */
export const itemId = (bytes: Uint8Array): string => Array.from(bytes, (b) => ID_CHARS[b & 63]).join('');

/** Adds an item to an open board. Refused when full or when the same label is already there. */
export function addItem(board: SharedBoard, input: NewItem, id: string, now: number): Result<Item> {
  if (board.status !== 'open') return fail('closed');
  if (board.items.length >= LIMITS.items) return fail('full');
  const key = input.label.toLowerCase();
  if (board.items.some((i) => i.label.toLowerCase() === key)) return fail('exists');
  const item: Item = { id, label: input.label, img: null, fill: input.fill, h: hueOf(input.label) };
  board.items.push(item);
  board.touched = now;
  return ok(item);
}

/** Removes an item and every vote that involves it (they would count for nothing). A board keeps 2 items. */
export function removeItem(board: SharedBoard, id: string, now: number): Result<Vote[]> {
  if (!board.items.some((i) => i.id === id)) return fail('not_found');
  if (board.items.length <= 2) return fail('too_few');
  board.items = board.items.filter((i) => i.id !== id);
  const removed = [...board.votes.values()].filter((v) => v.a === id || v.b === id);
  for (const v of removed) removeVote(board, v.voter, pairKey(v.a, v.b));
  board.touched = now;
  return ok(removed);
}

/**
 * Gives a color item a new fill on an open board. Its votes were cast on the old color, so they are
 * dropped: the item starts again from zero (and, with no votes, gets priority in pair assignment).
 * A label that was the color code follows the new code.
 */
export function recolorItem(
  board: SharedBoard,
  id: string,
  raw: unknown,
  now: number,
): Result<{ item: Item; removed: Vote[] }> {
  const it = board.items.find((i) => i.id === id);
  if (!it) return fail('not_found');
  if (board.status !== 'open') return fail('closed');
  const fill = parseFill(raw);
  if (!it.fill || !fill) return fail('bad_request');
  if (sameFill(fill, it.fill)) return ok({ item: it, removed: [] });
  const label = it.label.toUpperCase() === fillCode(it.fill) ? fillCode(fill) : it.label;
  const key = label.toLowerCase();
  if (board.items.some((i) => i.id !== id && i.label.toLowerCase() === key)) return fail('exists');
  const item: Item = { ...it, label, fill, h: label === it.label ? it.h : hueOf(label) };
  board.items = board.items.map((i) => (i.id === id ? item : i));
  const removed = [...board.votes.values()].filter((v) => v.a === id || v.b === id);
  for (const v of removed) removeVote(board, v.voter, pairKey(v.a, v.b));
  board.touched = now;
  return ok({ item, removed });
}

// ─── Votes ──────────────────────────────────────────────────────────────────

export function castVote(
  board: SharedBoard,
  voter: string,
  a: string,
  b: string,
  s: Outcome,
  now: number,
): Result<{ vote: Vote; replaced: Vote | null }> {
  if (board.status !== 'open') return fail('closed');
  if (a === b || !board.items.some((i) => i.id === a) || !board.items.some((i) => i.id === b)) {
    return fail('unknown_item');
  }
  if (!board.settings.allowChange && board.voters.get(voter)?.has(pairKey(a, b))) return fail('final');
  const vote: Vote = { voter, a, b, s, t: now };
  return ok({ vote, replaced: putVote(board, vote) });
}

/** Deletes one of the voter's votes. When votes are final, only the last one, within the grace delay. */
export function retractVote(board: SharedBoard, voter: string, a: string, b: string, now: number): Result<Vote> {
  if (board.status !== 'open') return fail('closed');
  const pk = pairKey(a, b);
  const v = board.voters.get(voter)?.get(pk);
  if (!v) return fail('not_found');
  if (!board.settings.allowChange && (lastVote(board, voter) !== v || now - v.t > UNDO_GRACE_MS)) return fail('final');
  removeVote(board, voter, pk);
  return ok(v);
}

export function retractAll(board: SharedBoard, voter: string): Result<Vote[]> {
  if (board.status !== 'open') return fail('closed');
  if (!board.settings.allowChange) return fail('final');
  const removed = votesOf(board, voter);
  for (const v of removed) removeVote(board, voter, pairKey(v.a, v.b));
  return ok(removed);
}

// ─── Crowd ranking and visibility ───────────────────────────────────────────

/** The board as a ranking whose history is every vote in arrival order (Dynamic depends on it). */
export function toRanking(board: SharedBoard): Ranking {
  const r = mkRank(board.title, board.settings.method);
  r.items = board.items;
  r.history = [...board.votes.values()].map(({ a, b, s }) => ({ a, b, s }));
  r.created = board.created;
  return r;
}

export const crowd = (board: SharedBoard): Computed => compute(toRanking(board));

export const totalPairs = (n: number): number => (n * (n - 1)) / 2;

/**
 * Votes a voter needs to see the crowd in "after N votes" mode: N, or every pair when the board has
 * fewer, so that voting on everything always reveals it.
 */
export const revealAt = (revealAfter: number, items: number): number =>
  Math.max(1, Math.min(revealAfter, totalPairs(items)));

/** Whether this viewer may see the crowd ranking. Enforced by the server, never by hiding UI. */
export function canSeeRanking(board: SharedBoard, voter: string | null, owner: boolean): boolean {
  if (owner || board.status === 'closed') return true;
  const { visibility, revealAfter } = board.settings;
  if (visibility === 'always') return true;
  if (visibility === 'after') {
    return voter !== null && voteCount(board, voter) >= revealAt(revealAfter, board.items.length);
  }
  return false;
}

/** What the author keeps when withdrawing: items and every vote as an anonymous duel. */
export function localCopy(board: SharedBoard, now: number): Ranking {
  const r = toRanking(board);
  r.created = now;
  r.updated = now;
  return r;
}

// ─── Pair assignment ────────────────────────────────────────────────────────

/**
 * Picks up to `count` pairs for a voter: never a pair they voted on or one in `exclude`; items with
 * few votes (relative to the average) and close crowd positions first; items just seen are avoided.
 */
export function assignPairs(
  board: SharedBoard,
  voter: string,
  C: Computed,
  exclude: ReadonlySet<string>,
  recentIds: readonly string[],
  count: number,
  rng: Rng,
): [string, string][] {
  const items = board.items;
  const mine = board.voters.get(voter);
  const recent = new Map<string, number>();
  const bump = (id: string) => recent.set(id, (recent.get(id) ?? 0) + 1);
  const last = lastVote(board, voter);
  if (last) {
    bump(last.a);
    bump(last.b);
  }
  for (const id of recentIds) bump(id);
  const stat = (id: string) => C.st[id] ?? { games: 0, pos: 0 };
  let total = 0;
  for (const it of items) total += stat(it.id).games;
  const avg = Math.max(1, total / Math.max(1, items.length));
  const taken = new Set(exclude);
  const picked: [string, string][] = [];
  while (picked.length < count) {
    let best: [string, string] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = (items[i] as Item).id;
        const b = (items[j] as Item).id;
        const k = pairKey(a, b);
        if (taken.has(k) || mine?.has(k)) continue;
        const sa = stat(a);
        const sb = stat(b);
        const s =
          ((sa.games + sb.games) / (2 * avg)) * 3 +
          Math.abs(sa.pos - sb.pos) * 0.8 +
          ((recent.get(a) ?? 0) + (recent.get(b) ?? 0)) * 1.5 +
          rng() * 1.4;
        if (s < bestScore) {
          bestScore = s;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    taken.add(pairKey(best[0], best[1]));
    bump(best[0]);
    bump(best[1]);
    picked.push(rng() < 0.5 ? [best[1], best[0]] : best);
  }
  return picked;
}

/** Tops up the session's queue. Skipped pairs come back only once nothing else is left. */
export function refill(board: SharedBoard, session: Session, C: Computed, rng: Rng): void {
  if (board.status !== 'open') {
    session.queue = [];
    return;
  }
  const ids = new Set(board.items.map((i) => i.id));
  const mine = board.voters.get(session.voter);
  // Drop pairs that became invalid meanwhile (voted from another tab, item removed).
  session.queue = session.queue.filter(([a, b]) => ids.has(a) && ids.has(b) && !mine?.has(pairKey(a, b)));
  const fill = (skipped: readonly string[]) => {
    const need = LIMITS.queue - session.queue.length;
    if (need <= 0) return;
    const exclude = new Set([...session.queue.map(([a, b]) => pairKey(a, b)), ...skipped]);
    session.queue.push(...assignPairs(board, session.voter, C, exclude, session.queue.flat(), need, rng));
  };
  fill(session.skipped);
  if (session.queue.length < LIMITS.queue && session.skipped.length) {
    session.skipped = [];
    fill([]);
  }
}

/** A new session; `lastActionAt` carries over when a connection says hello again, so it can't dodge the limit. */
export function openSession(
  board: SharedBoard,
  voter: string,
  owner: boolean,
  C: Computed,
  rng: Rng,
  lastActionAt = 0,
): Session {
  const session: Session = { voter, owner, queue: [], skipped: [], lastActionAt };
  refill(board, session, C, rng);
  return session;
}

const queueIndex = (session: Session, a: string, b: string): number => {
  const k = pairKey(a, b);
  return session.queue.findIndex(([x, y]) => pairKey(x, y) === k);
};

/** A vote from a connection: rate limited, and only on a pair the server assigned to it. */
export function sessionVote(
  board: SharedBoard,
  session: Session,
  a: string,
  b: string,
  s: Outcome,
  now: number,
  C: Computed,
  rng: Rng,
): Result<{ vote: Vote; replaced: Vote | null }> {
  if (board.status !== 'open') return fail('closed');
  if (now - session.lastActionAt < ACTION_INTERVAL_MS) return fail('too_fast');
  const i = queueIndex(session, a, b);
  if (i < 0) return fail('not_assigned');
  const r = castVote(board, session.voter, a, b, s, now);
  if (!r.ok) return r;
  session.queue.splice(i, 1);
  session.lastActionAt = now;
  refill(board, session, C, rng);
  return r;
}

export function sessionSkip(
  board: SharedBoard,
  session: Session,
  a: string,
  b: string,
  now: number,
  C: Computed,
  rng: Rng,
): Result<null> {
  if (now - session.lastActionAt < ACTION_INTERVAL_MS) return fail('too_fast');
  const i = queueIndex(session, a, b);
  if (i < 0) return fail('not_assigned');
  const k = pairKey(a, b);
  session.queue.splice(i, 1);
  session.lastActionAt = now;
  session.skipped = [...session.skipped.filter((x) => x !== k), k].slice(-LIMITS.skipped);
  refill(board, session, C, rng);
  return ok(null);
}

/** Deletes one of the voter's votes and puts its pair back first in the queue, to vote again. */
export function sessionUndo(board: SharedBoard, session: Session, a: string, b: string, now: number): Result<Vote> {
  const r = retractVote(board, session.voter, a, b, now);
  if (!r.ok) return r;
  const k = pairKey(a, b);
  const rest = session.queue.filter(([x, y]) => pairKey(x, y) !== k);
  session.queue = [[r.value.a, r.value.b] as [string, string], ...rest].slice(0, LIMITS.queue);
  return r;
}

/** An item suggested by a connection: only when the author allows it (or is the one adding), a few seconds apart. */
export function sessionAdd(
  board: SharedBoard,
  session: Session,
  input: NewItem,
  id: string,
  now: number,
): Result<Item> {
  if (!session.owner && !board.settings.visitorsAddItems) return fail('forbidden');
  if (now - (session.lastAddAt ?? 0) < ADD_INTERVAL_MS) return fail('too_fast');
  const r = addItem(board, input, id, now);
  if (r.ok) session.lastAddAt = now;
  return r;
}

/** Deletes all of the voter's votes to start over. */
export function sessionReset(board: SharedBoard, session: Session, C: Computed, rng: Rng): Result<Vote[]> {
  const r = retractAll(board, session.voter);
  if (!r.ok) return r;
  session.queue = [];
  session.skipped = [];
  refill(board, session, C, rng);
  return r;
}
