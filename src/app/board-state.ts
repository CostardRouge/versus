import type { BoardView, Counts, RankingView } from '../core/protocol';
import { pairKey } from '../core/scoring';
import type { Duel, Item } from '../core/types';
import type { BoardSocket, Connection } from './remote';

/**
 * The published board on screen, as this browser knows it: what the server last said, my votes as sent, and the
 * messages that await the server's answer, each with how to undo its optimistic change. No DOM here: the board page
 * (board.ts) and its author's workspace (author.ts) draw it.
 */

export interface Board {
  alias: string;
  owner: string | null;
  /** A token from an admin link, sent but not yet confirmed by the server: it is stored only once it is. */
  candidate: string | null;
  socket: BoardSocket | null;
  conn: Connection | 'unavailable';
  view: BoardView | null;
  isOwner: boolean;
  /** My votes in order, updated optimistically. */
  mine: Duel[];
  /** My vote count as the server last reported it. */
  count: number;
  pairs: [string, string][];
  counts: Counts;
  /** Ranking on screen, and the newest one received (they differ while live updates are off). */
  shown: RankingView | null;
  shownVotes: number;
  latest: RankingView | null;
  latestVotes: number;
  /** One entry per message awaiting its "pairs" answer, with how to undo its optimistic change if refused. */
  pending: Pending[];
  /** Label of the item just sent, so the field empties once it shows up. */
  sentLabel: string | null;
  busy: boolean;
  /** Set while withdrawing, so the closing socket doesn't read as an expired board. */
  leaving: boolean;
  /** The end-of-vote page is showing instead of the board. */
  finale: boolean;
  /** Something changed during the reveal: render again once it ends. */
  finaleDirty: boolean;
  /** Whether the server takes pictures for review (asked once the author is known); null until it answers. */
  pictures: boolean | null;
  /** A connection failed: while the first state waits, the page offers to try again. */
  failed: boolean;
  /** Opened on the end-of-vote page's history entry: the first state shows that page again, if it can. */
  reopen: boolean;
}

export interface Pending {
  kind: 'vote' | 'skip' | 'undo' | 'reset' | 'add' | 'check';
  revert?: () => void;
  /** Refused already: only the queue that follows is awaited. */
  refused?: boolean;
}

let B: Board | null = null;

/** The board on screen, if any. */
export const boardState = (): Board | null => B;
export function setBoardState(b: Board | null): void {
  B = b;
}

/** A board being opened: nothing known yet but how to reach it. */
export function newBoard(o: {
  alias: string;
  owner: string | null;
  candidate: string | null;
  available: boolean;
  reopen: boolean;
}): Board {
  return {
    alias: o.alias,
    owner: o.owner,
    candidate: o.candidate,
    socket: null,
    conn: o.available ? 'connecting' : 'unavailable',
    view: null,
    isOwner: false,
    mine: [],
    count: 0,
    pairs: [],
    counts: { votes: 0, voters: 0, online: 0 },
    shown: null,
    shownVotes: 0,
    latest: null,
    latestVotes: 0,
    pending: [],
    sentLabel: null,
    busy: false,
    leaving: false,
    finale: false,
    finaleDirty: false,
    pictures: null,
    failed: false,
    reopen: o.reopen,
  };
}

export const itemOf = (id: string): Item | undefined => B?.view?.items.find((i) => i.id === id);

/** The author's page is the workspace (author.ts); the board's own page is for visitors. */
export const authoring = (b: Board | null): b is Board & { view: BoardView } => !!b?.view && b.isOwner && !!b.owner;

/** A visitor's suggestion was sent and the server hasn't answered yet. */
export const suggesting = (b: Board): boolean => b.pending.some((p) => p.kind === 'add' && !p.refused);

/** Votes wait for the pick on screen, and for the answer to a human check. */
export const canVote = (b: Board | null): b is Board & { view: BoardView } =>
  !!b?.view && !b.busy && b.view.status === 'open' && !b.pending.some((p) => p.kind === 'check');

// ─── Messages awaiting the server's answer ──────────────────────────────────

/** A vote sent: it counts on screen at once, the next pair comes up. */
export function castVote(b: Board, duel: Duel): void {
  b.mine.push(duel);
  b.pending.push({
    kind: 'vote',
    revert: () => {
      b.mine = b.mine.filter((d) => d !== duel);
    },
  });
  b.pairs.shift();
  b.count++;
}

/** A skip sent: the next pair comes up. */
export function castSkip(b: Board): void {
  b.pending.push({ kind: 'skip' });
  b.pairs.shift();
}

/** My last vote taken back: its pair comes first again. */
export function castUndo(b: Board, last: Duel): void {
  const at = b.mine.length - 1;
  b.mine.pop();
  b.pending.push({
    kind: 'undo',
    revert: () => {
      b.mine.splice(at, 0, last);
    },
  });
  const k = pairKey(last.a, last.b);
  b.pairs = [[last.a, last.b], ...b.pairs.filter(([x, y]) => pairKey(x, y) !== k)];
  b.count = Math.max(0, b.count - 1);
}

/** All my votes cleared. */
export function castReset(b: Board): void {
  const prev = b.mine;
  b.mine = [];
  b.count = 0;
  b.pending.push({
    kind: 'reset',
    revert: () => {
      b.mine = prev;
    },
  });
}

/** A visitor's suggestion sent: it shows once the server takes it, and the field then empties. */
export function castSuggest(b: Board, label: string): void {
  b.sentLabel = label;
  b.pending.push({ kind: 'add' });
}

/** A human check's token sent: votes wait for the answer. */
export function castCheck(b: Board): void {
  b.pending.push({ kind: 'check' });
}

/** The server's queue came: it answers the oldest message awaiting one, which it returns. */
export function answered(b: Board, pairs: [string, string][], mine: number): Pending | undefined {
  const head = b.pending.shift();
  b.pairs = pairs;
  b.count = mine;
  return head;
}

/**
 * The server refused the oldest message awaiting an answer (the queue it sends next answers it): its optimistic
 * change is undone, once. Returns what it was, and whether something on screen changed back.
 */
export function refused(b: Board): { kind: Pending['kind'] | undefined; reverted: boolean } {
  const head = b.pending[0];
  const revert = head?.revert;
  if (head && revert) {
    revert();
    head.revert = undefined;
  }
  if (head?.kind === 'add') {
    b.sentLabel = null;
    head.refused = true;
  }
  return { kind: head?.kind, reverted: !!revert };
}
