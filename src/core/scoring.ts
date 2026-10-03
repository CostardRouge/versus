import { getItem } from './model.ts';
import type { Computed, Duel, ExactState, Item, ItemStats, MethodKey, Outcome, Ranking, Rng } from './types.ts';

export const METHOD_KEYS: readonly MethodKey[] = ['bt', 'elo', 'win', 'sort'];

export const methodOf = (r: Pick<Ranking, 'method'>): MethodKey => (METHOD_KEYS.includes(r.method) ? r.method : 'bt');

/** Rating points per natural-log unit of strength (400 points = factor 10). */
const LOG = 400 / Math.LN10;
const ELO_START = 1500;

/** Probability that a player rated `ra` beats one rated `rb`. */
export const expected = (ra: number, rb: number): number => 1 / (1 + 10 ** ((rb - ra) / 400));

/** Order-independent key for a pair of item ids. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Duels whose two items still exist, up to (excluding) index `upto`. */
export function validHistory(r: Ranking, upto = r.history.length): Duel[] {
  const ids = new Set(r.items.map((i) => i.id));
  return r.history.slice(0, upto).filter((h) => ids.has(h.a) && ids.has(h.b));
}

/**
 * Binary insertion sort driven by recorded duels. Replaying from scratch keeps undo trivial:
 * the first comparison without a recorded result is the next duel to ask for.
 */
export function exactSort(r: Ranking, history: Duel[]): ExactState {
  const winners = new Map<string, string>();
  for (const h of history) winners.set(pairKey(h.a, h.b), h.s === 0 ? h.b : h.a);
  const sorted: Item[] = [];
  for (const it of r.items) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const other = sorted[mid] as Item;
      const w = winners.get(pairKey(it.id, other.id));
      if (w === undefined) return { sorted, need: [it.id, other.id], done: false };
      if (w === it.id) hi = mid;
      else lo = mid + 1;
    }
    sorted.splice(lo, 0, it);
  }
  return { sorted, need: null, done: true };
}

function eloScores(r: Ranking, H: Duel[], st: Record<string, ItemStats>): void {
  const games: Record<string, number> = {};
  for (const i of r.items) {
    (st[i.id] as ItemStats).score = ELO_START;
    games[i.id] = 0;
  }
  const k = (id: string) => ((games[id] ?? 0) < 6 ? 40 : 24);
  for (const h of H) {
    const A = st[h.a] as ItemStats;
    const B = st[h.b] as ItemStats;
    const ea = expected(A.score, B.score);
    const da = k(h.a) * (h.s - ea);
    const db = k(h.b) * (1 - h.s - (1 - ea));
    A.score += da;
    B.score += db;
    games[h.a] = (games[h.a] ?? 0) + 1;
    games[h.b] = (games[h.b] ?? 0) + 1;
  }
}

/**
 * Bradley-Terry fitted with MM iterations (Hunter, 2004). Each item also holds a virtual tie
 * against a fixed anchor of strength 1 (1500 points), which keeps every score finite and
 * pulls items with few duels toward the middle.
 */
function bradleyTerryScores(r: Ranking, H: Duel[], st: Record<string, ItemStats>): void {
  const n = r.items.length;
  const ix: Record<string, number> = {};
  r.items.forEach((it, i) => {
    ix[it.id] = i;
  });
  const wins = new Float64Array(n).fill(0.5);
  const adj = r.items.map(() => new Map<number, number>());
  for (const h of H) {
    const a = ix[h.a] as number;
    const b = ix[h.b] as number;
    wins[a] = (wins[a] as number) + h.s;
    wins[b] = (wins[b] as number) + 1 - h.s;
    adj[a]?.set(b, (adj[a]?.get(b) ?? 0) + 1);
    adj[b]?.set(a, (adj[b]?.get(a) ?? 0) + 1);
  }
  // Each item's opponents and duel counts in flat arrays, in the order they were met (the sums below add up in the
  // same order as before, so the scores don't change by a bit); the iterations then allocate nothing.
  const start = new Int32Array(n + 1);
  adj.forEach((m, i) => {
    start[i + 1] = (start[i] as number) + m.size;
  });
  const nbr = new Int32Array(start[n] as number);
  const cnt = new Float64Array(start[n] as number);
  adj.forEach((m, i) => {
    let k = start[i] as number;
    m.forEach((c, j) => {
      nbr[k] = j;
      cnt[k++] = c;
    });
  });
  let p = new Float64Array(n).fill(1);
  let next = new Float64Array(n);
  for (let iter = 0; iter < 400; iter++) {
    let diff = 0;
    for (let i = 0; i < n; i++) {
      const pi = p[i] as number;
      let den = 1 / (pi + 1);
      for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
        den += (cnt[k] as number) / (pi + (p[nbr[k] as number] as number));
      }
      next[i] = (wins[i] as number) / den;
    }
    for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(Math.log((next[i] as number) / (p[i] as number))));
    [p, next] = [next, p];
    if (diff < 1e-7) break;
  }
  r.items.forEach((item, i) => {
    const pi = p[i] as number;
    let info = pi / (pi + 1) ** 2;
    for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
      const pj = p[nbr[k] as number] as number;
      info += ((cnt[k] as number) * pi * pj) / (pi + pj) ** 2;
    }
    const s = st[item.id] as ItemStats;
    s.score = ELO_START + LOG * Math.log(pi);
    s.se = LOG / Math.sqrt(info);
  });
}

