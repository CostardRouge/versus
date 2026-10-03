import { describe, expect, it } from 'vitest';
import { mkItem, mkRank } from '../src/core/model';
import {
  compute,
  ensurePair,
  exactSort,
  expected,
  finishedBy,
  METHOD_KEYS,
  nextPair,
  pairKey,
  pushDuel,
  remaining,
  sortRemaining,
  stability,
  target,
  undoDuel,
  validHistory,
} from '../src/core/scoring';
import type { Item, MethodKey, Ranking } from '../src/core/types';
import { mulberry32 } from '../src/core/util';

/** A ranking whose hidden preference order is the order of `labels`. */
function ranking(labels: string[], method: MethodKey): Ranking {
  const r = mkRank('test', method);
  r.items = labels.map((l) => mkItem(l));
  return r;
}

/** Plays duels picked by the app itself, always preferring the item listed first in `labels`. */
function playConsistently(r: Ranking, labels: string[], max = 60, seed = 1): number {
  const rank = (id: string) => labels.indexOf(r.items.find((i) => i.id === id)?.label ?? '');
  const rng = mulberry32(seed);
  let played = 0;
  for (; played < max; played++) {
    const p = nextPair(r, null, compute(r), rng);
    if (!p) break;
    pushDuel(r, p[0], p[1], rank(p[0]) < rank(p[1]) ? 1 : 0);
  }
  return played;
}

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

describe('expected', () => {
  it('gives even odds for equal ratings and is symmetric', () => {
    expect(expected(1500, 1500)).toBe(0.5);
    expect(expected(1700, 1500) + expected(1500, 1700)).toBeCloseTo(1);
    expect(expected(1900, 1500)).toBeCloseTo(10 / 11);
  });
});

describe('pairKey', () => {
  it('ignores order', () => {
    expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'));
  });
});

describe.each(METHOD_KEYS)('%s method', (method) => {
  it('recovers a consistent preference order', () => {
    const r = ranking(LABELS, method);
    playConsistently(r, LABELS, method === 'sort' ? 100 : 40);
    expect(compute(r).order.map((i) => i.label)).toEqual(LABELS);
  });

  it('keeps the insertion order before any duel', () => {
    const r = ranking(LABELS, method);
    const C = compute(r);
    expect(C.n).toBe(0);
    expect(C.order.map((i) => i.label)).toEqual(LABELS);
  });

  it('counts wins, losses and ties', () => {
    const r = ranking(['A', 'B'], method);
    const [a, b] = r.items.map((i) => i.id) as [string, string];
    pushDuel(r, a, b, 1);
    pushDuel(r, a, b, 0.5);
    const C = compute(r);
    expect(C.st[a]).toMatchObject({ games: 2, w: 1, l: 0, d: 1 });
    expect(C.st[b]).toMatchObject({ games: 2, w: 0, l: 1, d: 1 });
  });
});

describe('Bradley-Terry', () => {
  it('does not depend on the order of duels', () => {
    const r = ranking(LABELS, 'bt');
    playConsistently(r, ['C', 'A', 'F', 'B', 'E', 'D'], 25);
    // Add a couple of upsets so the data is not perfectly consistent.
    const ids = r.items.map((i) => i.id);
    pushDuel(r, ids[3] as string, ids[2] as string, 1);
    pushDuel(r, ids[5] as string, ids[1] as string, 0.5);
    const before = compute(r);
    const shuffled = { ...r, history: [...r.history].reverse() };
    const after = compute(shuffled);
    for (const id of ids) expect(after.st[id]?.score).toBeCloseTo(before.st[id]?.score ?? 0, 6);
  });

  it('starts at 1500 and narrows the margin as duels accumulate', () => {
    const r = ranking(['A', 'B'], 'bt');
    const [a, b] = r.items.map((i) => i.id) as [string, string];
    const fresh = compute(r).st[a];
    expect(fresh?.score).toBeCloseTo(1500);
    pushDuel(r, a, b, 1);
    const se1 = compute(r).st[a]?.se ?? 0;
    for (let i = 0; i < 5; i++) pushDuel(r, a, b, i % 2 ? 1 : 0.5);
    const se6 = compute(r).st[a]?.se ?? 0;
    expect(se6).toBeLessThan(se1);
    expect(Number.isFinite(compute(r).st[a]?.score)).toBe(true);
  });
});

describe('Elo', () => {
  it('depends on the order of duels', () => {
    const r = ranking(['A', 'B', 'C'], 'elo');
    const [a, b, c] = r.items.map((i) => i.id) as [string, string, string];
    pushDuel(r, a, b, 1);
    pushDuel(r, b, c, 1);
    pushDuel(r, c, a, 1);
    const forward = compute(r).st[a]?.score;
    const backward = compute({ ...r, history: [...r.history].reverse() }).st[a]?.score;
    expect(forward).not.toBeCloseTo(backward ?? 0, 3);
  });

  it('is zero-sum while both items share the same K factor', () => {
    const r = ranking(['A', 'B'], 'elo');
    const [a, b] = r.items.map((i) => i.id) as [string, string];
    pushDuel(r, a, b, 1);
    const C = compute(r);
    expect((C.st[a]?.score ?? 0) + (C.st[b]?.score ?? 0)).toBeCloseTo(3000);
  });
});

