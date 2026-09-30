import { describe, expect, it } from 'vitest';
import { castVote, createBoard, crowd, DEFAULT_SETTINGS, LIMITS, setStatus } from '../src/core/board';
import {
  boardSummary,
  boardView,
  countsOf,
  MAX_MESSAGE,
  myDuels,
  parseClientMessage,
  parseSummaryRequest,
  rankingView,
} from '../src/core/protocol';

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

describe('summaries for "Your votes"', () => {
  it('gives each voter their vote count and the crowd order only when they may see it', () => {
    const b = board();
    expect(boardSummary(b, crowd(b), VOTER)).toMatchObject({
      title: 'T',
      status: 'open',
      counts: { votes: 2, voters: 2 },
      mine: 1,
    });
    expect(boardSummary(b, crowd(b), VOTER).order).toHaveLength(3);
    b.settings.visibility = 'blind';
    expect(boardSummary(b, crowd(b), VOTER).order).toBeNull();
    b.settings.visibility = 'after';
    b.settings.revealAfter = 1;
    expect(boardSummary(b, crowd(b), VOTER).order).toHaveLength(3);
    expect(boardSummary(b, crowd(b), 'nobody-here')).toMatchObject({ mine: 0, order: null });
    setStatus(b, 'closed', 9);
    expect(boardSummary(b, crowd(b), 'nobody-here').order).toHaveLength(3);
  });

  it('parses a refresh request, dropping repeated aliases', () => {
    expect(parseSummaryRequest({ voter: VOTER, aliases: ['Ab3dEf7hJk', 'Ab3dEf7hJk', 'Zz3dEf7hJk'] })).toEqual({
      ok: true,
      value: { voter: VOTER, aliases: ['Ab3dEf7hJk', 'Zz3dEf7hJk'] },
    });
  });

  it.each([
    ['no body', null],
    ['a bad voter', { voter: 'x', aliases: ['Ab3dEf7hJk'] }],
    ['no aliases', { voter: VOTER, aliases: [] }],
    ['aliases that are not a list', { voter: VOTER, aliases: 'Ab3dEf7hJk' }],
    ['a bad alias', { voter: VOTER, aliases: ['Ab3dEf7hJk', 'nope'] }],
    [
      'too many aliases',
      {
        voter: VOTER,
        aliases: Array.from(
          { length: LIMITS.summaries + 1 },
          (_, i) => `Ab3dEf7h${'ABCDEFGHJKLMNPQRSTUVWXYZ'[i % 24]}${'abcdef'[Math.floor(i / 24)]}`,
        ),
      },
    ],
  ])('rejects %s', (_, body) => {
    expect(parseSummaryRequest(body)).toEqual({ ok: false, error: 'bad_request' });
  });
});
