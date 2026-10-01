import { ALIAS_RE, canSeeRanking, isOutcome, isRecord, LIMITS, VOTER_RE, voteCount, votesOf } from './board';
import type {
  BoardLang,
  BoardSettings,
  BoardStatus,
  Computed,
  Duel,
  ErrorCode,
  Item,
  MethodKey,
  Moderation,
  Outcome,
  ReportReason,
  Result,
  SharedBoard,
} from './types';

/** Messages and views exchanged between the app and a published board (HTTP + WebSocket). */

export interface ItemScore {
  score: number;
  /** Standard error in rating points (Balanced only). */
  se: number | null;
  w: number;
  l: number;
  d: number;
}

export interface RankingView {
  method: MethodKey;
  /** Item ids, best first. */
  order: string[];
  stats: Record<string, ItemScore>;
}

export interface Counts {
  votes: number;
  voters: number;
  /** Open connections. */
  online: number;
}

export interface BoardView {
  title: string;
  items: Item[];
  settings: BoardSettings;
  status: BoardStatus;
  created: number;
  counts: Counts;
  /** Null when this viewer isn't entitled to see the crowd ranking yet. */
  ranking: RankingView | null;
}

export type ClientMessage =
  /**
   * First message on a connection; `owner` is the owner token, for the author; `pair` the duel a shared link
   * asked for, served first when the voter can still vote on it.
   */
  | { t: 'hello'; voter: string; owner?: string; pair?: [string, string] }
  | { t: 'vote'; a: string; b: string; s: Outcome }
  | { t: 'skip'; a: string; b: string }
  /** Deletes one of my votes; its pair comes back first in my queue. */
  | { t: 'undo'; a: string; b: string }
  /** Deletes all my votes. */
  | { t: 'reset' }
  /** Adds an item (visitors, when the author allows it). */
  | { t: 'add'; item: unknown };

export type ServerMessage =
  | { t: 'state'; board: BoardView; owner: boolean; mine: Duel[]; pairs: [string, string][] }
  | { t: 'pairs'; pairs: [string, string][]; mine: number }
  | { t: 'ranking'; counts: Counts; ranking: RankingView | null }
  | { t: 'error'; code: ErrorCode };

/** Largest client message accepted, in characters. */
export const MAX_MESSAGE = 4096;

const round = (x: number): number => Math.round(x * 1000) / 1000;

export function rankingView(C: Computed): RankingView {
  const stats: Record<string, ItemScore> = {};
  for (const [id, s] of Object.entries(C.st)) {
    stats[id] = { score: round(s.score), se: s.se === null ? null : round(s.se), w: s.w, l: s.l, d: s.d };
  }
  return { method: C.m, order: C.order.map((i) => i.id), stats };
}

export const countsOf = (board: SharedBoard, online: number): Counts => ({
  votes: board.votes.size,
  voters: board.voters.size,
  online,
});

export function boardView(board: SharedBoard, C: Computed, online: number, visible: boolean): BoardView {
  return {
    title: board.title,
    items: board.items,
    settings: board.settings,
    status: board.status,
    created: board.created,
    counts: countsOf(board, online),
    ranking: visible ? rankingView(C) : null,
  };
}

export const myDuels = (board: SharedBoard, voter: string): Duel[] =>
  votesOf(board, voter).map(({ a, b, s }) => ({ a, b, s }));

// ─── Admin ──────────────────────────────────────────────────────────────────

/** What the server lets the app do, besides voting: whether pictures may be published (sent for review). */
export interface ServerConfig {
  images: 'off' | 'review';
}

/** What the admin page can narrow the list of boards to. */
export const ADMIN_FILTERS = ['all', 'reported', 'pictures', 'featured', 'hidden', 'open', 'closed'] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];
export const isAdminFilter = (x: unknown): x is AdminFilter => ADMIN_FILTERS.includes(x as AdminFilter);

/** One board in the admin list: the registry's row (worker/src/registry.ts), refreshed at most once a day for votes. */
export interface AdminRow {
  alias: string;
  title: string;
  status: BoardStatus;
  lang: BoardLang;
  items: number;
  votes: number;
  voters: number;
  /** Visitors' reports awaiting the admin. */
  reports: number;
  /** Items whose picture awaits the admin's review. */
  pictures: number;
  hidden: boolean;
  featured: boolean;
  /** The key of the official template it was made from, or ''. */
  template: string;
  /** Votes in the last 7 days, as of the last write. */
  recent: number;
  /** The crowd's first three labels, as of the last write. */
  top: string[];
  created: number;
  /** Last activity, refreshed at most once a day. */
  active: number;
}

/** A board of the Popular section (docs/published-boards.md#official-templates): a public row of the registry. */
export type PopularBoard = Pick<
  AdminRow,
  'alias' | 'title' | 'status' | 'lang' | 'items' | 'votes' | 'voters' | 'featured' | 'template' | 'top' | 'active'
>;

