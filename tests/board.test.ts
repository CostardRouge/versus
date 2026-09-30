import { describe, expect, it } from 'vitest';
import {
  ACTION_INTERVAL_MS,
  ADD_INTERVAL_MS,
  ALIAS_RE,
  addItem,
  assignPairs,
  boardMeta,
  canSeeRanking,
  castVote,
  createBoard,
  crowd,
  DEFAULT_SETTINGS,
  itemId,
  LIMITS,
  lastActivity,
  lastVote,
  localCopy,
  makeAlias,
  openSession,
  type PublishInput,
  parseNewItem,
  parsePublish,
  patchSettings,
  recolorItem,
  refill,
  removeItem,
  restoreBoard,
  retractAll,
  retractVote,
  sessionAdd,
  sessionReset,
  sessionSkip,
  sessionUndo,
  sessionVote,
  setStatus,
  toRanking,
  UNDO_GRACE_MS,
  updateSettings,
  voteCount,
  votesOf,
} from '../src/core/board';
import { pairKey } from '../src/core/scoring';
import type { Item, Result, SharedBoard } from '../src/core/types';
import { hueOf, mulberry32 } from '../src/core/util';

const V1 = 'voter-one-1';
const V2 = 'voter-two-2';
const T0 = 1_000_000;

const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: `Item ${i}`, img: null, fill: null, h: 10 }));

const input = (n = 4, over: Partial<PublishInput> = {}): PublishInput => ({
  title: 'Test',
  items: items(n),
  settings: { ...DEFAULT_SETTINGS },
  voter: V1,
  duels: [],
  ...over,
});

const board = (n = 4, over: Partial<PublishInput> = {}): SharedBoard => createBoard(input(n, over), T0);

