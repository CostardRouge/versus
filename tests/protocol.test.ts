import { describe, expect, it } from 'vitest';
import { castVote, createBoard, crowd, DEFAULT_SETTINGS } from '../src/core/board';
import { boardView, countsOf, MAX_MESSAGE, myDuels, parseClientMessage, rankingView } from '../src/core/protocol';

const VOTER = 'voter-one-1';

function board() {
  const items = ['A', 'B', 'C'].map((label, i) => ({ id: `i${i}`, label, img: null, fill: null, h: 0 }));
  const b = createBoard({ title: 'T', items, settings: { ...DEFAULT_SETTINGS }, voter: VOTER, duels: [] }, 1);
  castVote(b, VOTER, 'i0', 'i1', 1, 2);
  castVote(b, 'voter-two-2', 'i1', 'i2', 0.5, 3);
  return b;
}

describe('parseClientMessage', () => {
  it.each([
    [
      { t: 'hello', voter: VOTER },
      { t: 'hello', voter: VOTER },
    ],
    [
      { t: 'hello', voter: VOTER, owner: 'abc' },
      { t: 'hello', voter: VOTER, owner: 'abc' },
    ],
    [
      { t: 'vote', a: 'x', b: 'y', s: 0.5, extra: 1 },
      { t: 'vote', a: 'x', b: 'y', s: 0.5 },
    ],
    [
      { t: 'skip', a: 'x', b: 'y' },
      { t: 'skip', a: 'x', b: 'y' },
    ],
    [
      { t: 'undo', a: 'x', b: 'y' },
      { t: 'undo', a: 'x', b: 'y' },
    ],
    [{ t: 'reset' }, { t: 'reset' }],
    [
      { t: 'add', item: { label: 'x' } },
      { t: 'add', item: { label: 'x' } },
    ],
  ])('parses %j', (msg, expected) => {
    expect(parseClientMessage(JSON.stringify(msg))).toEqual(expected);
  });

  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['an unknown type', JSON.stringify({ t: 'shout' })],
    ['a bad voter id', JSON.stringify({ t: 'hello', voter: 'x' })],
    ['an owner token that is not a string', JSON.stringify({ t: 'hello', voter: VOTER, owner: 1 })],
    ['a bad outcome', JSON.stringify({ t: 'vote', a: 'x', b: 'y', s: 2 })],
    ['an add without an item', JSON.stringify({ t: 'add', item: 'x' })],
    ['an empty id', JSON.stringify({ t: 'skip', a: '', b: 'y' })],
    ['a long id', JSON.stringify({ t: 'undo', a: 'x'.repeat(33), b: 'y' })],
    ['a huge message', JSON.stringify({ t: 'reset', pad: 'x'.repeat(MAX_MESSAGE) })],
  ])('rejects %s', (_, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe('views', () => {
  it('rounds scores and keeps records', () => {
    const v = rankingView(crowd(board()));
    expect(v.method).toBe('bt');
    expect(v.order).toHaveLength(3);
    const a = v.stats.i0;
    expect(a).toMatchObject({ w: 1, l: 0, d: 0 });
    expect(Number.isInteger((a?.score ?? 0) * 1000)).toBe(true);
    expect(a?.se).not.toBeNull();
    const win = board();
    win.settings.method = 'win';
    expect(rankingView(crowd(win)).stats.i0?.se).toBeNull();
  });

  it('includes the ranking only when visible', () => {
    const b = board();
    const C = crowd(b);
    expect(boardView(b, C, 4, true)).toMatchObject({
      title: 'T',
      status: 'open',
      counts: { votes: 2, voters: 2, online: 4 },
    });
    expect(boardView(b, C, 4, true).ranking?.order).toHaveLength(3);
    expect(boardView(b, C, 4, false).ranking).toBeNull();
    expect(countsOf(b, 0)).toEqual({ votes: 2, voters: 2, online: 0 });
  });

  it("lists a voter's own votes", () => {
    expect(myDuels(board(), VOTER)).toEqual([{ a: 'i0', b: 'i1', s: 1 }]);
    expect(myDuels(board(), 'nobody-here')).toEqual([]);
  });
});
