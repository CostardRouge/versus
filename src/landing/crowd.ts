import type { Outcome, Rng } from '../core/types.ts';
import type { ShowItem } from './data.ts';

/** A simulated duel: the stronger item usually wins (the app demos' rule, with 6 % of ties). */
export function duelOutcome(A: ShowItem, B: ShowItem, rng: Rng): Outcome {
  const pa = 1 / (1 + 10 ** ((B.s - A.s) / 220));
  const x = rng();
  return x < 0.06 ? 0.5 : x < pa ? 1 : 0;
}

/**
 * The published board example: votes drawn from the items' hidden strengths, one random pair at a time.
 * Pure, so the build renders the board after the first votes and the page replays them, then goes on live.
 */

export interface Tally {
  w: number;
  g: number;
}

export interface Crowd {
  items: readonly ShowItem[];
  tally: Map<string, Tally>;
  votes: number;
  rng: Rng;
}

export function crowd(items: readonly ShowItem[], rng: Rng): Crowd {
  return { items, tally: new Map(items.map((it) => [it.id, { w: 0, g: 0 }])), votes: 0, rng };
}

/** One vote; returns the winner's id, or null for a tie. */
export function vote(c: Crowd): string | null {
  const n = c.items.length;
  const i = Math.floor(c.rng() * n);
  let j = Math.floor(c.rng() * (n - 1));
  if (j >= i) j++;
  const A = c.items[i] as ShowItem;
  const B = c.items[j] as ShowItem;
  const s = duelOutcome(A, B, c.rng);
  const a = c.tally.get(A.id) as Tally;
  const b = c.tally.get(B.id) as Tally;
  a.g++;
  b.g++;
  c.votes++;
  a.w += s;
  b.w += 1 - s;
  return s === 1 ? A.id : s === 0 ? B.id : null;
}

/** Smoothed win rate, the app's Simple method. */
export const rate = (t: Tally): number => (t.w + 1) / (t.g + 2);

/** Ids, best first. */
export function standings(c: Crowd): string[] {
  const r = (id: string) => rate(c.tally.get(id) as Tally);
  return c.items.map((it) => it.id).sort((x, y) => r(y) - r(x));
}