export const popularOf = (row: AdminRow): PopularBoard => ({
  alias: row.alias,
  title: row.title,
  status: row.status,
  lang: row.lang,
  items: row.items,
  votes: row.votes,
  voters: row.voters,
  featured: row.featured,
  template: row.template,
  top: row.top,
  active: row.active,
});

export interface AdminList {
  boards: AdminRow[];
  limit: number;
  offset: number;
  filter: AdminFilter;
  q: string;
}

export interface AdminTotals {
  boards: number;
  open: number;
  votes: number;
  voters: number;
  /** Boards with at least one report awaiting the admin. */
  reported: number;
  /** Pictures awaiting the admin's review, over every board. */
  pictures: number;
  featured: number;
  hidden: number;
}

/** A report as the admin page shows it: its reason, note and time, never who sent it. */
export interface ReportView {
  reason: ReportReason;
  note: string;
  t: number;
}

/** Everything the admin page needs about one board: the full view, ranking included, its flags and reports. */
export interface AdminBoardView extends BoardView {
  alias: string;
  lang: BoardLang;
  touched: number;
  mod: Moderation;
  reports: ReportView[];
}

export function adminBoardView(board: SharedBoard, C: Computed, online: number, alias: string): AdminBoardView {
  return {
    ...boardView(board, C, online, true),
    alias,
    lang: board.lang,
    touched: board.touched,
    mod: board.mod,
    reports: [...board.reports.values()].map(({ reason, note, t }) => ({ reason, note, t })),
  };
}

// ─── Link previews ──────────────────────────────────────────────────────────

/** What a board's link preview says (the Worker writes it into the app page's head): no ranking, whoever asks. */
export interface Unfurl {
  title: string;
  lang: BoardLang;
  status: BoardStatus;
  items: { id: string; label: string }[];
  counts: { votes: number; voters: number };
}

export const unfurlOf = (board: SharedBoard): Unfurl => ({
  title: board.title,
  lang: board.lang,
  status: board.status,
  items: board.items.map(({ id, label }) => ({ id, label })),
  counts: { votes: board.votes.size, voters: board.voters.size },
});

// ─── "Your votes" ───────────────────────────────────────────────────────────

/** A board as one voter may see it, without a connection: what a card under "Your votes" needs. */
export interface BoardSummary {
  title: string;
  items: Item[];
  settings: BoardSettings;
  status: BoardStatus;
  counts: { votes: number; voters: number };
  /** This voter's vote count. */
  mine: number;
  /** The crowd order (item ids, best first) when this voter may see it, else null. */
  order: string[] | null;
}

export const boardSummary = (board: SharedBoard, C: Computed, voter: string): BoardSummary => ({
  title: board.title,
  items: board.items,
  settings: board.settings,
  status: board.status,
  counts: { votes: board.votes.size, voters: board.voters.size },
  mine: voteCount(board, voter),
  order: canSeeRanking(board, voter, false) ? C.order.map((i) => i.id) : null,
});

export interface SummaryRequest {
  voter: string;
  aliases: string[];
}

/** Validates a "Your votes" refresh: a voter id and 1 to LIMITS.summaries board aliases (duplicates dropped). */
export function parseSummaryRequest(x: unknown): Result<SummaryRequest> {
  if (!isRecord(x) || typeof x.voter !== 'string' || !VOTER_RE.test(x.voter) || !Array.isArray(x.aliases)) {
    return { ok: false, error: 'bad_request' };
  }
  const aliases = [...new Set(x.aliases)];
  if (!aliases.length || aliases.length > LIMITS.summaries) return { ok: false, error: 'bad_request' };
  if (!aliases.every((a): a is string => typeof a === 'string' && ALIAS_RE.test(a))) {
    return { ok: false, error: 'bad_request' };
  }
  return { ok: true, value: { voter: x.voter, aliases } };
}

const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 32;

/** Parses a raw WebSocket message; null when malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(m)) return null;
  switch (m.t) {
    case 'hello': {
      if (typeof m.voter !== 'string' || !VOTER_RE.test(m.voter)) return null;
      if (m.owner !== undefined && typeof m.owner !== 'string') return null;
      const pair = m.pair;
      if (pair !== undefined && !(Array.isArray(pair) && pair.length === 2 && pair.every(isId))) return null;
      return {
        t: 'hello',
        voter: m.voter,
        ...(m.owner === undefined ? {} : { owner: m.owner }),
        ...(pair === undefined ? {} : { pair: [pair[0], pair[1]] as [string, string] }),
      };
    }
    case 'vote':
      return isId(m.a) && isId(m.b) && isOutcome(m.s) ? { t: 'vote', a: m.a, b: m.b, s: m.s } : null;
    case 'skip':
    case 'undo':
      return isId(m.a) && isId(m.b) ? { t: m.t, a: m.a, b: m.b } : null;
    case 'reset':
      return { t: 'reset' };
    case 'add':
      return isRecord(m.item) ? { t: 'add', item: m.item } : null;
    default:
      return null;
  }
}
