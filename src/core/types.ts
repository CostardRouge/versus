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
  /** Downscaled image as a data URL; on a published board, the address of an approved picture. */
  img: string | null;
  fill: Fill | null;
  /** Hue used to tint text-only cards. */
  h: number;
  /** On a published board: a picture sent for the moderator's review, or refused (docs/published-boards.md#images). */
  pic?: PictureState;
}

/** A published item's picture while it isn't shown: waiting for the moderator, or refused by them. */
export type PictureState = 'pending' | 'refused';

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

/** The language a board was published in: its link previews speak it. */
export type BoardLang = 'en' | 'fr';

/** Why a visitor reports a board (docs/published-boards.md#moderation). */
export type ReportReason = 'spam' | 'offensive' | 'personal' | 'other';

/** A visitor's report of a board: one per voter, the newest replacing the older one. */
export interface Report {
  voter: string;
  reason: ReportReason;
  /** A few words from the reporter, possibly empty. */
  note: string;
  t: number;
}

/**
 * What the admin decided about a board: hidden, it keeps working for whoever has its link but stays out of
 * every public list; featured, it is put forward in them.
 */
export interface Moderation {
  hidden: boolean;
  featured: boolean;
}

export interface SharedBoard {
  title: string;
  items: Item[];
  settings: BoardSettings;
  status: BoardStatus;
  created: number;
  /** Last activity other than a vote (publication, settings, status), for the inactivity TTL. */
  touched: number;
  lang: BoardLang;
  mod: Moderation;
  /** The site's own board (an official template, `core/templates.ts`): never expires, the admin is its author. */
  official: boolean;
  /** The template it was made from (its key), or '' (docs/published-boards.md#official-templates). */
  template: string;
  /** Votes in arrival order, keyed by voter and pair. */
  votes: Map<string, Vote>;
  /** The same votes grouped by voter, each group in arrival order and keyed by pair. */
  voters: Map<string, Map<string, Vote>>;
  /** Visitors' reports, keyed by voter, in arrival order. */
  reports: Map<string, Report>;
}

export type BoardMeta = Pick<
  SharedBoard,
  'title' | 'settings' | 'status' | 'created' | 'touched' | 'lang' | 'mod' | 'official' | 'template'
>;

/**
 * A published board this browser voted on without managing it: a card under "Your votes" in the
 * gallery, kept on this device. A snapshot, so the card reads offline and after the board is gone.
 */
export interface Joined {
  alias: string;
  title: string;
  items: Item[];
  settings: BoardSettings;
  status: BoardStatus;
  votes: number;
  voters: number;
  /** The crowd order (item ids, best first) as this voter may see it; null while hidden from them. */
  order: string[] | null;
  /** This voter's votes as last seen on the board (their own ranking, and the copy they can keep). */
  mine: Duel[];
  /** This voter's vote count as the server last reported it. */
  count: number;
  /** When the card appeared, and this voter's last vote. */
  joined: number;
  voted: number;
  /** What the voter saw on their last visit to the board, to tell what changed since. */
  seen: { at: number; status: BoardStatus; items: string[]; visible: boolean };
  /** The board no longer exists (withdrawn or expired). */
  gone?: boolean;
}

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
  /** Last item this connection added. */
  lastAddAt?: number;
  /** This connection passed a human check (Turnstile), asked before a first vote on the site's own boards. */
  human?: boolean;
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
  | 'hello_first'
  | 'full'
  | 'too_few'
  | 'captcha'
  | 'rate_limited'
  /** The app speaks a protocol the server no longer serves: a new version of the app is needed. */
  | 'upgrade'
  /** What the request was about changed since it was read (a picture the author sent again before its review). */
  | 'changed';

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };
