import { isOutcome, isRecord, VOTER_RE, votesOf } from './board';
import type {
  BoardSettings,
  BoardStatus,
  Computed,
  Duel,
  ErrorCode,
  Item,
  MethodKey,
  Outcome,
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
  /** First message on a connection; `owner` is the owner token, for the author. */
  | { t: 'hello'; voter: string; owner?: string }
  | { t: 'vote'; a: string; b: string; s: Outcome }
  | { t: 'skip'; a: string; b: string }
  /** Deletes one of my votes; its pair comes back first in my queue. */
  | { t: 'undo'; a: string; b: string }
  /** Deletes all my votes. */
  | { t: 'reset' };

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
    case 'hello':
      if (typeof m.voter !== 'string' || !VOTER_RE.test(m.voter)) return null;
      if (m.owner !== undefined && typeof m.owner !== 'string') return null;
      return m.owner === undefined ? { t: 'hello', voter: m.voter } : { t: 'hello', voter: m.voter, owner: m.owner };
    case 'vote':
      return isId(m.a) && isId(m.b) && isOutcome(m.s) ? { t: 'vote', a: m.a, b: m.b, s: m.s } : null;
    case 'skip':
    case 'undo':
      return isId(m.a) && isId(m.b) ? { t: m.t, a: m.a, b: m.b } : null;
    case 'reset':
      return { t: 'reset' };
    default:
      return null;
  }
}