/** One computation kept for a ranking's history: what it was computed from, by reference. */
interface Memo {
  m: MethodKey;
  upto: number;
  /** The last duel taken into account: the history only grows or shrinks at its end, so the duels before it match. */
  at: Duel | undefined;
  items: readonly Item[];
  refs: Item[];
  C: Computed;
}

/** Computations kept per history array (a ranking and its `{ ...r, method }` copies share it). */
const memos = new WeakMap<Duel[], Memo[]>();
/** Computations kept per history: the methods a page compares, and the duels before the last ones. */
const MEMO_SIZE = 8;

const same = (e: Memo, r: Ranking, m: MethodKey, upto: number): boolean =>
  e.m === m &&
  e.upto === upto &&
  e.at === r.history[upto - 1] &&
  e.items === r.items &&
  e.refs.length === r.items.length &&
  e.refs.every((it, i) => it === r.items[i]);

/**
 * Scores, order and win/loss records for a ranking, using its scoring method. The result is shared and must not
 * be changed: the same duels, items and method give back the same object without computing it again (a duel
 * renders the list, the duel and the ranking from one computation). Duels and items are compared by reference, so
 * a duel added or undone, an item added, removed or replaced computes afresh.
 */
export function compute(r: Ranking, upto = r.history.length): Computed {
  const m = methodOf(r);
  const kept = memos.get(r.history) ?? [];
  const hit = kept.find((e) => same(e, r, m, upto));
  if (hit) return hit.C;
  const C = computeFresh(r, m, upto);
  const memo: Memo = { m, upto, at: r.history[upto - 1], items: r.items, refs: [...r.items], C };
  memos.set(r.history, [memo, ...kept].slice(0, MEMO_SIZE));
  return C;
}

function computeFresh(r: Ranking, m: MethodKey, upto: number): Computed {
  const H = validHistory(r, upto);
  const st: Record<string, ItemStats> = {};
  r.items.forEach((it, i) => {
    st[it.id] = { score: 0, games: 0, w: 0, l: 0, d: 0, se: null, idx: i, placed: true, pos: i };
  });
  for (const h of H) {
    const A = st[h.a] as ItemStats;
    const B = st[h.b] as ItemStats;
    A.games++;
    B.games++;
    if (h.s === 1) {
      A.w++;
      B.l++;
    } else if (h.s === 0) {
      A.l++;
      B.w++;
    } else {
      A.d++;
      B.d++;
    }
  }
  let ex: ExactState | null = null;
  if (m === 'elo') eloScores(r, H, st);
  else if (m === 'bt') bradleyTerryScores(r, H, st);
  else if (m === 'win') {
    for (const i of r.items) {
      const s = st[i.id] as ItemStats;
      s.score = (s.w + 0.5 * s.d + 1) / (s.games + 2);
    }
  } else {
    ex = exactSort(r, H);
    const n = r.items.length;
    for (const i of r.items) {
      const s = st[i.id] as ItemStats;
      s.placed = false;
      s.score = -1;
    }
    ex.sorted.forEach((it, k) => {
      const s = st[it.id] as ItemStats;
      s.placed = true;
      s.score = n - k;
    });
  }
  let order: Item[];
  if (ex) {
    const placed = new Set(ex.sorted.map((i) => i.id));
    order = ex.sorted.concat(r.items.filter((i) => !placed.has(i.id)));
  } else {
    const s = (id: string) => st[id] as ItemStats;
    order = [...r.items].sort(
      (x, y) => s(y.id).score - s(x.id).score || s(y.id).games - s(x.id).games || s(x.id).idx - s(y.id).idx,
    );
  }
  order.forEach((it, k) => {
    (st[it.id] as ItemStats).pos = k;
  });
  return { m, st, order, ex, n: H.length };
}

