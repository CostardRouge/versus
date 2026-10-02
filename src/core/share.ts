import { LIMITS } from './board.ts';
import type { BoardView, RankingView } from './protocol.ts';
import { agreement, ownRanking } from './published.ts';
import { compute } from './scoring.ts';
import type { Computed, Duel, Item, ItemStats, MethodKey, Ranking } from './types.ts';

/**
 * Sharing a result as an image (drawn by the app, src/app/share.ts) and the cards that illustrate a board's
 * links when they are unfurled (uploaded by the app, served by the Worker). Pure: what goes on a card, the
 * formats, the addresses and keys, the duel a link asks for.
 */

/** Formats a card can be drawn in: post (4:5, feeds), story (9:16), landscape (1.91:1, the one links unfurl with). */
export type CardFormat = 'post' | 'story' | 'landscape';
export const CARD_FORMATS: readonly CardFormat[] = ['post', 'story', 'landscape'];
export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 630 },
};
/** The format a link's preview shows: what social networks expect for `og:image`. */
export const OG_FORMAT: CardFormat = 'landscape';
/** Largest card the server stores (a PNG of flat colors and text is far below). */
export const CARD_MAX_BYTES = 400_000;
/** Duel cards stored per board: enough for the duels people share, not for someone filling the bucket. */
export const CARD_LIMIT = 40;

/**
 * ranking: a ranking's podium and rows; crowd: a board's; duo: the sharer's order facing the crowd's; compare: one
 * ranking by two methods, facing each other; duel: two items.
 */
export type CardKind = 'ranking' | 'crowd' | 'duo' | 'compare' | 'duel';

export interface CardRow {
  it: Item;
  /** Score or record, as printed on the card (may be empty). */
  meta: string;
}

/** Words printed on a card, in the sharer's language (the app passes `t()`'s results). */
export interface CardTexts {
  brand: string;
  crowd: string;
  me: string;
  /** "in agreement with the crowd". */
  agree: string;
  question: string;
  /** "Vote at", before the link. */
  vote: string;
  /** "Made with Versus". */
  made: string;
}

export interface CardSpec {
  kind: CardKind;
  title: string;
  /** Under the title: items and duels, votes and voters, or why the crowd is hidden. */
  subtitle: string;
  /** The standings, best first (ranking and crowd: the podium and the rest; duo: the crowd's side). */
  rows: CardRow[];
  /** False when `rows` are the items in board order, not a ranking (no duels yet, or a crowd hidden from the sharer). */
  ranked: boolean;
  /** duo: the sharer's own order, compare: the ranking's method's, matched with `rows` by item id (the left column). */
  mine: CardRow[];
  /** duo and compare: the columns' names, left then right (the sharer and the crowd by default). */
  columns?: [string, string];
  /** duo: agreement with the crowd in percent, when there are enough decisive votes. */
  agree: number | null;
  /** duel: the two items facing each other. */
  pair: [Item, Item] | null;
  /** Where the card sends people: a board, or the site for a local ranking. */
  url: string;
  texts: CardTexts;
}

type Meta = (m: MethodKey, s: ItemStats) => string;

const rowsOf = (C: Computed, meta: Meta): CardRow[] =>
  C.order.map((it) => ({ it, meta: C.st[it.id] ? meta(C.m, C.st[it.id] as ItemStats) : '' }));

/** A local ranking, or a voter's own result (`C` from their votes). */
export function rankingSpec(
  title: string,
  C: Computed,
  subtitle: string,
  url: string,
  texts: CardTexts,
  meta: Meta,
): CardSpec {
  return {
    kind: 'ranking',
    title,
    subtitle,
    rows: rowsOf(C, meta),
    ranked: C.n > 0,
    mine: [],
    agree: null,
    pair: null,
    url,
    texts,
  };
}

/** A local ranking as the app scores it. */
export const localSpec = (r: Ranking, subtitle: string, url: string, texts: CardTexts, meta: Meta): CardSpec =>
  rankingSpec(r.title, compute(r), subtitle, url, texts, meta);

/**
 * A board as the sharer sees it: the crowd's standings when they may see them, else the items in board order
 * with no scores (the subtitle says why).
 */
export function crowdSpec(
  view: Pick<BoardView, 'title' | 'items'>,
  ranking: RankingView | null,
  subtitle: string,
  url: string,
  texts: CardTexts,
  meta: (m: MethodKey, score: RankingView['stats'][string]) => string,
): CardSpec {
  const byId = new Map(view.items.map((i) => [i.id, i]));
  const rows: CardRow[] = ranking
    ? ranking.order.flatMap((id) => {
        const it = byId.get(id);
        const x = ranking.stats[id];
        return it ? [{ it, meta: x ? meta(ranking.method, x) : '' }] : [];
      })
    : view.items.map((it) => ({ it, meta: '' }));
  return {
    kind: 'crowd',
    title: view.title,
    subtitle,
    rows,
    ranked: ranking !== null,
    mine: [],
    agree: null,
    pair: null,
    url,
    texts,
  };
}