function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unexpected error ${r.error}`);
  return r.value;
}

const errorOf = <T>(r: Result<T>): string | null => (r.ok ? null : r.error);

const keys = (pairs: [string, string][]): string[] => pairs.map(([a, b]) => pairKey(a, b));

describe('makeAlias', () => {
  it('draws 10 base58 characters', () => {
    const rng = mulberry32(3);
    const bytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rng() * 256));
    for (let i = 0; i < 20; i++) expect(makeAlias(bytes)).toMatch(ALIAS_RE);
  });

  it('rejects bytes that would bias the alphabet', () => {
    let calls = 0;
    const bytes = (n: number) => new Uint8Array(n).fill(calls++ === 0 ? 250 : 57);
    expect(makeAlias(bytes)).toBe('zzzzzzzzzz');
    expect(calls).toBe(2);
  });
});

describe('parsePublish', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    title: '  Best pizza  ',
    voter: V1,
    items: [
      { id: 'a', label: ' Margherita ', img: null, fill: null, h: 12 },
      { id: 'b', label: 'Regina', fill: null, h: 999 },
      { id: 'c', label: '', img: null, fill: { type: 'gradient', colors: ['#112233', '#445566'] }, h: 3 },
    ],
    ...over,
  });

  it('accepts a valid request and cleans it', () => {
    const p = value(
      parsePublish(
        raw({
          settings: { method: 'elo', visibility: 'blind' },
          duels: [
            { a: 'a', b: 'b', s: 1 },
            { a: 'a', b: 'zz', s: 1 },
            { a: 'c', b: 'c', s: 0.5 },
          ],
        }),
      ),
    );
    expect(p.title).toBe('Best pizza');
    expect(p.items.map((i) => i.label)).toEqual(['Margherita', 'Regina', '']);
    expect(p.items[0]?.h).toBe(12);
    expect(p.items[1]?.h).toBe(hueOf('Regina'));
    expect(p.items[1]?.img).toBeNull();
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, method: 'elo', visibility: 'blind' });
    expect(p.duels).toEqual([{ a: 'a', b: 'b', s: 1 }]);
  });

  it('falls back to Balanced for exact sort', () => {
    expect(value(parsePublish(raw({ settings: { method: 'sort' } }))).settings.method).toBe('bt');
  });

  it('refuses images', () => {
    const r = parsePublish(raw({ items: [{ id: 'a', label: 'x', img: 'data:image/jpeg;base64,', fill: null }, {}] }));
    expect(errorOf(r)).toBe('images_not_allowed');
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['no title', raw({ title: undefined })],
    ['a blank title', raw({ title: '   ' })],
    ['a long title', raw({ title: 'x'.repeat(LIMITS.title + 1) })],
    ['a bad voter id', raw({ voter: 'short' })],
    ['items not an array', raw({ items: 'a,b' })],
    ['one item', raw({ items: [{ id: 'a', label: 'x' }] })],
    ['too many items', raw({ items: items(LIMITS.items + 1) })],
    ['a duplicate id', raw({ items: [...items(2), { id: 'i0', label: 'again' }] })],
    [
      'a bad item id',
      raw({
        items: [
          { id: 'a b', label: 'x' },
          { id: 'c', label: 'y' },
        ],
      }),
    ],
    ['an item that is not an object', raw({ items: ['a', 'b'] })],
    [
      'a label that is not a string',
      raw({
        items: [
          { id: 'a', label: 3 },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    [
      'an empty text item',
      raw({
        items: [
          { id: 'a', label: '  ' },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    [
      'a long label',
      raw({
        items: [
          { id: 'a', label: 'x'.repeat(LIMITS.label + 1) },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    [
      'a solid fill with 2 colors',
      raw({
        items: [
          { id: 'a', label: 'x', fill: { type: 'solid', colors: ['#000000', '#ffffff'] } },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    [
      'a gradient with 1 color',
      raw({
        items: [
          { id: 'a', label: 'x', fill: { type: 'gradient', colors: ['#000000'] } },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    [
      'a bad hex color',
      raw({
        items: [
          { id: 'a', label: 'x', fill: { type: 'solid', colors: ['red'] } },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    [
      'an unknown fill type',
      raw({
        items: [
          { id: 'a', label: 'x', fill: { type: 'noise', colors: [] } },
          { id: 'b', label: 'y' },
        ],
      }),
    ],
    ['duels not an array', raw({ duels: {} })],
    ['too many duels', raw({ duels: Array.from({ length: LIMITS.duels + 1 }, () => ({ a: 'a', b: 'b', s: 1 })) })],
    ['a malformed duel', raw({ duels: [{ a: 'a', b: 'b', s: 2 }] })],
  ])('rejects %s', (_, body) => {
    expect(errorOf(parsePublish(body))).toBe('bad_request');
  });
});

describe('patchSettings', () => {
  it('applies valid fields and ignores the rest', () => {
    const next = patchSettings(DEFAULT_SETTINGS, {
      method: 'win',
      visibility: 'after',
      revealAfter: 5,
      allowChange: false,
      visitorsAddItems: true,
    });
    expect(next).toEqual({
      method: 'win',
      visibility: 'after',
      revealAfter: 5,
      allowChange: false,
      visitorsAddItems: true,
    });
    const same = patchSettings(next, {
      method: 'sort',
      visibility: 'public',
      revealAfter: 0,
      allowChange: 'yes',
      visitorsAddItems: 1,
    });
    expect(same).toEqual(next);
    expect(patchSettings(next, { revealAfter: 2.5 }).revealAfter).toBe(5);
    expect(patchSettings(next, { revealAfter: LIMITS.revealAfter + 1 }).revealAfter).toBe(5);
    expect(patchSettings(next, 'nope')).toEqual(next);
    expect(patchSettings(next, 'nope')).not.toBe(next);
  });
});

describe('board state', () => {
  it("turns the author's duels into votes, one per pair, the last one winning", () => {
    const b = board(3, {
      duels: [
        { a: 'i0', b: 'i1', s: 1 },
        { a: 'i1', b: 'i2', s: 1 },
        { a: 'i1', b: 'i0', s: 1 },
      ],
    });
    expect(b.votes.size).toBe(2);
    expect(voteCount(b, V1)).toBe(2);
    expect(toRanking(b).history).toEqual([
      { a: 'i1', b: 'i2', s: 1 },
      { a: 'i1', b: 'i0', s: 1 },
    ]);
    expect(b.status).toBe('open');
    expect(b.created).toBe(T0);
  });

  it('restores the same board from its stored parts', () => {
    const b = board(3, { duels: [{ a: 'i0', b: 'i1', s: 0.5 }] });
    value(castVote(b, V2, 'i2', 'i0', 0, T0 + 5));
    const copy = restoreBoard(boardMeta(b), b.items, b.votes.values());
    expect(boardMeta(copy)).toEqual(boardMeta(b));
    expect([...copy.votes.entries()]).toEqual([...b.votes.entries()]);
    expect(votesOf(copy, V2)).toEqual(votesOf(b, V2));
  });

  it('tracks the last activity', () => {
    const b = board();
    expect(lastActivity(b)).toBe(T0);
    value(castVote(b, V2, 'i0', 'i1', 1, T0 + 10));
    expect(lastActivity(b)).toBe(T0 + 10);
    setStatus(b, 'closed', T0 + 20);
    expect(b.status).toBe('closed');
    expect(lastActivity(b)).toBe(T0 + 20);
    updateSettings(b, { visibility: 'blind' }, T0 + 30);
    expect(b.settings.visibility).toBe('blind');
    expect(lastActivity(b)).toBe(T0 + 30);
  });
});

describe('votes', () => {
  it('keeps one voice per voter and pair; a new vote moves to the end', () => {
    const b = board();
    value(castVote(b, V1, 'i0', 'i1', 1, T0 + 1));
    value(castVote(b, V1, 'i2', 'i3', 1, T0 + 2));
    const r = value(castVote(b, V1, 'i1', 'i0', 1, T0 + 3));
    expect(r.replaced).toMatchObject({ a: 'i0', b: 'i1', s: 1 });
    expect(b.votes.size).toBe(2);
    expect(voteCount(b, V1)).toBe(2);
    expect(toRanking(b).history.at(-1)).toEqual({ a: 'i1', b: 'i0', s: 1 });
    expect(lastVote(b, V1)?.t).toBe(T0 + 3);
    value(castVote(b, V2, 'i0', 'i1', 0, T0 + 4));
    expect(b.votes.size).toBe(3);
    expect(b.voters.size).toBe(2);
  });

  it('refuses votes on unknown items, on a single item or on a closed board', () => {
    const b = board();
    expect(errorOf(castVote(b, V1, 'i0', 'nope', 1, T0))).toBe('unknown_item');
    expect(errorOf(castVote(b, V1, 'nope', 'i0', 1, T0))).toBe('unknown_item');
    expect(errorOf(castVote(b, V1, 'i0', 'i0', 1, T0))).toBe('unknown_item');
    setStatus(b, 'closed', T0);
    expect(errorOf(castVote(b, V1, 'i0', 'i1', 1, T0))).toBe('closed');
  });

  it('keeps votes final when the author forbids changes', () => {
    const b = board(4, { settings: { ...DEFAULT_SETTINGS, allowChange: false } });
    value(castVote(b, V1, 'i0', 'i1', 1, T0));
    expect(errorOf(castVote(b, V1, 'i1', 'i0', 1, T0 + 1))).toBe('final');
    value(castVote(b, V1, 'i2', 'i3', 1, T0 + 2));
    // Only the very last vote can be undone, and only within the grace delay.
    expect(errorOf(retractVote(b, V1, 'i0', 'i1', T0 + 3))).toBe('final');
    expect(errorOf(retractVote(b, V1, 'i2', 'i3', T0 + 2 + UNDO_GRACE_MS + 1))).toBe('final');
    expect(value(retractVote(b, V1, 'i3', 'i2', T0 + 2 + UNDO_GRACE_MS))).toMatchObject({ a: 'i2', b: 'i3' });
    expect(errorOf(retractAll(b, V1))).toBe('final');
  });

  it('deletes one vote or all of them', () => {
    const b = board();
    expect(errorOf(retractVote(b, V1, 'i0', 'i1', T0))).toBe('not_found');
    value(castVote(b, V1, 'i0', 'i1', 1, T0));
    value(castVote(b, V1, 'i1', 'i2', 1, T0));
    value(castVote(b, V2, 'i1', 'i2', 1, T0));
    value(retractVote(b, V1, 'i1', 'i0', T0 + 60_000));
    expect(voteCount(b, V1)).toBe(1);
    expect(value(retractAll(b, V1))).toHaveLength(1);
    expect(voteCount(b, V1)).toBe(0);
    expect(b.voters.has(V1)).toBe(false);
    expect(b.votes.size).toBe(1);
    expect(lastVote(b, V1)).toBeNull();
    setStatus(b, 'closed', T0);
    expect(errorOf(retractVote(b, V2, 'i1', 'i2', T0))).toBe('closed');
    expect(errorOf(retractAll(b, V2))).toBe('closed');
  });
});

describe('visibility', () => {
  it('follows the author setting, and always shows the author and closed boards', () => {
    const b = board();
    expect(canSeeRanking(b, null, false)).toBe(true);
    updateSettings(b, { visibility: 'after', revealAfter: 2 }, T0);
    expect(canSeeRanking(b, null, false)).toBe(false);
    expect(canSeeRanking(b, V2, false)).toBe(false);
    value(castVote(b, V2, 'i0', 'i1', 1, T0));
    expect(canSeeRanking(b, V2, false)).toBe(false);
    value(castVote(b, V2, 'i2', 'i3', 1, T0));
    expect(canSeeRanking(b, V2, false)).toBe(true);
    updateSettings(b, { visibility: 'blind' }, T0);
    expect(canSeeRanking(b, V2, false)).toBe(false);
    expect(canSeeRanking(b, V1, true)).toBe(true);
    setStatus(b, 'closed', T0);
    expect(canSeeRanking(b, null, false)).toBe(true);
  });
});

describe('crowd ranking', () => {
  it('pools every voter and uses the board method', () => {
    const b = board(3);
    for (const v of ['voter-aaaa', 'voter-bbbb', 'voter-cccc']) {
      value(castVote(b, v, 'i2', 'i1', 1, T0));
      value(castVote(b, v, 'i1', 'i0', 1, T0));
      value(castVote(b, v, 'i2', 'i0', 1, T0));
    }
    const C = crowd(b);
    expect(C.m).toBe('bt');
    expect(C.order.map((i) => i.id)).toEqual(['i2', 'i1', 'i0']);
    updateSettings(b, { method: 'win' }, T0);
    expect(crowd(b).m).toBe('win');
  });

  it('gives the author a local copy with every vote', () => {
    const b = board(3, { settings: { ...DEFAULT_SETTINGS, method: 'elo' } });
    value(castVote(b, V1, 'i0', 'i1', 1, T0));
    value(castVote(b, V2, 'i1', 'i2', 0, T0));
    const copy = localCopy(b, T0 + 99);
    expect(copy.title).toBe('Test');
    expect(copy.method).toBe('elo');
    expect(copy.items).toHaveLength(3);
    expect(copy.history).toEqual([
      { a: 'i0', b: 'i1', s: 1 },
      { a: 'i1', b: 'i2', s: 0 },
    ]);
    expect(copy.created).toBe(T0 + 99);
    expect(copy.updated).toBe(T0 + 99);
    expect(copy.pair).toBeNull();
  });
});

describe('assignPairs', () => {
  it('never offers a pair the voter voted on or an excluded one', () => {
    const b = board(4);
    value(castVote(b, V1, 'i0', 'i1', 1, T0));
    const exclude = new Set([pairKey('i2', 'i3')]);
    const pairs = assignPairs(b, V1, crowd(b), exclude, [], 10, mulberry32(1));
    expect(pairs).toHaveLength(4);
    expect(new Set(keys(pairs)).size).toBe(4);
    expect(keys(pairs)).not.toContain(pairKey('i0', 'i1'));
    expect(keys(pairs)).not.toContain(pairKey('i2', 'i3'));
    // Another voter can still get it.
    expect(keys(assignPairs(b, V2, crowd(b), new Set(), [], 10, mulberry32(1)))).toHaveLength(6);
  });

  it('favors items with few votes', () => {
    const b = board(5);
    for (let v = 0; v < 10; v++) {
      const voter = `crowd-voter-${v}`;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) value(castVote(b, voter, `i${i}`, `i${j}`, 1, T0));
      }
    }
    for (let seed = 1; seed <= 20; seed++) {
      const [first] = assignPairs(b, V1, crowd(b), new Set(), [], 1, mulberry32(seed));
      expect(first).toContain('i4');
    }
  });

  it('avoids items just seen', () => {
    const b = board(4);
    const [first] = assignPairs(b, V1, crowd(b), new Set(), ['i0', 'i1'], 1, () => 0);
    expect(pairKey(...(first as [string, string]))).toBe(pairKey('i2', 'i3'));
    value(castVote(b, V1, 'i2', 'i3', 1, T0));
    const [next] = assignPairs(b, V1, crowd(b), new Set(), [], 1, () => 0);
    expect(pairKey(...(next as [string, string]))).toBe(pairKey('i0', 'i1'));
  });

  it('copes with an item the cached ranking does not know yet', () => {
    const b = board(2);
    const C = crowd(b);
    b.items.push({ id: 'late', label: 'Late', img: null, fill: null, h: 0 });
    expect(assignPairs(b, V1, C, new Set(), [], 3, mulberry32(2))).toHaveLength(3);
  });
});

describe('items after publication', () => {
  it('validates new items like published ones', () => {
    expect(value(parseNewItem({ label: '  Hawaii  ' }))).toEqual({ label: 'Hawaii', fill: null });
    expect(value(parseNewItem({ label: '', fill: { type: 'solid', colors: ['#ff8800'] } })).fill?.colors).toEqual([
      '#ff8800',
    ]);
    expect(errorOf(parseNewItem({ label: 'x', img: 'data:' }))).toBe('images_not_allowed');
    expect(errorOf(parseNewItem({ label: '' }))).toBe('bad_request');
    expect(errorOf(parseNewItem({ label: 3 }))).toBe('bad_request');
    expect(errorOf(parseNewItem({ label: 'x', fill: { type: 'solid', colors: [] } }))).toBe('bad_request');
    expect(errorOf(parseNewItem('Hawaii'))).toBe('bad_request');
  });

  it('adds items to an open board, once per label, up to the limit', () => {
    const b = board(3);
    const item = value(addItem(b, { label: 'Hawaii', fill: null }, 'new1', T0 + 5));
    expect(item).toEqual({ id: 'new1', label: 'Hawaii', img: null, fill: null, h: hueOf('Hawaii') });
    expect(b.items).toHaveLength(4);
    expect(lastActivity(b)).toBe(T0 + 5);
    expect(errorOf(addItem(b, { label: 'HAWAII', fill: null }, 'new2', T0))).toBe('exists');
    const full = board(LIMITS.items);
    expect(errorOf(addItem(full, { label: 'One more', fill: null }, 'x', T0))).toBe('full');
    setStatus(b, 'closed', T0);
    expect(errorOf(addItem(b, { label: 'Late', fill: null }, 'x', T0))).toBe('closed');
  });

  it('removes an item with every vote that involves it, keeping at least 2 items', () => {
    const b = board(4);
    value(castVote(b, V1, 'i0', 'i1', 1, T0));
    value(castVote(b, V2, 'i1', 'i0', 1, T0));
    value(castVote(b, V2, 'i2', 'i3', 1, T0));
    const removed = value(removeItem(b, 'i0', T0 + 9));
    expect(removed).toHaveLength(2);
    expect(b.items.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(b.votes.size).toBe(1);
    expect(b.voters.has(V1)).toBe(false);
    expect(lastActivity(b)).toBe(T0 + 9);
    expect(errorOf(removeItem(b, 'i0', T0))).toBe('not_found');
    value(removeItem(b, 'i1', T0));
    expect(errorOf(removeItem(b, 'i2', T0))).toBe('too_few');
  });

  it('recolors a color item, dropping its votes, and the label follows a color code', () => {
    const b = board(4);
    const solid = (c: string) => ({ type: 'solid' as const, colors: [c] });
    b.items[0] = { ...(b.items[0] as Item), label: 'Ocre', fill: solid('#3e4c5e') };
    b.items[1] = { ...(b.items[1] as Item), label: '#3E4C5E', fill: solid('#3e4c5e') };
    value(castVote(b, V1, 'i0', 'i1', 1, T0));
    value(castVote(b, V2, 'i0', 'i2', 0, T0));
    value(castVote(b, V2, 'i2', 'i3', 1, T0));
    const r = value(recolorItem(b, 'i0', solid('#d9a441'), T0 + 7));
    expect(r.removed).toHaveLength(2);
    expect(r.item).toMatchObject({ id: 'i0', label: 'Ocre', fill: solid('#d9a441') });
    expect(b.items[0]).toBe(r.item);
    expect(b.votes.size).toBe(1);
    expect(b.voters.has(V1)).toBe(false);
    expect(lastActivity(b)).toBe(T0 + 7);
    // Same color again: nothing to drop.
    value(castVote(b, V2, 'i0', 'i3', 1, T0));
    expect(value(recolorItem(b, 'i0', solid('#D9A441'), T0)).removed).toEqual([]);
    expect(b.votes.size).toBe(2);
    // A label that was the code follows the new one.
    const coded = value(recolorItem(b, 'i1', { type: 'gradient', colors: ['#111111', '#222222'] }, T0)).item;
    expect(coded.label).toBe('#111111 → #222222');
    expect(coded.h).toBe(hueOf(coded.label));
  });

  it('refuses to recolor text items, unknown items, bad fills, taken labels and closed boards', () => {
    const b = board(3);
    const solid = (c: string) => ({ type: 'solid' as const, colors: [c] });
    b.items[0] = { ...(b.items[0] as Item), label: '#AA0000', fill: solid('#aa0000') };
    b.items[1] = { ...(b.items[1] as Item), label: '#BB0000' };
    expect(errorOf(recolorItem(b, 'i2', solid('#123456'), T0))).toBe('bad_request');
    expect(errorOf(recolorItem(b, 'nope', solid('#123456'), T0))).toBe('not_found');
    expect(errorOf(recolorItem(b, 'i0', { type: 'solid', colors: ['red'] }, T0))).toBe('bad_request');
    expect(errorOf(recolorItem(b, 'i0', null, T0))).toBe('bad_request');
    expect(errorOf(recolorItem(b, 'i0', solid('#bb0000'), T0))).toBe('exists');
    setStatus(b, 'closed', T0);
    expect(errorOf(recolorItem(b, 'i0', solid('#123456'), T0))).toBe('closed');
  });

  it('lets visitors add only when allowed, a few seconds apart; the author always', () => {
    const b = board(3);
    const visitor = openSession(b, V2, false, crowd(b), mulberry32(1));
    const author = openSession(b, V1, true, crowd(b), mulberry32(1));
    const item = (label: string) => ({ label, fill: null });
    expect(errorOf(sessionAdd(b, visitor, item('A'), 'a', T0))).toBe('forbidden');
    value(sessionAdd(b, author, item('B'), 'b', T0));
    updateSettings(b, { visitorsAddItems: true }, T0);
    value(sessionAdd(b, visitor, item('C'), 'c', T0));
    expect(visitor.lastAddAt).toBe(T0);
    expect(errorOf(sessionAdd(b, visitor, item('D'), 'd', T0 + ADD_INTERVAL_MS - 1))).toBe('too_fast');
    expect(errorOf(sessionAdd(b, visitor, item('C'), 'd', T0 + ADD_INTERVAL_MS))).toBe('exists');
    expect(visitor.lastAddAt).toBe(T0);
    value(sessionAdd(b, visitor, item('D'), 'd', T0 + ADD_INTERVAL_MS));
  });

  it('draws item ids the server accepts', () => {
    const id = itemId(Uint8Array.from({ length: 12 }, (_, i) => i * 21));
    expect(id).toMatch(/^[\w-]{12}$/);
  });
});

describe('sessions', () => {
  const rng = mulberry32(7);

  it('opens with a full queue of distinct pairs', () => {
    const b = board(5);
    const s = openSession(b, V2, false, crowd(b), rng);
    expect(s.queue).toHaveLength(LIMITS.queue);
    expect(new Set(keys(s.queue)).size).toBe(LIMITS.queue);
    expect(s).toMatchObject({ voter: V2, owner: false, skipped: [], lastActionAt: 0 });
    // Saying hello again keeps the rate limit.
    expect(openSession(b, V2, false, crowd(b), rng, T0).lastActionAt).toBe(T0);
  });

  it('accepts votes only on assigned pairs, not too fast, and refills', () => {
    const b = board(5);
    const s = openSession(b, V2, false, crowd(b), rng);
    const [a, c] = s.queue[0] as [string, string];
    const other = ['i0', 'i1', 'i2', 'i3', 'i4'].flatMap((x, i, all) => all.slice(i + 1).map((y) => [x, y] as const));
    const unassigned = other.find(([x, y]) => !keys(s.queue).includes(pairKey(x, y))) as [string, string];
    expect(errorOf(sessionVote(b, s, ...unassigned, 1, T0, crowd(b), rng))).toBe('not_assigned');
    value(sessionVote(b, s, a, c, 1, T0, crowd(b), rng));
    expect(voteCount(b, V2)).toBe(1);
    expect(s.lastActionAt).toBe(T0);
    expect(s.queue).toHaveLength(LIMITS.queue);
    expect(keys(s.queue)).not.toContain(pairKey(a, c));
    const [a2, c2] = s.queue[0] as [string, string];
    expect(errorOf(sessionVote(b, s, a2, c2, 1, T0 + ACTION_INTERVAL_MS - 1, crowd(b), rng))).toBe('too_fast');
    value(sessionVote(b, s, a2, c2, 0.5, T0 + ACTION_INTERVAL_MS, crowd(b), rng));
    expect(voteCount(b, V2)).toBe(2);
  });

  it('passes vote errors through', () => {
    const b = board(4);
    const s = openSession(b, V2, false, crowd(b), rng);
    const [a, c] = s.queue[0] as [string, string];
    value(castVote(b, V2, ...(s.queue[1] as [string, string]), 1, T0)); // from another tab
    updateSettings(b, { allowChange: false }, T0);
    s.queue[0] = s.queue[1] as [string, string];
    expect(errorOf(sessionVote(b, s, ...(s.queue[0] as [string, string]), 1, T0, crowd(b), rng))).toBe('final');
    // A closed board says so, even to a voter going too fast.
    setStatus(b, 'closed', T0);
    s.lastActionAt = T0;
    expect(errorOf(sessionVote(b, s, a, c, 1, T0, crowd(b), rng))).toBe('closed');
  });

  it('skips a pair and brings it back only when nothing else is left', () => {
    const b = board(3);
    const s = openSession(b, V2, false, crowd(b), rng);
    expect(errorOf(sessionSkip(b, s, 'i0', 'nope', T0, crowd(b), rng))).toBe('not_assigned');
    const first = s.queue[0] as [string, string];
    value(sessionSkip(b, s, ...first, T0, crowd(b), rng));
    expect(errorOf(sessionSkip(b, s, ...(s.queue[0] as [string, string]), T0 + 1, crowd(b), rng))).toBe('too_fast');
    expect(s.skipped).toEqual([]);
    // With 3 items there are only 3 pairs: the skipped one had to come back.
    expect(keys(s.queue).sort()).toEqual([pairKey('i0', 'i1'), pairKey('i0', 'i2'), pairKey('i1', 'i2')].sort());
    const big = board(8);
    const t = openSession(big, V2, false, crowd(big), rng);
    const skipped = t.queue[0] as [string, string];
    value(sessionSkip(big, t, ...skipped, T0, crowd(big), rng));
    expect(t.skipped).toEqual([pairKey(...skipped)]);
    expect(keys(t.queue)).not.toContain(pairKey(...skipped));
    for (let i = 1; i <= LIMITS.skipped + 3; i++) {
      value(sessionSkip(big, t, ...(t.queue[0] as [string, string]), T0 + i * ACTION_INTERVAL_MS, crowd(big), rng));
    }
    expect(t.skipped.length).toBeLessThanOrEqual(LIMITS.skipped);
  });

  it('undoes a vote and puts its pair back first', () => {
    const b = board(5);
    const s = openSession(b, V2, false, crowd(b), rng);
    expect(errorOf(sessionUndo(b, s, 'i0', 'i1', T0))).toBe('not_found');
    const voted = s.queue[1] as [string, string];
    value(sessionVote(b, s, ...voted, 1, T0, crowd(b), rng));
    value(sessionUndo(b, s, voted[1], voted[0], T0 + 1));
    expect(s.queue[0]).toEqual(voted);
    expect(s.queue).toHaveLength(LIMITS.queue);
    expect(voteCount(b, V2)).toBe(0);
  });

  it('resets all votes of the voter', () => {
    const b = board(5);
    const s = openSession(b, V2, false, crowd(b), rng);
    value(sessionVote(b, s, ...(s.queue[0] as [string, string]), 1, T0, crowd(b), rng));
    value(sessionSkip(b, s, ...(s.queue[0] as [string, string]), T0 + ACTION_INTERVAL_MS, crowd(b), rng));
    expect(value(sessionReset(b, s, crowd(b), rng))).toHaveLength(1);
    expect(voteCount(b, V2)).toBe(0);
    expect(s.skipped).toEqual([]);
    expect(s.queue).toHaveLength(LIMITS.queue);
    updateSettings(b, { allowChange: false }, T0);
    expect(errorOf(sessionReset(b, s, crowd(b), rng))).toBe('final');
  });

  it('refills around votes cast elsewhere, and empties when closed or done', () => {
    const b = board(3);
    const s = openSession(b, V2, false, crowd(b), rng);
    const [a, c] = s.queue[0] as [string, string];
    value(castVote(b, V2, a, c, 1, T0)); // from another tab
    refill(b, s, crowd(b), rng);
    expect(keys(s.queue)).not.toContain(pairKey(a, c));
    expect(s.queue).toHaveLength(2);
    for (const [x, y] of [...s.queue]) value(castVote(b, V2, x, y, 1, T0));
    refill(b, s, crowd(b), rng);
    expect(s.queue).toEqual([]);
    const t = openSession(b, V1, true, crowd(b), rng);
    setStatus(b, 'closed', T0);
    refill(b, t, crowd(b), rng);
    expect(t.queue).toEqual([]);
  });
});
