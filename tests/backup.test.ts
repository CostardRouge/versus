import { describe, expect, it } from 'vitest';
import {
  type Backup,
  backupName,
  hasBackup,
  type Local,
  makeBackup,
  makeShare,
  mergeBackup,
  parseBackup,
  shareName,
} from '../src/core/backup';
import { DEFAULT_SETTINGS } from '../src/core/board';
import { DEMOS } from '../src/core/demos';
import type { Item, Joined, Ranking } from '../src/core/types';
import { fileSlug } from '../src/core/util';

const NOW = Date.UTC(2026, 8, 30, 12);
const ALIAS = 'Ab3dEf7hJk';
const TOKEN = 'a'.repeat(64);
const VOTER = 'voter-1234';
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

const item = (id: string, label = id, over: Partial<Item> = {}): Item => ({
  id,
  label,
  img: null,
  fill: null,
  h: 10,
  ...over,
});
const rank = (id: string, over: Partial<Ranking> = {}): Ranking => ({
  id,
  title: `Ranking ${id}`,
  method: 'bt',
  items: [item('a', 'Tea'), item('b', 'Coffee'), item('c', '', { fill: { type: 'solid', colors: ['#2743f5'] } })],
  history: [
    { a: 'a', b: 'b', s: 1 },
    { a: 'b', b: 'c', s: 0.5 },
  ],
  pair: ['a', 'c'],
  created: 1,
  updated: 2,
  ...over,
});
const card = (alias: string, over: Partial<Joined> = {}): Joined => ({
  alias,
  title: 'Pizzas',
  items: [item('p0', 'Margherita'), item('p1', 'Regina')],
  settings: { ...DEFAULT_SETTINGS },
  status: 'open',
  votes: 3,
  voters: 2,
  order: ['p0', 'p1'],
  mine: [{ a: 'p0', b: 'p1', s: 1 }],
  count: 1,
  joined: 1,
  voted: 1,
  seen: { at: 1, status: 'open', items: ['p0', 'p1'], visible: true },
  ...over,
});
const local = (over: Partial<Local> = {}): Local => ({
  ranks: [],
  owners: {},
  joined: [],
  voter: 'local-voter',
  ...over,
});
const file = (over: Partial<Backup> = {}): Backup => ({
  format: 'versus',
  version: 1,
  exported: NOW,
  rankings: [],
  owners: {},
  joined: [],
  voter: null,
  ...over,
});
const read = (x: unknown): Backup => {
  const res = parseBackup(JSON.stringify(x), NOW);
  if (!res.ok) throw new Error(res.error);
  return res.value;
};
let n = 0;
const opts = { newId: () => `new${++n}`, copyTitle: (t: string) => `${t} (copy)` };