/** The sharer's ranking facing the crowd's: both orders, and the agreement when it can be measured. */
export function duoSpec(
  view: Pick<BoardView, 'title' | 'items'>,
  crowd: RankingView,
  mine: readonly Duel[],
  method: MethodKey,
  subtitle: string,
  url: string,
  texts: CardTexts,
): CardSpec {
  const byId = new Map(view.items.map((i) => [i.id, i]));
  const rows = crowd.order.flatMap((id) => {
    const it = byId.get(id);
    return it ? [{ it, meta: '' }] : [];
  });
  const own = ownRanking(view.items, mine, method);
  const share = agreement(mine, crowd);
  return {
    kind: 'duo',
    title: view.title,
    subtitle,
    rows,
    ranked: true,
    mine: own.order.map((it) => ({ it, meta: '' })),
    agree: share === null ? null : Math.round(share * 100),
    pair: null,
    url,
    texts,
  };
}

/**
 * A ranking by its method (left) facing the same duels by `other` (right), joined by lines: the Ranking tab's lines
 * view. `names` are the two methods' names.
 */
export function compareSpec(
  r: Ranking,
  other: MethodKey,
  names: [string, string],
  subtitle: string,
  url: string,
  texts: CardTexts,
): CardSpec {
  const own = compute(r);
  const alt = compute({ ...r, method: other });
  return {
    kind: 'compare',
    title: r.title,
    subtitle,
    rows: alt.order.map((it) => ({ it, meta: '' })),
    ranked: own.n > 0,
    mine: own.order.map((it) => ({ it, meta: '' })),
    columns: names,
    agree: null,
    pair: null,
    url,
    texts,
  };
}

/** One duel of a board: the two items, and the link that opens the board on that duel. */
export const duelSpec = (title: string, a: Item, b: Item, url: string, texts: CardTexts): CardSpec => ({
  kind: 'duel',
  title,
  subtitle: '',
  rows: [],
  ranked: false,
  mine: [],
  agree: null,
  pair: [a, b],
  url,
  texts,
});

// ─── Links ──────────────────────────────────────────────────────────────────

/** Query parameter naming the duel a board link opens on. */
export const DUEL_PARAM = 'duel';
const ID_RE = /^[\w-]{1,32}$/;

/** `?duel=<a>.<b>`: item ids are letters, digits, `-` and `_`, so the dot separates them and nothing needs encoding. */
export const duelQuery = (a: string, b: string): string => `?${DUEL_PARAM}=${a}.${b}`;

/** The pair a link's query asks for, or null when it names none. */
export function parseDuelQuery(search: string): [string, string] | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(DUEL_PARAM);
  const [a, b, ...more] = raw?.split('.') ?? [];
  if (!a || !b || more.length || a === b || !ID_RE.test(a) || !ID_RE.test(b)) return null;
  return [a, b];
}

/** A pair as it is named in card keys and addresses: order-independent. */
export const pairSlug = (a: string, b: string): string => (a < b ? `${a}.${b}` : `${b}.${a}`);

/** Where a board's card, or one of its duel cards, is stored (the object store's key). */
export const cardKey = (alias: string, pair: readonly [string, string] | null = null): string =>
  pair ? `og/${alias}/${pairSlug(pair[0], pair[1])}.png` : `og/${alias}.png`;

/**
 * The address a card is served at, relative to the site's root. The version (the upload time) changes the URL
 * each time the card is drawn again: social networks cache a preview image by its URL.
 */
export const cardPath = (alias: string, pair: readonly [string, string] | null, version: number): string =>
  `og/b/${alias}${pair ? `/${pairSlug(pair[0], pair[1])}` : ''}/${version}.png`;

/** Reads a card address back: `og/b/<alias>[/<a>.<b>]/<version>.png`, split on `/`. */
export function parseCardPath(parts: readonly string[]): { alias: string; pair: [string, string] | null } | null {
  const [og, b, alias, ...rest] = parts;
  if (og !== 'og' || b !== 'b' || !alias || rest.length < 1 || rest.length > 2) return null;
  const version = rest[rest.length - 1] ?? '';
  if (!/^\d+\.png$/.test(version)) return null;
  if (rest.length === 1) return { alias, pair: null };
  const [x, y, ...more] = (rest[0] ?? '').split('.');
  if (!x || !y || more.length || x === y || !ID_RE.test(x) || !ID_RE.test(y)) return null;
  return { alias, pair: [x, y] };
}

// ─── What the server accepts ────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height of a PNG from its header, or null when the bytes aren't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
  // Then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4), big-endian.
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** True when the bytes start like a JPEG (the pictures the app sends for review are 640 px JPEGs). */
export const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** True when the bytes are the card a link unfurls with: a PNG of the landscape format, within the size limit. */
export function isCardImage(bytes: Uint8Array): boolean {
  if (bytes.length > CARD_MAX_BYTES) return false;
  const size = pngSize(bytes);
  const wanted = CARD_SIZES[OG_FORMAT];
  return size !== null && size.width === wanted.width && size.height === wanted.height;
}

/** Rows a card shows, by format: the podium and as many of the rest as fit. */
export const CARD_ROWS: Record<CardFormat, number> = { post: 12, story: 20, landscape: 5 };

export { LIMITS };