describe('exact sort', () => {
  it('finishes within the binary insertion bound and then asks for nothing', () => {
    const r = ranking(LABELS, 'sort');
    const played = playConsistently(r, LABELS, 100);
    expect(played).toBeLessThanOrEqual(sortRemaining(LABELS.length, 1));
    const C = compute(r);
    expect(C.ex?.done).toBe(true);
    expect(nextPair(r)).toBeNull();
    expect(stability(r, C)).toBe(1);
    expect(remaining(r, C)).toBe(0);
  });

  it('asks for the comparison it is missing', () => {
    const r = ranking(['A', 'B', 'C'], 'sort');
    const ex = exactSort(r, []);
    expect(ex.sorted.map((i) => i.label)).toEqual(['A']);
    expect(ex.need).toEqual([r.items[1]?.id, r.items[0]?.id]);
  });

  it('marks items not placed yet', () => {
    const r = ranking(['A', 'B', 'C'], 'sort');
    const C = compute(r);
    expect(C.st[r.items[0]?.id ?? '']?.placed).toBe(true);
    expect(C.st[r.items[2]?.id ?? '']?.placed).toBe(false);
  });
});

describe('pair selection', () => {
  it('returns null with fewer than two items', () => {
    expect(nextPair(ranking(['A'], 'bt'))).toBeNull();
  });

  it('avoids the pair that was just skipped when others exist', () => {
    const r = ranking(['A', 'B', 'C'], 'bt');
    const [a, b] = r.items.map((i) => i.id) as [string, string];
    for (let seed = 1; seed < 20; seed++) {
      const p = nextPair(r, [a, b], compute(r), mulberry32(seed));
      expect(p && pairKey(p[0], p[1])).not.toBe(pairKey(a, b));
    }
  });

  it('keeps a valid pair and replaces one whose item was removed', () => {
    const r = ranking(['A', 'B', 'C'], 'bt');
    expect(ensurePair(r)).toBe(true);
    const kept = r.pair;
    expect(ensurePair(r)).toBe(false);
    expect(r.pair).toBe(kept);
    r.items = r.items.filter((i) => i.id !== kept?.[0]);
    expect(ensurePair(r)).toBe(true);
    expect(r.pair).not.toContain(kept?.[0]);
  });
});

describe('history', () => {
  it('ignores duels involving removed items', () => {
    const r = ranking(['A', 'B', 'C'], 'bt');
    const [a, b, c] = r.items.map((i) => i.id) as [string, string, string];
    pushDuel(r, a, b, 1);
    pushDuel(r, b, c, 1);
    r.items = r.items.filter((i) => i.id !== c);
    expect(validHistory(r)).toHaveLength(1);
    expect(compute(r).n).toBe(1);
  });

  it('undo removes the last duel and puts its pair back', () => {
    const r = ranking(['A', 'B'], 'bt');
    const [a, b] = r.items.map((i) => i.id) as [string, string];
    pushDuel(r, a, b, 1);
    expect(undoDuel(r)).toBe(true);
    expect(r.history).toHaveLength(0);
    expect(r.pair).toEqual([a, b]);
    expect(undoDuel(r)).toBe(false);
  });
});

describe('stability', () => {
  it('is 0 below two items and reaches 1 at the target', () => {
    expect(stability(ranking(['A'], 'bt'))).toBe(0);
    const r = ranking(LABELS, 'win');
    playConsistently(r, LABELS, target(r));
    expect(stability(r)).toBe(1);
  });
});

describe('finishedBy', () => {
  it('spots the duel that completes the exact sort, once', () => {
    const r = mkRank('t', 'sort');
    r.items = ['x', 'y', 'z'].map((l) => mkItem(l));
    let prev = compute(r);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 10; i++) {
      ensurePair(r, prev);
      if (!r.pair) break;
      const [a, b] = r.pair;
      pushDuel(r, a, b, 1);
      r.pair = null;
      const next = compute(r);
      seen.push(finishedBy(r, prev, next));
      prev = next;
    }
    expect(seen.at(-1)).toBe('sort');
    expect(seen.filter((x) => x !== null)).toHaveLength(1);
  });

  it('spots a rating method reaching full stability', () => {
    const r = mkRank('t', 'bt');
    r.items = ['x', 'y'].map((l) => mkItem(l));
    const [a, b] = r.items.map((i) => i.id) as [string, string];
    pushDuel(r, a, b, 1);
    const before = compute(r);
    expect(stability(r, before)).toBeLessThan(1);
    pushDuel(r, a, b, 0);
    const after = compute(r);
    expect(finishedBy(r, before, after)).toBe('stable');
    pushDuel(r, a, b, 1);
    expect(finishedBy(r, after, compute(r))).toBeNull();
  });
});

