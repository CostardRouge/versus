export type MethodKey = 'bt' | 'elo' | 'win' | 'sort';

/** Outcome of a duel from A's point of view: 1 = A wins, 0 = B wins, 0.5 = tie. */
export type Outcome = 0 | 0.5 | 1;

export interface Fill {
  type: 'solid' | 'gradient';
  /** Hex colors (#rrggbb); a gradient uses 2 or 3 stops. */
  colors: string[];
}

export interface Item {
  id: string;
  label: string;
  /** Downscaled image as a data URL. */
  img: string | null;
  fill: Fill | null;
  /** Hue used to tint text-only cards. */
  h: number;
}

export interface Duel {
  a: string;
  b: string;
  s: Outcome;
}

export interface Ranking {
  id: string;
  title: string;
  method: MethodKey;
  items: Item[];
  history: Duel[];
  /** The pair currently on screen, persisted so a reload shows the same duel. */
  pair: [string, string] | null;
  created: number;
  updated: number;
  demo?: boolean;
  /** Set once published: the board's alias and its last known status. The owner token is kept apart. */
  pub?: { alias: string; status?: BoardStatus };
}

export interface ItemStats {
  score: number;
  games: number;
  w: number;
  l: number;
  d: number;
  /** Standard error in rating points (Bradley-Terry only). */
  se: number | null;
  idx: number;
  /** False only for items the exact sort has not placed yet. */
  placed: boolean;
  pos: number;
}

export interface ExactState {
  sorted: Item[];
  need: [string, string] | null;
  done: boolean;
}

export interface Computed {
  m: MethodKey;
  st: Record<string, ItemStats>;
  order: Item[];
  ex: ExactState | null;
  /** Number of valid duels taken into account. */
  n: number;
}

export type Rng = () => number;

// Published boards (see docs/published-boards.md).

export type Visibility = 'always' | 'after' | 'blind';
export type BoardStatus = 'open' | 'closed';

export interface BoardSettings {
  method: MethodKey;
  visibility: Visibility;
  /** N for the "after N votes" visibility. */
  revealAfter: number;
  allowChange: boolean;
  visitorsAddItems: boolean;
}

/** A crowd vote. One per voter and pair: a new vote on a pair replaces the previous one. */
export interface Vote extends Duel {
  voter: string;
  t: number;
}

export interface SharedBoard {
  title: string;
  items: Item[];
  settings: BoardSettings;
  status: BoardStatus;
  created: number;
  /** Last activity other than a vote (publication, settings, status), for the inactivity TTL. */
  touched: number;
  /** Votes in arrival order, keyed by voter and pair. */
  votes: Map<string, Vote>;
  /** The same votes grouped by voter, each group in arrival order and keyed by pair. */
  voters: Map<string, Map<string, Vote>>;
}

export type BoardMeta = Pick<SharedBoard, 'title' | 'settings' | 'status' | 'created' | 'touched'>;

/** One connected voter. Kept small and serializable: it lives in the WebSocket attachment. */
export interface Session {
  voter: string;
  owner: boolean;
  /** Pairs assigned to this voter and not voted yet; votes are accepted only on these. */
  queue: [string, string][];
  /** Pair keys skipped recently, not offered again for a while. */
  skipped: string[];
  /** Last vote or skip, for rate limiting. */
  lastActionAt: number;
}

export type ErrorCode =
  | 'bad_request'
  | 'images_not_allowed'
  | 'not_found'
  | 'forbidden'
  | 'exists'
  | 'closed'
  | 'unknown_item'
  | 'not_assigned'
  | 'final'
  | 'too_fast'
  | 'hello_first';

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };
