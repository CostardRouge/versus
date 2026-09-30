import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/board';
import {
  addedItems,
  applySummary,
  type BoardSnapshot,
  joinedAgreement,
  joinedCopy,
  joinedTop,
  newsOf,
  pairsOf,
  parseJoined,
  seeBoard,
  sortJoined,
  upsertJoined,
} from '../src/core/joined';
import type { BoardSummary, BoardView } from '../src/core/protocol';
import type { Item, Joined } from '../src/core/types';

const ALIAS = 'Ab3dEf7hJk';
const item = (id: string, label = id): Item => ({ id, label, img: null, fill: null, h: 10 });
const items = [item('p0', 'Margherita'), item('p1', 'Regina'), item('p2', 'Calzone')];

const view = (over: Partial<BoardView> = {}): BoardView => ({
  title: 'Pizzas',
  items,
  settings: { ...DEFAULT_SETTINGS },
  status: 'open',
  created: 1,
  counts: { votes: 3, voters: 2, online: 1 },
  ranking: null,
  ...over,
});

const snap = (over: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  alias: ALIAS,
  view: view(),
  counts: { votes: 5, voters: 3, online: 2 },
  order: ['p0', 'p1', 'p2'],
  mine: [{ a: 'p2', b: 'p0', s: 1 }],
  count: 1,
  ...over,
});

const summary = (over: Partial<BoardSummary> = {}): BoardSummary => ({
  title: 'Pizzas',
  items,
  settings: { ...DEFAULT_SETTINGS },
  status: 'open',
  counts: { votes: 9, voters: 4 },
  mine: 1,
  order: ['p0', 'p1', 'p2'],
  ...over,
});

describe('seeBoard', () => {
  it('writes a card from the board page, everything on screen seen', () => {
    const j = seeBoard(undefined, snap(), 100, true);
    expect(j).toMatchObject({ alias: ALIAS, title: 'Pizzas', votes: 5, voters: 3, count: 1, joined: 100, voted: 100 });
    expect(j.seen).toEqual({ at: 100, status: 'open', items: ['p0', 'p1', 'p2'], visible: true });
    expect(j.mine).toEqual([{ a: 'p2', b: 'p0', s: 1 }]);
  });

  it('keeps when the card appeared, and the last vote unless this is one', () => {
    const first = seeBoard(undefined, snap(), 100, true);
    const visit = seeBoard(first, snap({ order: null }), 200);
    expect(visit).toMatchObject({ joined: 100, voted: 100 });
    expect(visit.seen).toMatchObject({ at: 200, visible: false });
    expect(seeBoard(visit, snap(), 300, true)).toMatchObject({ joined: 100, voted: 300 });
  });
});

describe('applySummary', () => {
  const j = seeBoard(undefined, snap({ order: null }), 100, true);

  it('refreshes the board without touching what the voter saw', () => {
    const next = applySummary(j, summary({ status: 'closed', mine: 2 }));
    expect(next).toMatchObject({ status: 'closed', votes: 9, voters: 4, count: 2, order: ['p0', 'p1', 'p2'] });
    expect(next.seen).toBe(j.seen);
    expect(next.mine).toBe(j.mine);
  });

  it('marks a board that no longer exists, and brings it back if it answers again', () => {
    const gone = applySummary(j, null);
    expect(gone.gone).toBe(true);
    expect(applySummary(gone, summary()).gone).toBeUndefined();
  });
});

describe('newsOf', () => {
  const base = seeBoard(undefined, snap({ order: null }), 100, true);

  it('says nothing when nothing changed', () => {
    expect(newsOf(base)).toBeNull();
    expect(newsOf(applySummary(base, summary({ order: null, counts: { votes: 50, voters: 9 } })))).toBeNull();
  });

  it('flags results the voter can now see, closed or not', () => {
    expect(newsOf(applySummary(base, summary({ status: 'closed' })))).toBe('revealed');
    expect(newsOf(applySummary(base, summary()))).toBe('revealed');
  });

  it('flags a closing when the results were already visible', () => {
    const visible = seeBoard(undefined, snap(), 100, true);
    expect(newsOf(applySummary(visible, summary({ status: 'closed' })))).toBe('closed');
  });

  it('counts items added while the vote is open', () => {
    const more = [...items, item('p3'), item('p4')];
    const added = applySummary(base, summary({ items: more, order: null }));
    expect(newsOf(added)).toBe('items');
    expect(addedItems(added)).toBe(2);
    // A reveal is the bigger news, the added items still count.
    expect(newsOf(applySummary(base, summary({ items: more })))).toBe('revealed');
    expect(addedItems(applySummary(base, summary({ items: more })))).toBe(2);
    const closedLater = { ...added, status: 'closed' as const, seen: { ...added.seen, status: 'closed' as const } };
    expect(newsOf(closedLater)).toBeNull();
    expect(addedItems(closedLater)).toBe(0);
    expect(addedItems({ ...added, gone: true })).toBe(0);
  });

  it('has nothing new for a board that is gone', () => {
    expect(newsOf(applySummary(applySummary(base, summary({ status: 'closed' })), null))).toBeNull();
  });
});

describe('sortJoined and upsertJoined', () => {
  it('puts news first, then the latest vote, boards that are gone last', () => {
    const at = (alias: string, voted: number, over: Partial<Joined> = {}): Joined => ({
      ...seeBoard(undefined, snap({ alias }), voted, true),
      ...over,
    });
    const old = at('Old3dEf7hJ', 10);
    const recent = at('New3dEf7hJ', 50);
    const gone = at('Gon3dEf7hJ', 90, { gone: true });
    const news = at('Nws3dEf7hJ', 5, { status: 'closed' });
    expect(sortJoined([old, gone, recent, news]).map((j) => j.alias)).toEqual([
      news.alias,
      recent.alias,
      old.alias,
      gone.alias,
    ]);
  });

  it('replaces a card by alias or adds it', () => {
    const a = seeBoard(undefined, snap(), 1, true);
    const b = seeBoard(undefined, snap({ alias: 'Zz3dEf7hJk' }), 2, true);
    expect(upsertJoined([a], b)).toEqual([a, b]);
    const a2 = { ...a, title: 'Renamed' };
    expect(upsertJoined([a, b], a2)).toEqual([a2, b]);
  });
});

describe('what a card shows', () => {
  it('shows the crowd when the voter may see it', () => {
    const j = seeBoard(undefined, snap({ order: ['p1', 'gone', 'p0', 'p2'] }), 1, true);
    const top = joinedTop(j, 2);
    expect(top.whose).toBe('crowd');
    expect(top.items.map((i) => i.id)).toEqual(['p1', 'p0']);
  });

  it('shows the voter’s own ranking while the crowd is hidden, never the crowd’s', () => {
    const mine = [
      { a: 'p2', b: 'p0', s: 1 as const },
      { a: 'p2', b: 'p1', s: 1 as const },
      { a: 'p1', b: 'p0', s: 1 as const },
      { a: 'p9', b: 'p0', s: 1 as const },
    ];
    // Items the voter never compared stay out of their top (unvoted, they would tie with the middle).
    const four = view({ items: [...items, item('p3')] });
    const top = joinedTop(seeBoard(undefined, snap({ view: four, order: null, mine: mine.slice(1) }), 1, true));
    expect(top.items.map((i) => i.id)).toEqual(['p2', 'p1', 'p0']);
    expect(top.whose).toBe('mine');
    const all = joinedTop(seeBoard(undefined, snap({ order: null, mine }), 1, true));
    expect(all.items.map((i) => i.id)).toEqual(['p2', 'p1', 'p0']);
    const none = joinedTop(seeBoard(undefined, snap({ order: null, mine: [] }), 1, true));
    expect(none).toEqual({ items, whose: 'none' });
  });

  it('counts pairs and agreement', () => {
    const j = seeBoard(undefined, snap({ count: 5 }), 1, true);
    expect(pairsOf(j)).toEqual({ done: 3, total: 3 });
    expect(joinedAgreement(j)).toBeNull();
    const mine = [
      { a: 'p0', b: 'p1', s: 1 as const },
      { a: 'p0', b: 'p2', s: 1 as const },
      { a: 'p2', b: 'p1', s: 1 as const },
    ];
    expect(joinedAgreement(seeBoard(undefined, snap({ mine }), 1, true))).toBeCloseTo(2 / 3);
    expect(joinedAgreement(seeBoard(undefined, snap({ mine, order: null }), 1, true))).toBeNull();
  });

  it('makes a local copy with the items and the voter’s votes on them', () => {
    const colors = [...items, { ...item('c'), fill: { type: 'solid' as const, colors: ['#123456'] } }];
    const mine = [
      { a: 'p0', b: 'c', s: 0 as const },
      { a: 'p0', b: 'zz', s: 1 as const },
    ];
    const j = seeBoard(undefined, snap({ view: view({ items: colors }), mine }), 1, true);
    const r = joinedCopy({ ...j, settings: { ...j.settings, method: 'elo' } });
    expect(r).toMatchObject({ title: 'Pizzas', method: 'elo', history: [{ a: 'p0', b: 'c', s: 0 }] });
    expect(r.items).toEqual(colors);
    expect(r.items[3]?.fill).not.toBe(colors[3]?.fill);
  });
});

describe('parseJoined', () => {
  it('keeps valid cards and drops garbage and repeats', () => {
    const good = seeBoard(undefined, snap(), 1, true);
    const hidden = { ...seeBoard(undefined, snap({ alias: 'Zz3dEf7hJk', order: null }), 1, true), gone: true };
    const bad = [
      null,
      'x',
      { ...good, alias: 'nope' },
      { ...good, alias: 'Yy3dEf7hJk', items: [{ id: 1 }] },
      { ...good, alias: 'Xx3dEf7hJk', status: 'weird' },
      { ...good, alias: 'Ww3dEf7hJk', mine: [{ a: 'p0', b: 'p1', s: 2 }] },
      { ...good, alias: 'Vv3dEf7hJk', seen: { at: 1, status: 'open', items: [], visible: 'yes' } },
      { ...good, alias: 'Uu3dEf7hJk', order: [1] },
      { ...good, alias: 'Tt3dEf7hJk', votes: Number.NaN },
      { ...good, alias: 'Ss3dEf7hJk', settings: null },
      good,
    ];
    expect(parseJoined([good, ...bad, hidden])).toEqual([good, hidden]);
    expect(parseJoined({})).toEqual([]);
    expect(parseJoined(null)).toEqual([]);
  });
});
