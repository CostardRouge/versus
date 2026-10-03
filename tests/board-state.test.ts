import { describe, expect, it } from 'vitest';
import {
  answered,
  type Board,
  canVote,
  castCheck,
  castReset,
  castSkip,
  castSuggest,
  castUndo,
  castVote,
  newBoard,
  refused,
  suggesting,
} from '../src/app/board-state';
import type { BoardView } from '../src/core/protocol';

/** A board's state with its first state in: three items, three pairs to vote on, no vote yet. */
function opened(): Board & { view: BoardView } {
  const b = newBoard({ alias: 'Ab3dEf7hJk', owner: null, candidate: null, available: true, reopen: false });
  const view: BoardView = {
    title: 'Pizzas',
    items: ['p0', 'p1', 'p2'].map((id) => ({ id, label: id, img: null, fill: null, h: 10 })),
    settings: { method: 'bt', visibility: 'always', revealAfter: 2, allowChange: true, visitorsAddItems: true },
    status: 'open',
    created: 1,
    counts: { votes: 0, voters: 0, online: 1 },
    ranking: null,
  };
  b.view = view;
  b.pairs = [
    ['p0', 'p1'],
    ['p1', 'p2'],
    ['p0', 'p2'],
  ];
  return b as Board & { view: BoardView };
}

describe('a board’s state, without the page', () => {
  it('starts with nothing but how to reach the board', () => {
    const b = newBoard({ alias: 'Ab3dEf7hJk', owner: 'x', candidate: null, available: false, reopen: true });
    expect(b.conn).toBe('unavailable');
    expect([b.view, b.mine, b.pending, b.reopen]).toEqual([null, [], [], true]);
    expect(canVote(b)).toBe(false);
  });

  it('counts a vote at once, and takes it back when the server refuses it', () => {
    const b = opened();
    castVote(b, { a: 'p0', b: 'p1', s: 1 });
    expect([b.mine.length, b.count, b.pairs[0]]).toEqual([1, 1, ['p1', 'p2']]);
    expect(refused(b)).toEqual({ kind: 'vote', reverted: true });
    expect(b.mine).toEqual([]);
    // Refused once: a second error on the same message changes nothing more.
    expect(refused(b)).toEqual({ kind: 'vote', reverted: false });
    // The queue the server sends next answers it, and puts the duel and the count right.
    expect(answered(b, [['p0', 'p1']], 0)?.kind).toBe('vote');
    expect([b.pending, b.count, b.pairs]).toEqual([[], 0, [['p0', 'p1']]]);
  });

  it('answers messages in the order they were sent', () => {
    const b = opened();
    castVote(b, { a: 'p0', b: 'p1', s: 0.5 });
    castSkip(b);
    expect(b.pairs).toEqual([['p0', 'p2']]);
    expect(answered(b, b.pairs, 1)?.kind).toBe('vote');
    expect(answered(b, b.pairs, 1)?.kind).toBe('skip');
    expect(answered(b, b.pairs, 1)).toBeUndefined();
  });

  it('puts an undone vote’s pair first, and the vote back in its place if refused', () => {
    const b = opened();
    const first = { a: 'p0', b: 'p1', s: 1 as const };
    const last = { a: 'p1', b: 'p2', s: 0 as const };
    castVote(b, first);
    castVote(b, last);
    answered(b, b.pairs, 2);
    answered(b, b.pairs, 2);
    castUndo(b, last);
    expect([b.mine, b.count, b.pairs]).toEqual([
      [first],
      1,
      [
        ['p1', 'p2'],
        ['p0', 'p2'],
      ],
    ]);
    refused(b);
    expect(b.mine).toEqual([first, last]);
  });

  it('clears my votes, and brings them back if the reset is refused', () => {
    const b = opened();
    castVote(b, { a: 'p0', b: 'p1', s: 1 });
    answered(b, b.pairs, 1);
    const mine = b.mine;
    castReset(b);
    expect([b.mine, b.count]).toEqual([[], 0]);
    refused(b);
    expect(b.mine).toBe(mine);
  });

  it('waits for a suggestion’s answer, and frees the field once it is refused', () => {
    const b = opened();
    castSuggest(b, 'Hawaii');
    expect([suggesting(b), b.sentLabel]).toEqual([true, 'Hawaii']);
    expect(refused(b)).toEqual({ kind: 'add', reverted: false });
    expect([suggesting(b), b.sentLabel]).toEqual([false, null]);
  });

  it('holds votes while a human check awaits its answer', () => {
    const b = opened();
    expect(canVote(b)).toBe(true);
    castCheck(b);
    expect(canVote(b)).toBe(false);
    answered(b, b.pairs, 0);
    expect(canVote(b)).toBe(true);
  });
});