describe('makeBackup and makeShare', () => {
  it('backs up everything but the demos', () => {
    const demo = rank('demo-x', { demo: true });
    const pub = rank('p', { pub: { alias: ALIAS, status: 'open' } });
    const b = makeBackup(
      local({ ranks: [demo, rank('r1'), pub], owners: { [ALIAS]: TOKEN }, joined: [card(ALIAS)], voter: VOTER }),
      NOW,
    );
    expect(b.rankings.map((r) => r.id)).toEqual(['r1', 'p']);
    expect(b.owners).toEqual({ [ALIAS]: TOKEN });
    expect(b.joined).toHaveLength(1);
    expect(b.voter).toBe(VOTER);
    expect(read(b)).toEqual(b);
  });

  it('shares one ranking without its board, its demo flag or its current pair', () => {
    const s = makeShare(rank('r1', { demo: true, pub: { alias: ALIAS } }), NOW);
    expect(s.rankings).toHaveLength(1);
    const [r] = s.rankings;
    expect(r?.pub).toBeUndefined();
    expect(r?.demo).toBeUndefined();
    expect(r?.pair).toBeNull();
    expect(r?.history).toHaveLength(2);
    expect(s.owners).toEqual({});
    expect(s.joined).toEqual([]);
    expect(s.voter).toBeNull();
  });

  it('knows when there is nothing to back up', () => {
    expect(hasBackup(local({ ranks: [rank('d', { demo: true })] }))).toBe(false);
    expect(hasBackup(local({ ranks: [rank('r')] }))).toBe(true);
    expect(hasBackup(local({ joined: [card(ALIAS)] }))).toBe(true);
    expect(hasBackup(local({ owners: { [ALIAS]: TOKEN } }))).toBe(true);
  });

  it('names the files', () => {
    expect(backupName(new Date(2026, 0, 5, 23, 59).getTime())).toBe('versus-2026-01-05.json');
    expect(shareName('Prochaine destination !')).toBe('versus-prochaine-destination.json');
    expect(shareName('Crème brûlée & café')).toBe('versus-creme-brulee-cafe.json');
    expect(shareName('🍕')).toBe('versus-ranking.json');
    expect(shareName('x'.repeat(80))).toBe(`versus-${'x'.repeat(40)}.json`);
  });

  it('cuts a title to a file name the same way for a file and a shared image', () => {
    expect(fileSlug('Crème brûlée & café')).toBe('creme-brulee-cafe');
    // Never a dash at either end, even where the cut falls on a space.
    expect(fileSlug(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
    expect(fileSlug(`¿${'b'.repeat(50)}`)).toBe('b'.repeat(40));
    expect(fileSlug('寿司 ?!')).toBe('');
  });
});

describe('parseBackup', () => {
  it('refuses what is not a Versus file', () => {
    for (const text of ['', 'not json', '[]', '{}', '{"format":"other","version":1}', '{"format":"versus"}']) {
      expect(parseBackup(text, NOW)).toEqual({ ok: false, error: 'not-versus' });
    }
    expect(parseBackup(JSON.stringify({ format: 'versus', version: 0 }), NOW)).toEqual({
      ok: false,
      error: 'not-versus',
    });
  });

  it('refuses a file from a newer version, and an empty one', () => {
    expect(parseBackup(JSON.stringify(file({ version: 2 as 1 })), NOW)).toEqual({ ok: false, error: 'newer' });
    expect(parseBackup(JSON.stringify(file()), NOW)).toEqual({ ok: false, error: 'empty' });
    expect(parseBackup(JSON.stringify(file({ rankings: [{ id: '!' } as unknown as Ranking] })), NOW)).toEqual({
      ok: false,
      error: 'empty',
    });
  });

  it('keeps only image data URLs, valid colors and items with content', () => {
    const r = read(
      file({
        rankings: [
          rank('r1', {
            items: [
              item('a', 'Photo', { img: IMG }),
              item('b', 'Script', { img: 'javascript:alert(1)' }),
              item('c', 'Quote', { img: "data:image/png;base64,AAAA') url('x" }),
              item('d', '', { fill: { type: 'solid', colors: ['red;background:url(x)'] } }),
              item('e', '', { fill: { type: 'gradient', colors: ['#000000', '#ffffff'] } }),
              item('f', ''),
              item('a', 'Twice'),
            ],
            history: [],
            pair: null,
          }),
        ],
      }),
    ).rankings[0];
    expect(r?.items.map((i) => [i.id, i.label, i.img])).toEqual([
      ['a', 'Photo', IMG],
      ['b', 'Script', null],
      ['c', 'Quote', null],
      ['e', '', null],
    ]);
  });

  it('drops duels and the pair on unknown items, and cleans the rest', () => {
    const raw = {
      ...rank('r1'),
      title: `  ${'T'.repeat(100)}  `,
      method: 'magic',
      history: [
        { a: 'a', b: 'b', s: 1 },
        { a: 'a', b: 'zz', s: 1 },
        { a: 'a', b: 'a', s: 1 },
        { a: 'a', b: 'b', s: 2 },
        { a: 'b', b: 'a', s: 0, extra: 'x' },
      ],
      pair: ['a', 'zz'],
      created: 'yesterday',
      demo: true,
      pub: { alias: 'nope', status: 'open' },
      items: [{ id: 'a', label: 'Tea', h: 725 }, item('b', 'Coffee')],
    };
    const r = read(file({ rankings: [raw as unknown as Ranking] })).rankings[0];
    expect(r?.title).toBe('T'.repeat(80));
    expect(r?.method).toBe('bt');
    expect(r?.history).toEqual([
      { a: 'a', b: 'b', s: 1 },
      { a: 'b', b: 'a', s: 0 },
    ]);
    expect(r?.pair).toBeNull();
    expect(r?.created).toBe(NOW);
    expect(r?.demo).toBeUndefined();
    expect(r?.pub).toBeUndefined();
    expect(r?.items[0]).toEqual({ id: 'a', label: 'Tea', img: null, fill: null, h: 5 });
  });

  it('keeps a valid board link, owner tokens and voter id', () => {
    const b = read(
      file({
        rankings: [rank('r1', { pub: { alias: ALIAS, status: 'closed' } })],
        owners: { [ALIAS]: TOKEN, bad: TOKEN, Zz3dEf7hJk: 'short', __proto__: TOKEN } as Record<string, string>,
        voter: VOTER,
      }),
    );
    expect(b.rankings[0]?.pub).toEqual({ alias: ALIAS, status: 'closed' });
    expect(b.owners).toEqual({ [ALIAS]: TOKEN });
    expect(b.voter).toBe(VOTER);
    expect(read(file({ rankings: [rank('r1')], voter: 'x' })).voter).toBeNull();
  });

  it('keeps clean "Your votes" cards and drops edited ones', () => {
    const b = read(
      file({
        joined: [
          card(ALIAS, { settings: { ...DEFAULT_SETTINGS, revealAfter: '<b>' as unknown as number } }),
          card('Zz3dEf7hJk', { items: [item('p0', 'Margherita', { img: IMG }), item('p1')] }),
          card('Yy3dEf7hJk', { items: [item('p0', 'Margherita', { fill: { type: 'solid', colors: ['x'] } })] }),
        ],
      }),
    );
    expect(b.joined.map((j) => j.alias)).toEqual([ALIAS]);
    expect(b.joined[0]?.settings.revealAfter).toBe(DEFAULT_SETTINGS.revealAfter);
  });

  it("keeps a card whose board shows an approved picture, from that board's own address only", () => {
    const picture = `/img/b/${ALIAS}/p0.jpg`;
    const b = read(
      file({
        joined: [
          card(ALIAS, { items: [item('p0', 'Margherita', { img: picture }), item('p1')] }),
          card('Zz3dEf7hJk', { items: [item('p0', 'Margherita', { img: picture }), item('p1')] }),
          card('Yy3dEf7hJk', { items: [item('p0', 'Margherita', { img: '/img/b/Yy3dEf7hJk/p1.jpg' }), item('p1')] }),
        ],
      }),
    );
    expect(b.joined.map((j) => j.alias)).toEqual([ALIAS]);
    expect(b.joined[0]?.items[0]?.img).toBe(picture);
  });

  it('keeps the first of two rankings with the same id', () => {
    const b = read(file({ rankings: [rank('r1', { title: 'First' }), rank('r1', { title: 'Second' })] }));
    expect(b.rankings.map((r) => r.title)).toEqual(['First']);
  });
});

describe('mergeBackup', () => {
  it('adds new rankings with their id, and skips identical ones', () => {
    const here = rank('r1', { updated: 99, pair: null });
    const m = mergeBackup(local({ ranks: [here] }), file({ rankings: [rank('r1'), rank('r2')] }), opts);
    expect(m.local.ranks.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(m.local.ranks[0]).toBe(here);
    expect(m).toMatchObject({ added: 1, same: 1, votes: 0 });
  });

  it('never replaces a ranking: a different version comes in as a copy', () => {
    const here = rank('r1');
    const there = rank('r1', { history: [...here.history, { a: 'a', b: 'c', s: 1 }] });
    const m = mergeBackup(local({ ranks: [here] }), file({ rankings: [there] }), opts);
    expect(m.local.ranks).toHaveLength(2);
    expect(m.local.ranks[0]).toBe(here);
    expect(m.local.ranks[1]?.id).toMatch(/^new\d+$/);
    expect(m.local.ranks[1]?.title).toBe('Ranking r1 (copy)');
    expect(m.local.ranks[1]?.history).toHaveLength(3);
    expect(m.added).toBe(1);
  });

  it('gives a new id to a ranking that takes a demo id', () => {
    const demoId = DEMOS[0]?.id ?? '';
    const m = mergeBackup(local(), file({ rankings: [rank(demoId)] }), opts);
    expect(m.local.ranks[0]?.id).not.toBe(demoId);
  });

  it('keeps one local ranking per published board', () => {
    const here = rank('r1', { pub: { alias: ALIAS } });
    const there = rank('r2', { pub: { alias: ALIAS } });
    const m = mergeBackup(local({ ranks: [here] }), file({ rankings: [there] }), opts);
    expect(m.local.ranks[1]?.pub).toBeUndefined();
    const alone = mergeBackup(local(), file({ rankings: [there] }), opts);
    expect(alone.local.ranks[0]?.pub).toEqual({ alias: ALIAS });
  });

  it('adds missing owner tokens and cards, keeping the local ones', () => {
    const other = 'Zz3dEf7hJk';
    const m = mergeBackup(
      local({ owners: { [ALIAS]: 'b'.repeat(64) }, joined: [card(ALIAS, { title: 'Here' })] }),
      file({ owners: { [ALIAS]: TOKEN, [other]: TOKEN }, joined: [card(ALIAS), card(other)] }),
      opts,
    );
    expect(m.local.owners).toEqual({ [ALIAS]: 'b'.repeat(64), [other]: TOKEN });
    expect(m.local.joined.map((j) => [j.alias, j.title])).toEqual([
      [ALIAS, 'Here'],
      [other, 'Pizzas'],
    ]);
    expect(m.votes).toBe(1);
  });

  it('takes the voter id only in a browser that has neither voted nor published', () => {
    const f = file({ joined: [card(ALIAS)], voter: VOTER });
    expect(mergeBackup(local(), f, opts).local.voter).toBe(VOTER);
    expect(mergeBackup(local({ joined: [card('Zz3dEf7hJk')] }), f, opts).local.voter).toBe('local-voter');
    const published = rank('r1', { pub: { alias: 'Zz3dEf7hJk' } });
    expect(mergeBackup(local({ ranks: [published] }), f, opts).local.voter).toBe('local-voter');
    expect(mergeBackup(local(), file({ joined: [card(ALIAS)] }), opts).local.voter).toBe('local-voter');
    // A file of rankings alone (a shared one, or one made up) never sets it.
    expect(mergeBackup(local(), file({ rankings: [rank('r9')], voter: VOTER }), opts).local.voter).toBe('local-voter');
    expect(mergeBackup(local(), file({ owners: { [ALIAS]: TOKEN }, voter: VOTER }), opts).local.voter).toBe(VOTER);
  });
});
