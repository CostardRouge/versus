import { describe, expect, it } from 'vitest';
import { mkItem, mkRank } from '../src/core/model';
import type { RankingView } from '../src/core/protocol';
import { compute, pushDuel } from '../src/core/scoring';
import {
  CARD_MAX_BYTES,
  CARD_SIZES,
  type CardSpec,
  type CardTexts,
  cardItems,
  cardKey,
  cardPath,
  cardUpload,
  compareSpec,
  crowdSpec,
  duelQuery,
  duelSpec,
  duoSpec,
  isCardImage,
  localSpec,
  parseCardPath,
  parseDuelQuery,
  pngSize,
  previewRanked,
  previewSpec,
  publishedSpec,
  rankingSpec,
} from '../src/core/share';
import type { Item } from '../src/core/types';
import { UNFURL, unfurlEn, unfurlFr, unfurlPlural, unfurlText } from '../src/i18n/unfurl';

const ALIAS = 'Ab3dEf7hJk';
const TEXTS: CardTexts = {
  brand: 'Versus',
  crowd: 'The crowd',
  me: 'Me',
  agree: 'in agreement with the crowd',
  question: 'Which one do you prefer?',
  vote: 'Vote at',
  made: 'Made with Versus',
};

import { fakePng } from './helpers/png';

const items = (labels: string[]): Item[] => labels.map((l, i) => ({ ...mkItem(l), id: `i${i}` }));

describe('duel links', () => {
  it('writes and reads the duel a link asks for', () => {
    expect(duelQuery('p0', 'p1')).toBe('?duel=p0.p1');
    expect(parseDuelQuery('?duel=p0.p1')).toEqual(['p0', 'p1']);
    expect(parseDuelQuery('duel=a_b-C.x9&other=1')).toEqual(['a_b-C', 'x9']);
  });

  it.each(['', '?duel=', '?duel=p0', '?duel=p0.p0', '?duel=p0.p1.p2', '?duel=p 0.p1', '?x=p0.p1'])(
    'names nothing for %j',
    (search) => {
      expect(parseDuelQuery(search)).toBeNull();
    },
  );
});

describe('card keys and addresses', () => {
  it('keys a board card and a duel card, the pair in one order whichever way it comes', () => {
    expect(cardKey(ALIAS)).toBe(`og/${ALIAS}.png`);
    expect(cardKey(ALIAS, ['p1', 'p0'])).toBe(`og/${ALIAS}/p0.p1.png`);
    expect(cardKey(ALIAS, ['p0', 'p1'])).toBe(cardKey(ALIAS, ['p1', 'p0']));
  });

  it('gives a card an address with its version, and reads it back', () => {
    expect(cardPath(ALIAS, null, 1700000000000)).toBe(`og/b/${ALIAS}/1700000000000.png`);
    expect(cardPath(ALIAS, ['p1', 'p0'], 5)).toBe(`og/b/${ALIAS}/p0.p1/5.png`);
    expect(parseCardPath(['og', 'b', ALIAS, '5.png'])).toEqual({ alias: ALIAS, pair: null });
    expect(parseCardPath(['og', 'b', ALIAS, 'p0.p1', '5.png'])).toEqual({ alias: ALIAS, pair: ['p0', 'p1'] });
  });

  it.each([
    ['og', 'b'],
    ['og', 'b', ALIAS],
    ['og', 'b', ALIAS, 'card.png'],
    ['og', 'b', ALIAS, 'p0.p1', 'x.png'],
    ['og', 'b', ALIAS, 'p0.p0', '5.png'],
    ['og', 'b', ALIAS, 'p0', '5.png'],
    ['og', 'b', ALIAS, 'p0.p1', '5.png', 'more'],
    ['og', 'x', ALIAS, '5.png'],
    ['og', 'b', 'not-an-alias', '5.png'],
    ['og', 'b', '0OIl0OIl0O', '5.png'],
  ])('reads no card from %j', (...parts) => {
    expect(parseCardPath(parts)).toBeNull();
  });
});

