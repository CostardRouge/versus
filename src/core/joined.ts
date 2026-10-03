import { ALIAS_RE, isOutcome, isRecord, totalPairs } from './board.ts';
import { mkRank } from './model.ts';
import type { BoardSummary, BoardView, Counts } from './protocol.ts';
import { agreement, ownRanking } from './published.ts';
import type { BoardStatus, Duel, Item, Joined, Ranking } from './types.ts';

/**
 * "Your votes": the published boards a browser voted on without managing them. Each card keeps a
 * snapshot of the board (see Joined), refreshed from the board page or from a summary, and compares it
 * with what the voter saw on their last visit to flag what's new. Never shows more than the board does.
 */

/** What the board page knows about a board, to write its card. */
export interface BoardSnapshot {
  alias: string;
  view: BoardView;
  counts: Counts;
  /** The crowd order this voter may see, or null when it's hidden from them. */
  order: string[] | null;
  mine: readonly Duel[];
  count: number;
}

/** The card of a board the voter is looking at: everything on screen counts as seen. */
export function seeBoard(prev: Joined | undefined, snap: BoardSnapshot, now: number, voted = false): Joined {
  const { view } = snap;
  return {
    alias: snap.alias,
    title: view.title,
    items: view.items,
    settings: view.settings,
    status: view.status,
    votes: snap.counts.votes,
    voters: snap.counts.voters,
    order: snap.order,
    mine: [...snap.mine],
    count: snap.count,
    joined: prev?.joined ?? now,
    voted: voted || !prev ? now : prev.voted,
    seen: { at: now, status: view.status, items: view.items.map((i) => i.id), visible: snap.order !== null },
  };
}

/** Refreshes a card from the server; what changed stays unseen until the voter opens the board. Null: gone. */
export function applySummary(j: Joined, s: BoardSummary | null): Joined {
  if (!s) return { ...j, gone: true };
  return {
    alias: j.alias,
    title: s.title,
    items: s.items,
    settings: s.settings,
    status: s.status,
    votes: s.counts.votes,
    voters: s.counts.voters,
    order: s.order,
    mine: j.mine,
    count: s.mine,
    joined: j.joined,
    voted: j.voted,
    seen: j.seen,
  };
}

export type JoinedNews = 'revealed' | 'closed' | 'items';

/** Items added since the voter's last visit, while they can still vote on them. */
export function addedItems(j: Joined): number {
  if (j.gone || j.status !== 'open') return 0;
  const seen = new Set(j.seen.items);
  return j.items.filter((i) => !seen.has(i.id)).length;
}

/** What changed since the voter's last visit and is worth coming back for, most telling first, or null. */
export function newsOf(j: Joined): JoinedNews | null {
  if (j.gone) return null;
  if (j.order && !j.seen.visible) return 'revealed';
  if (j.status === 'closed' && j.seen.status === 'open') return 'closed';
  return addedItems(j) ? 'items' : null;
}

/** News first, then the latest vote; boards that are gone last. */
export function sortJoined(list: readonly Joined[]): Joined[] {
  const rank = (j: Joined): number => (newsOf(j) ? 0 : j.gone ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.voted - a.voted);
}

/** Replaces the card with the same alias, or adds it. */
export const upsertJoined = (list: readonly Joined[], j: Joined): Joined[] =>
  list.some((x) => x.alias === j.alias) ? list.map((x) => (x.alias === j.alias ? j : x)) : [...list, j];

/** The voter's votes on items the board still has. */
function myValidDuels(j: Joined): Duel[] {
  const ids = new Set(j.items.map((i) => i.id));
  return j.mine.filter((d) => d.a !== d.b && ids.has(d.a) && ids.has(d.b)).map(({ a, b, s }) => ({ a, b, s }));
}

/**
 * The items a card shows, best first: the crowd's order when this voter may see it, else their own
 * ranking from their votes, among the items they compared (on a blind board the card never shows the
 * crowd), else in board order.
 */
export function joinedTop(j: Joined, n = 3): { items: Item[]; whose: 'crowd' | 'mine' | 'none' } {
  const byId = new Map(j.items.map((i) => [i.id, i]));
  if (j.order) {
    const items = j.order.map((id) => byId.get(id)).filter((i): i is Item => !!i);
    return { items: items.slice(0, n), whose: 'crowd' };
  }
  const mine = myValidDuels(j);
  if (mine.length) {
    const compared = new Set(mine.flatMap((d) => [d.a, d.b]));
    const own = ownRanking(
      j.items.filter((i) => compared.has(i.id)),
      mine,
      j.settings.method,
    );
    return { items: own.order.slice(0, n), whose: 'mine' };
  }
  return { items: j.items.slice(0, n), whose: 'none' };
}

/** Pairs this voter voted on, out of every pair on the board. */
export function pairsOf(j: Joined): { done: number; total: number } {
  const total = totalPairs(j.items.length);
  return { done: Math.min(j.count, total), total };
}

/** Share of the voter's decisive votes the crowd order agrees with, when it is visible and there are enough. */
export const joinedAgreement = (j: Joined): number | null =>
  j.order ? agreement(myValidDuels(j), { method: j.settings.method, order: j.order, stats: {} }) : null;

/** A local ranking from what the voter kept of a board: its items and their own votes. */
export function joinedCopy(j: Joined): Ranking {
  const r = mkRank(j.title, j.settings.method);
  r.items = j.items.map((i) => ({ ...i, fill: i.fill ? { ...i.fill, colors: [...i.fill.colors] } : null }));
  r.history = myValidDuels(j);
  return r;
}

// ─── Stored cards ───────────────────────────────────────────────────────────

const isStatus = (x: unknown): x is BoardStatus => x === 'open' || x === 'closed';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isItem = (x: unknown): x is Item => isRecord(x) && typeof x.id === 'string' && typeof x.label === 'string';
const isDuel = (x: unknown): x is Duel =>
  isRecord(x) && typeof x.a === 'string' && typeof x.b === 'string' && isOutcome(x.s);

function isJoined(x: unknown): x is Joined {
  if (!isRecord(x) || typeof x.alias !== 'string' || !ALIAS_RE.test(x.alias) || typeof x.title !== 'string') {
    return false;
  }
  const { items, settings, seen, mine, order } = x;
  return (
    Array.isArray(items) &&
    items.every(isItem) &&
    isRecord(settings) &&
    typeof settings.method === 'string' &&
    isStatus(x.status) &&
    [x.votes, x.voters, x.count, x.joined, x.voted].every(isNum) &&
    (order === null || isStrings(order)) &&
    Array.isArray(mine) &&
    mine.every(isDuel) &&
    isRecord(seen) &&
    isNum(seen.at) &&
    isStatus(seen.status) &&
    isStrings(seen.items) &&
    typeof seen.visible === 'boolean'
  );
}

/** Cards read back from storage: anything malformed or repeated is dropped rather than breaking the gallery. */
export function parseJoined(x: unknown): Joined[] {
  if (!Array.isArray(x)) return [];
  const out: Joined[] = [];
  for (const j of x) if (isJoined(j) && !out.some((o) => o.alias === j.alias)) out.push(j);
  return out;
}