describe('compute, kept per history', () => {
  /** The same ranking computed from scratch: copies of its history and items share nothing with it. */
  const fresh = (r: Ranking, upto?: number) =>
    compute({ ...r, history: r.history.map((d) => ({ ...d })), items: [...r.items] }, upto);
  const plain = (C: ReturnType<typeof compute>) => ({ ...C, order: C.order.map((i) => i.id) });

  it('gives back the same computation until the history, the items or the method change', () => {
    const r = ranking(['A', 'B', 'C', 'D'], 'bt');
    playConsistently(r, ['A', 'B', 'C', 'D'], 8);
    const C = compute(r);
    expect(compute(r)).toBe(C);
    expect(compute({ ...r, method: 'bt' })).toBe(C);
    const [a, b] = r.items as [Item, Item];
    const checks: [string, () => void][] = [
      ['a duel', () => pushDuel(r, a.id, b.id, 0)],
      ['an undo', () => undoDuel(r)],
      [
        'an undo then another duel',
        () => {
          undoDuel(r);
          pushDuel(r, b.id, a.id, 0.5);
        },
      ],
      ['an item added in place', () => r.items.push(mkItem('E'))],
      ['an item replaced in place', () => (r.items[4] = mkItem('F'))],
      ['an item removed', () => (r.items = r.items.filter((i) => i.label !== 'F'))],
      ['the method', () => (r.method = 'elo')],
    ];
    for (const [what, change] of checks) {
      const before = compute(r);
      change();
      const after = compute(r);
      expect(after, what).not.toBe(before);
      expect(plain(after), what).toEqual(plain(fresh(r)));
    }
    // An earlier point of the history is kept apart from the whole of it, and still holds after a new duel.
    expect(plain(compute(r, 3))).toEqual(plain(fresh(r, 3)));
    expect(compute(r, 3)).not.toBe(compute(r));
    const n = r.history.length;
    const before = compute(r);
    pushDuel(r, a.id, b.id, 1);
    expect(compute(r, n)).toBe(before);
  });
});

describe('Bradley-Terry on flat arrays', () => {
  /** The fit as it was written before (Maps and arrays allocated at each iteration): the scores must not move. */
  function reference(r: Ranking): Record<string, { score: number; se: number }> {
    const n = r.items.length;
    const ix: Record<string, number> = {};
    r.items.forEach((it, i) => {
      ix[it.id] = i;
    });
    const wins = new Array<number>(n).fill(0.5);
    const adj = r.items.map(() => new Map<number, number>());
    for (const h of validHistory(r)) {
      const a = ix[h.a] as number;
      const b = ix[h.b] as number;
      wins[a] = (wins[a] as number) + h.s;
      wins[b] = (wins[b] as number) + 1 - h.s;
      adj[a]?.set(b, (adj[a]?.get(b) ?? 0) + 1);
      adj[b]?.set(a, (adj[b]?.get(a) ?? 0) + 1);
    }
    let p = new Array<number>(n).fill(1);
    for (let iter = 0; iter < 400; iter++) {
      const prev = p;
      const next = prev.map((pi, i) => {
        let den = 1 / (pi + 1);
        adj[i]?.forEach((c, j) => {
          den += c / (pi + (prev[j] as number));
        });
        return (wins[i] as number) / den;
      });
      let diff = 0;
      next.forEach((v, i) => {
        diff = Math.max(diff, Math.abs(Math.log(v / (prev[i] as number))));
      });
      p = next;
      if (diff < 1e-7) break;
    }
    const LOG = 400 / Math.LN10;
    return Object.fromEntries(
      r.items.map((item, i) => {
        const pi = p[i] as number;
        let info = pi / (pi + 1) ** 2;
        adj[i]?.forEach((c, j) => {
          const pj = p[j] as number;
          info += (c * pi * pj) / (pi + pj) ** 2;
        });
        return [item.id, { score: 1500 + LOG * Math.log(pi), se: LOG / Math.sqrt(info) }];
      }),
    );
  }

  it('gives exactly the same scores and margins, to the last bit', () => {
    for (const [n, duels, seed] of [
      [2, 1, 1],
      [6, 40, 2],
      [30, 180, 3],
      [100, 800, 4],
    ] as const) {
      const rng = mulberry32(seed);
      const r = ranking(
        Array.from({ length: n }, (_, i) => `I${i}`),
        'bt',
      );
      for (let k = 0; k < duels; k++) {
        const a = r.items[Math.floor(rng() * n)] as Item;
        const b = r.items[Math.floor(rng() * n)] as Item;
        if (a !== b) pushDuel(r, a.id, b.id, ([0, 0.5, 1] as const)[Math.floor(rng() * 3)] as 0 | 0.5 | 1);
      }
      const want = reference(r);
      const C = compute(r);
      for (const it of r.items) {
        expect(C.st[it.id]?.score, `${n}/${it.id}`).toBe(want[it.id]?.score);
        expect(C.st[it.id]?.se, `${n}/${it.id}`).toBe(want[it.id]?.se);
      }
    }
  });
});