describe('what the server accepts', () => {
  it('reads a PNG size and refuses anything else', () => {
    expect(pngSize(fakePng(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    const notPng = fakePng(1200, 630);
    notPng[0] = 0;
    expect(pngSize(notPng)).toBeNull();
    const noIhdr = fakePng(1200, 630);
    noIhdr.set([0x49, 0x44, 0x41, 0x54], 12);
    expect(pngSize(noIhdr)).toBeNull();
  });

  it('accepts the landscape card only, within the size limit', () => {
    const { width, height } = CARD_SIZES.landscape;
    expect(isCardImage(fakePng(width, height))).toBe(true);
    expect(isCardImage(fakePng(width, height, 100_000))).toBe(true);
    expect(isCardImage(fakePng(1080, 1350))).toBe(false);
    expect(isCardImage(fakePng(width, height, CARD_MAX_BYTES + 1))).toBe(false);
    expect(isCardImage(new Uint8Array(40))).toBe(false);
  });
});

describe('card specs', () => {
  const view = { title: 'Pizzas', items: items(['Margherita', 'Regina', 'Calzone']) };
  const crowd: RankingView = {
    method: 'bt',
    order: ['i2', 'i0', 'i1'],
    stats: {
      i2: { score: 1650, se: 30, w: 3, l: 0, d: 0 },
      i0: { score: 1500, se: 30, w: 1, l: 1, d: 0 },
      i1: { score: 1350, se: 30, w: 0, l: 3, d: 0 },
    },
  };

  it('describes a local ranking from its duels, or its items when there are none', () => {
    const r = mkRank('Pizzas');
    r.items = view.items;
    const meta = (m: string, s: { score: number }) => `${m}:${Math.round(s.score)}`;
    const empty = localSpec(r, 'sub', 'https://x.example/', TEXTS, meta);
    expect(empty).toMatchObject({ kind: 'ranking', title: 'Pizzas', subtitle: 'sub', ranked: false, local: true });
    expect(empty.rows.map((x) => x.it.id)).toEqual(['i0', 'i1', 'i2']);
    pushDuel(r, 'i2', 'i0', 1);
    pushDuel(r, 'i2', 'i1', 1);
    const played = localSpec(r, '', '', TEXTS, meta);
    expect(played.ranked).toBe(true);
    expect(played.rows[0]?.it.id).toBe('i2');
    expect(played.rows[0]?.meta).toMatch(/^bt:\d+$/);
    // A voter's own result on a board sends people to vote there.
    expect(rankingSpec('Pizzas', compute(r), '', 'https://x.example/app/b/1', TEXTS, meta, false).local).toBe(false);
  });

  it('describes a board just published from a local ranking, its standings only when its votes went with it', () => {
    const r = mkRank('Pizzas');
    r.items = view.items;
    pushDuel(r, 'i2', 'i0', 1);
    pushDuel(r, 'i2', 'i1', 1);
    const meta = () => '1600';
    const voted = publishedSpec(r, true, '2 votes', 'https://x.example/app/b/1', TEXTS, meta);
    expect(voted).toMatchObject({ kind: 'crowd', title: 'Pizzas', subtitle: '2 votes', ranked: true, local: false });
    expect(voted.rows.map((x) => [x.it.id, x.meta])[0]).toEqual(['i2', '1600']);
    const items = publishedSpec(r, false, '0 votes', '', TEXTS, meta);
    expect(items.ranked).toBe(false);
    expect(items.rows.map((x) => [x.it.id, x.meta])).toEqual([
      ['i0', ''],
      ['i1', ''],
      ['i2', ''],
    ]);
    // Votes that went with it, but no duel to rank them: the items, unranked.
    expect(publishedSpec(mkRank('Empty'), true, '', '', TEXTS, meta).ranked).toBe(false);
  });

  it('describes the crowd as the sharer sees it: standings, or the items when hidden', () => {
    const meta = (_m: string, x: { score: number }) => String(Math.round(x.score));
    const shown = crowdSpec(view, crowd, '3 votes', 'https://x.example/b/1', TEXTS, meta);
    expect(shown.kind).toBe('crowd');
    expect(shown.ranked).toBe(true);
    expect(shown.local).toBe(false);
    expect(shown.rows.map((x) => [x.it.label, x.meta])).toEqual([
      ['Calzone', '1650'],
      ['Margherita', '1500'],
      ['Regina', '1350'],
    ]);
    const hidden = crowdSpec(view, null, 'hidden', '', TEXTS, meta);
    expect(hidden.ranked).toBe(false);
    expect(hidden.rows.map((x) => x.it.label)).toEqual(['Margherita', 'Regina', 'Calzone']);
    // An item the crowd order names but the board lost is left out.
    const stale = crowdSpec(view, { ...crowd, order: [...crowd.order, 'gone'] }, '', '', TEXTS, meta);
    expect(stale.rows).toHaveLength(3);
  });

  it('puts the sharer against the crowd, with the agreement when it can be measured', () => {
    const mine = [
      { a: 'i0', b: 'i2', s: 1 as const },
      { a: 'i0', b: 'i1', s: 1 as const },
      { a: 'i2', b: 'i1', s: 1 as const },
    ];
    const duo = duoSpec(view, crowd, mine, 'bt', '3 votes', '', TEXTS);
    expect(duo.kind).toBe('duo');
    expect(duo.rows.map((x) => x.it.id)).toEqual(['i2', 'i0', 'i1']);
    expect(duo.mine.map((x) => x.it.id)).toEqual(['i0', 'i2', 'i1']);
    expect(duo.agree).toBe(67);
    expect(duo.local).toBe(false);
    expect(cardItems(duo).map((it) => it.id)).toEqual(['i2', 'i0', 'i1', 'i0', 'i2', 'i1']);
    expect(duoSpec(view, crowd, mine.slice(0, 1), 'bt', '', '', TEXTS).agree).toBeNull();
  });

  it('sets a ranking against itself by another method', () => {
    const r = mkRank('Pizzas');
    r.items = view.items;
    const unplayed = compareSpec(r, 'win', ['Balanced', 'Simple'], '', '', TEXTS);
    expect(unplayed.ranked).toBe(false);
    pushDuel(r, 'i2', 'i0', 1);
    pushDuel(r, 'i2', 'i1', 1);
    pushDuel(r, 'i1', 'i0', 1);
    const spec = compareSpec(r, 'win', ['Balanced', 'Simple'], '3 duels', 'https://x.example/', TEXTS);
    expect(spec).toMatchObject({ kind: 'compare', title: 'Pizzas', ranked: true, local: true });
    expect(spec.columns).toEqual(['Balanced', 'Simple']);
    expect(spec.mine.map((x) => x.it.id)).toEqual(compute(r).order.map((i) => i.id));
    expect(spec.rows.map((x) => x.it.id)).toEqual(compute({ ...r, method: 'win' }).order.map((i) => i.id));
  });

  it('describes a duel', () => {
    const [a, b] = view.items as [Item, Item, Item];
    const spec = duelSpec('Pizzas', a, b, 'https://x.example/b/1?duel=i0.i1', TEXTS);
    expect(spec).toMatchObject({ kind: 'duel', title: 'Pizzas', subtitle: '', local: false });
    expect(spec.pair.map((i) => i.label)).toEqual(['Margherita', 'Regina']);
    expect(cardItems(spec)).toEqual([a, b]);
    // @ts-expect-error A duel's card can't go without its two items.
    const noPair: CardSpec = { kind: 'duel', title: '', subtitle: '', url: '', local: false, texts: TEXTS };
    expect(noPair.kind).toBe('duel');
  });
});

describe('link preview cards', () => {
  it('show a ranking only when anyone may see it', () => {
    expect(previewRanked({ visibility: 'always' }, 'open')).toBe(true);
    expect(previewRanked({ visibility: 'after' }, 'open')).toBe(false);
    expect(previewRanked({ visibility: 'blind' }, 'open')).toBe(false);
    for (const visibility of ['always', 'after', 'blind'] as const) {
      expect(previewRanked({ visibility }, 'closed')).toBe(true);
    }
  });

  it('draw the items in board order, unranked, while the ranking is hidden', () => {
    const list = items(['Margherita', 'Regina', 'Calzone']);
    const crowd: RankingView = {
      method: 'bt',
      order: ['i2', 'i0', 'i1'],
      stats: Object.fromEntries(list.map((it, i) => [it.id, { score: 1600 - i * 100, se: 20, w: 1, l: 1, d: 0 }])),
    };
    const spec = crowdSpec({ title: 'Pizzas', items: list }, crowd, '3 votes', '', TEXTS, () => '1600');
    expect(previewSpec(spec, list, { visibility: 'always' }, 'open')).toBe(spec);
    const blind = previewSpec(spec, list, { visibility: 'blind' }, 'open');
    expect(blind.ranked).toBe(false);
    expect(blind.rows.map((r) => [r.it.label, r.meta])).toEqual([
      ['Margherita', ''],
      ['Regina', ''],
      ['Calzone', ''],
    ]);
    expect(blind).toMatchObject({ kind: 'crowd', title: 'Pizzas', subtitle: '3 votes', local: false });
    expect(previewSpec(spec, list, { visibility: 'after' }, 'closed')).toBe(spec);
  });

  it('come from the author for the board, from anyone the first time for a duel', () => {
    // The board's own card: its author only.
    expect(cardUpload('owner', false, false, true)).toBe('ok');
    expect(cardUpload('visitor', false, false, false)).toBe('forbidden');
    // A duel's card: the first one drawn is kept; its author may draw it again.
    expect(cardUpload('visitor', false, true, false)).toBe('ok');
    expect(cardUpload('visitor', false, true, true)).toBe('exists');
    expect(cardUpload('owner', false, true, true)).toBe('ok');
    // The site's own boards take none from visitors.
    expect(cardUpload('visitor', true, true, false)).toBe('forbidden');
    expect(cardUpload('visitor', true, false, false)).toBe('forbidden');
  });
});

describe('link preview texts', () => {
  it('French covers exactly the English keys, with the same placeholders', () => {
    expect(Object.keys(unfurlFr).sort()).toEqual(Object.keys(unfurlEn).sort());
    const holes = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(unfurlEn) as (keyof typeof unfurlEn)[]) {
      const en = unfurlEn[key];
      const fr = unfurlFr[key];
      if (typeof en === 'string' && typeof fr === 'string') expect(holes(fr), key).toEqual(holes(en));
      else expect(fr, key).toHaveLength(en.length);
    }
    expect(Object.keys(UNFURL)).toEqual(['en', 'fr']);
  });

  it('fills a text and counts in each language', () => {
    expect(unfurlText('en', 'duelTitle', { a: 'Kyoto', b: 'Lisbon', title: 'Trips' })).toBe('Kyoto vs Lisbon · Trips');
    expect(unfurlText('fr', 'boardTitle', { title: 'Voyages' })).toBe('Voyages · Versus');
    expect(unfurlPlural('en', 1, 'vote')).toBe('1 vote');
    expect(unfurlPlural('en', 0, 'voter')).toBe('0 voters');
    expect(unfurlPlural('fr', 0, 'item')).toBe('0 élément');
    expect(unfurlPlural('fr', 2, 'item')).toBe('2 éléments');
  });
});