/** Rough number of duels after which a rating-based ranking is considered stable. */
export function target(r: Ranking): number {
  const n = r.items.length;
  return n < 2 ? 0 : Math.max(n, Math.round(n * Math.log2(n) * 1.2));
}

/** Upper bound of comparisons binary insertion still needs once `placed` items are sorted. */
export function sortRemaining(n: number, placed: number): number {
  let s = 0;
  for (let k = Math.max(1, placed); k < n; k++) s += Math.ceil(Math.log2(k + 1));
  return s;
}

/** Progress from 0 to 1: duel coverage for ratings, placed items for the exact sort. */
export function stability(r: Ranking, C: Computed = compute(r)): number {
  const n = r.items.length;
  if (n < 2) return 0;
  if (C.ex) return C.ex.done ? 1 : Math.max(0, (C.ex.sorted.length - 1) / (n - 1));
  return Math.min(1, C.n / target(r));
}

/**
 * What the duel between `before` and `after` completed: the exact sort placing its last item, or a
 * rating method reaching full stability for the first time. Null otherwise.
 */
export function finishedBy(r: Ranking, before: Computed, after: Computed): 'sort' | 'stable' | null {
  if (r.items.length < 2 || stability(r, before) >= 1 || stability(r, after) < 1) return null;
  return after.ex ? 'sort' : 'stable';
}

export function remaining(r: Ranking, C: Computed): number {
  if (C.ex) return C.ex.done ? 0 : sortRemaining(r.items.length, C.ex.sorted.length);
  return Math.max(0, target(r) - C.n);
}

/**
 * Next pair to show. Rating methods favor items with few duels, close positions and
 * pairs not seen yet, and avoid repeating the previous duel's items.
 */
export function nextPair(
  r: Ranking,
  avoid: [string, string] | null = null,
  C: Computed = compute(r),
  rng: Rng = Math.random,
): [string, string] | null {
  const items = r.items;
  if (items.length < 2) return null;
  if (C.ex) {
    const need = C.ex.need;
    if (!need) return null;
    return rng() < 0.5 ? [need[0], need[1]] : [need[1], need[0]];
  }
  const played: Record<string, number> = {};
  for (const h of r.history) {
    const k = pairKey(h.a, h.b);
    played[k] = (played[k] ?? 0) + 1;
  }
  const last = r.history[r.history.length - 1];
  const lastIds = last ? [last.a, last.b] : [];
  const avoidKey = avoid ? pairKey(avoid[0], avoid[1]) : null;
  let best: [string, string] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as Item;
      const b = items[j] as Item;
      const k = pairKey(a.id, b.id);
      const sa = C.st[a.id] as ItemStats;
      const sb = C.st[b.id] as ItemStats;
      let s = (sa.games + sb.games) * 0.6 + Math.abs(sa.pos - sb.pos) * 0.8 + (played[k] ?? 0) * 2.5 + rng() * 1.4;
      if (lastIds.includes(a.id)) s += 1.5;
      if (lastIds.includes(b.id)) s += 1.5;
      if (k === avoidKey) s += 1000;
      if (s < bestScore) {
        bestScore = s;
        best = [a.id, b.id];
      }
    }
  }
  if (best && rng() < 0.5) best.reverse();
  return best;
}

/** Keeps the stored pair if it is still valid, otherwise picks a new one. Returns true when `r.pair` changed. */
export function ensurePair(r: Ranking, C: Computed = compute(r)): boolean {
  if (C.ex) {
    const need = C.ex.need;
    if (!need) {
      const changed = r.pair !== null;
      r.pair = null;
      return changed;
    }
    if (r.pair && pairKey(r.pair[0], r.pair[1]) === pairKey(need[0], need[1])) return false;
  } else if (r.pair && getItem(r, r.pair[0]) && getItem(r, r.pair[1])) return false;
  r.pair = nextPair(r, null, C);
  return true;
}

export function pushDuel(r: Ranking, a: string, b: string, s: Outcome): void {
  r.history.push({ a, b, s });
  r.updated = Date.now();
}

/** Removes the last duel and puts its pair back on screen. */
export function undoDuel(r: Ranking): boolean {
  const h = r.history.pop();
  if (!h) return false;
  r.pair = getItem(r, h.a) && getItem(r, h.b) ? [h.a, h.b] : null;
  r.updated = Date.now();
  return true;
}
