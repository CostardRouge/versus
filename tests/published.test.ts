import { describe, expect, it } from 'vitest';
import { LIMITS, VOTER_RE } from '../src/core/board';
import { mkItem, mkRank } from '../src/core/model';
import type { RankingView } from '../src/core/protocol';
import {
  agreement,
  crowdCheck,
  lastDuelPerPair,
  neckAndNeck,
  ownRanking,
  parseBoardHash,
  publishBlock,
  publishMethod,
  publishRequest,
  totalPairs,
  voterId,
} from '../src/core/published';
import type { MethodKey, Ranking } from '../src/core/types';

/** Links as the app wrote them before it had paths (D92): the board in the fragment, `?owner=` for its author. */
const boardHash = (alias: string): string => `#/b/${alias}`;
const adminHash = (alias: string, owner: string): string => `${boardHash(alias)}?owner=${owner}`;

const ALIAS = 'Ab3dEf7hJk';
const TOKEN = 'a'.repeat(64);

function ranking(n: number, method: MethodKey = 'bt'): Ranking {
  const r = mkRank('Pizzas', method);
  r.items = Array.from({ length: n }, (_, i) => mkItem(`Item ${i}`));
  return r;
}

const view = (method: MethodKey, rows: [string, number, number | null][]): RankingView => ({
  method,
  order: rows.map(([id]) => id),
  stats: Object.fromEntries(rows.map(([id, score, se]) => [id, { score, se, w: 0, l: 0, d: 0 }])),
});

describe('publishing', () => {
  it('says why a ranking cannot be published', () => {
    expect(publishBlock(ranking(1))).toBe('too_few');
    expect(publishBlock(ranking(LIMITS.items + 1))).toBe('too_many');
    const withImage = ranking(3);
    (withImage.items[1] as { img: string | null }).img = 'data:image/jpeg;base64,';
    expect(publishBlock(withImage)).toBe('images');
    expect(publishBlock(ranking(2))).toBeNull();
  });

  it('publishes exact sort as Balanced and keeps other methods', () => {
    expect(publishMethod(ranking(3, 'sort'))).toBe('bt');
    expect(publishMethod(ranking(3, 'elo'))).toBe('elo');
  });

  it('keeps the last duel per pair, in the order the server counts them', () => {
    const r = ranking(3);
    const [a, b, c] = r.items.map((i) => i.id) as [string, string, string];
    r.history = [
      { a, b, s: 1 },
      { a: b, b: c, s: 0.5 },
      { a: b, b: a, s: 1 },
      { a, b: 'deleted', s: 1 },
    ];
    expect(lastDuelPerPair(r)).toEqual([
      { a: b, b: c, s: 0.5 },
      { a: b, b: a, s: 1 },
    ]);
  });

  it('builds the request without images and within the server limits', () => {
    const r = ranking(2);
    r.title = 'x'.repeat(LIMITS.title + 10);
    (r.items[0] as { label: string }).label = 'y'.repeat(LIMITS.label + 5);
    r.history = [{ a: r.items[0]?.id ?? '', b: r.items[1]?.id ?? '', s: 1 }];
    const req = publishRequest(r, 'voter-one-1', { visibility: 'blind' }, true, 'fr');
    expect(req.title).toHaveLength(LIMITS.title);
    expect(req.items[0]?.label).toHaveLength(LIMITS.label);
    expect(req.items.every((i) => i.img === null)).toBe(true);
    expect(req.duels).toHaveLength(1);
    expect(req.settings).toEqual({ visibility: 'blind' });
    expect(req.lang).toBe('fr');
    const bare = publishRequest(r, 'voter-one-1', {}, false);
    expect(bare.duels).toEqual([]);
    expect(bare.lang).toBe('en');
  });
});

describe('links', () => {
  it('builds and parses board and admin links', () => {
    expect(parseBoardHash(boardHash(ALIAS))).toEqual({ alias: ALIAS, owner: null });
    expect(parseBoardHash(adminHash(ALIAS, TOKEN))).toEqual({ alias: ALIAS, owner: TOKEN });
  });

  it.each(['', '#', '#/b/', '#/b/short', '#/b/0OIl0OIl0O', `#/b/${ALIAS}?owner=nope`, `#/x/${ALIAS}`])(
    'ignores %j',
    (hash) => {
      expect(parseBoardHash(hash)).toBeNull();
    },
  );

  it('makes voter ids the server accepts', () => {
    const id = voterId(Uint8Array.from({ length: 22 }, (_, i) => i * 11));
    expect(id).toHaveLength(22);
    expect(id).toMatch(VOTER_RE);
  });

  it('counts pairs', () => {
    expect(totalPairs(2)).toBe(1);
    expect(totalPairs(5)).toBe(10);
  });
});

describe('the voter and the crowd', () => {
  const crowd = view('bt', [
    ['a', 1700, 40],
    ['b', 1600, 40],
    ['c', 1500, 40],
  ]);

  it('measures agreement on decisive votes only', () => {
    const mine = [
      { a: 'a', b: 'b', s: 1 as const },
      { a: 'c', b: 'b', s: 0 as const },
      { a: 'c', b: 'a', s: 1 as const },
      { a: 'a', b: 'c', s: 0.5 as const },
      { a: 'a', b: 'gone', s: 1 as const },
    ];
    expect(agreement(mine, crowd)).toBeCloseTo(2 / 3);
    expect(agreement(mine.slice(0, 2), crowd)).toBeNull();
    expect(agreement(mine.slice(0, 2), crowd, 2)).toBe(1);
  });

  it('lists the picks the crowd contradicts, widest gap first', () => {
    const four = view('bt', [
      ['a', 1700, 40],
      ['b', 1600, 40],
      ['c', 1500, 40],
      ['d', 1400, 40],
    ]);
    const mine = [
      { a: 'b', b: 'a', s: 1 as const },
      { a: 'a', b: 'd', s: 0 as const },
      { a: 'a', b: 'c', s: 1 as const },
      { a: 'b', b: 'c', s: 0.5 as const },
    ];
    expect(crowdCheck(mine, four)).toEqual({
      total: 3,
      against: [
        ['d', 'a'],
        ['b', 'a'],
      ],
    });
  });

  it('ranks a voter from their own votes', () => {
    const items = ['x', 'y', 'z'].map((l) => mkItem(l));
    const [x, y, z] = items.map((i) => i.id) as [string, string, string];
    const own = ownRanking(
      items,
      [
        { a: z, b: x, s: 1 },
        { a: z, b: y, s: 1 },
        { a: y, b: x, s: 1 },
      ],
      'bt',
    );
    expect(own.order.map((i) => i.label)).toEqual(['z', 'y', 'x']);
    expect(own.st[z]).toMatchObject({ w: 2, l: 0 });
  });

  it('flags items too close to the one above', () => {
    const close = view('bt', [
      ['a', 1700, 30],
      ['b', 1680, 30],
      ['c', 1500, 30],
      ['d', 1490, null],
    ]);
    expect([...neckAndNeck(close)]).toEqual(['b']);
    expect(
      neckAndNeck(
        view('elo', [
          ['a', 1510, null],
          ['b', 1500, null],
        ]),
      ).size,
    ).toBe(0);
  });
});
