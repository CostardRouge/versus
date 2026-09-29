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
