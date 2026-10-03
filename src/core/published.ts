import { ALIAS_RE, LIMITS, totalPairs } from './board';
import { mkRank } from './model';
import type { RankingView } from './protocol';
import { compute, methodOf, pairKey, validHistory } from './scoring';
import type { BoardLang, BoardSettings, Computed, Duel, Item, MethodKey, Ranking } from './types';

/**
 * Client-side helpers for published boards: what can be published and how, share links, and how a
 * voter compares with the crowd. The server re-validates everything (see board.ts).
 */

export type PublishBlock = 'images' | 'too_few' | 'too_many';

/** Why a local ranking can't be published yet, or null when it can. */
export function publishBlock(r: Ranking): PublishBlock | null {
  if (r.items.some((i) => i.img)) return 'images';
  if (r.items.length < 2) return 'too_few';
  if (r.items.length > LIMITS.items) return 'too_many';
  return null;
}

/** Exact sort can't serve concurrent voters, so a ranking sorted that way publishes as Balanced. */
export function publishMethod(r: Ranking): MethodKey {
  const m = methodOf(r);
  return m === 'sort' ? 'bt' : m;
}

/** The author's duels as the server counts them: one per pair, the last one, in that order. */
export function lastDuelPerPair(r: Ranking): Duel[] {
  const last = new Map<string, Duel>();
  for (const d of validHistory(r)) {
    const k = pairKey(d.a, d.b);
    last.delete(k);
    last.set(k, { a: d.a, b: d.b, s: d.s });
  }
  return [...last.values()];
}

export interface PublishRequest {
  title: string;
  items: Item[];
  settings: Partial<BoardSettings>;
  voter: string;
  duels: Duel[];
  /** The app's language: the board's link previews speak it. */
  lang: BoardLang;
}

/**
 * What the app sends to publish. Pictures never travel here: with `pictures`, an item that has one announces it
 * (`pic: 'pending'`) and the app sends the picture itself right after, for the moderator's review.
 */
export function publishRequest(
  r: Ranking,
  voter: string,
  settings: Partial<BoardSettings>,
  withVotes: boolean,
  lang: BoardLang = 'en',
  pictures = false,
): PublishRequest {
  return {
    title: r.title.slice(0, LIMITS.title),
    items: r.items.map(({ id, label, fill, h, img }) => ({
      id,
      label: label.slice(0, LIMITS.label),
      img: null,
      fill,
      h,
      ...(pictures && img ? { pic: 'pending' as const } : {}),
    })),
    settings,
    voter,
    duels: withVotes ? lastDuelPerPair(r) : [],
    lang,
  };
}

/** The items whose picture the app has to send after publishing. */
export const pictureItems = (r: Ranking): (Item & { img: string })[] =>
  r.items.filter((i): i is Item & { img: string } => !!i.img);

/** The bytes of a picture kept as a data URL (what the app stores), for the upload. */
export function dataURLBytes(dataURL: string): { type: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]*)$/.exec(dataURL);
  if (!m) return null;
  try {
    const bin = atob(m[2] ?? '');
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type: m[1] ?? '', bytes };
  } catch {
    return null;
  }
}

// ─── Links ──────────────────────────────────────────────────────────────────

/**
 * Links written before the app had paths (D92): the board in the fragment, `?owner=` for its author. Still read
 * (src/app/rankings.ts) and turned into `b/<alias>` addresses; new links come from src/core/route.ts.
 */
export function parseBoardHash(hash: string): { alias: string; owner: string | null } | null {
  const m = /^#\/b\/([^/?]+)(?:\?owner=([0-9a-f]{64}))?$/.exec(hash);
  const alias = m?.[1];
  if (!alias || !ALIAS_RE.test(alias)) return null;
  return { alias, owner: m[2] ?? null };
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Anonymous voter id from random bytes (one per browser). */
export const voterId = (bytes: Uint8Array): string => Array.from(bytes, (b) => ID_CHARS[b & 63]).join('');

export { totalPairs };

// ─── The voter and the crowd ────────────────────────────────────────────────

/**
 * The voter's decisive votes (ties aside) on items the crowd ranks, and those the crowd order
 * contradicts, as [their pick, the other], widest gap in the crowd ranking first.
 */
export function crowdCheck(mine: readonly Duel[], view: RankingView): { total: number; against: [string, string][] } {
  const pos = new Map(view.order.map((id, i) => [id, i]));
  let total = 0;
  const against: { pick: [string, string]; gap: number }[] = [];
  for (const d of mine) {
    const pa = pos.get(d.a);
    const pb = pos.get(d.b);
    if (d.s === 0.5 || pa === undefined || pb === undefined) continue;
    total++;
    const gap = d.s === 1 ? pa - pb : pb - pa;
    if (gap > 0) against.push({ pick: d.s === 1 ? [d.a, d.b] : [d.b, d.a], gap });
  }
  against.sort((x, y) => y.gap - x.gap);
  return { total, against: against.map((x) => x.pick) };
}

/** Share of the voter's decisive votes (ties aside) the crowd order agrees with; null below `min` of them. */
export function agreement(mine: readonly Duel[], view: RankingView, min = 3): number | null {
  const { total, against } = crowdCheck(mine, view);
  return total >= min ? (total - against.length) / total : null;
}

/** A voter's own ranking, from their votes alone, scored with the board's method. */
export const ownRanking = (items: Item[], mine: readonly Duel[], method: MethodKey): Computed =>
  compute({ ...mkRank('', method), items, history: [...mine] });

/**
 * Items too close to the one ranked just above to tell apart: the gap is below the standard error of
 * the difference. Balanced only, the method that gives margins.
 */
export function neckAndNeck(view: RankingView): Set<string> {
  const close = new Set<string>();
  if (view.method !== 'bt') return close;
  for (let i = 1; i < view.order.length; i++) {
    const id = view.order[i] as string;
    const above = view.stats[view.order[i - 1] as string];
    const cur = view.stats[id];
    if (above?.se == null || cur?.se == null) continue;
    if (above.score - cur.score < Math.hypot(above.se, cur.se)) close.add(id);
  }
  return close;
}
