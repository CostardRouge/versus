import type { Unfurl } from '../../src/core/protocol';
import { CARD_LIMIT, cardKey, cardPath, isCardImage, parseCardPath, parseDuelQuery } from '../../src/core/share';
import { type UnfurlLang, unfurlPlural, unfurlText } from '../../src/i18n/unfurl';
import { deletePrefix } from './pictures';

/**
 * The cards a board's links unfurl with (docs/seo.md): drawn by the app that shares (src/app/share.ts), stored
 * in R2 under `og/<alias>.png` for the board and `og/<alias>/<a>.<b>.png` for one of its duels, served under
 * `/og/b/…`, and written into the head of the board's page (`/app/b/<alias>[?duel=a.b]`) so that a link pasted
 * anywhere shows the board, or the two items of the duel, instead of the site's generic card.
 */

/** A card's address on this host, with its version (the upload time) so that a redrawn card gets a new URL. */
export const cardURL = (origin: string, alias: string, pair: readonly [string, string] | null, at: Date): string =>
  `${origin}/${cardPath(alias, pair, at.getTime())}`;

export type Stored = 'ok' | 'bad_request' | 'too_large' | 'full' | 'unknown_item';

/**
 * Stores a card the app drew: a PNG of the landscape format, for a board that exists, and for one of its
 * pairs when a duel is named. A board keeps at most CARD_LIMIT duel cards.
 */
export async function storeCard(
  bucket: R2Bucket,
  alias: string,
  unfurl: Unfurl,
  pair: readonly [string, string] | null,
  bytes: Uint8Array,
): Promise<Stored> {
  if (!isCardImage(bytes)) return 'bad_request';
  if (pair) {
    const has = (id: string) => unfurl.items.some((i) => i.id === id);
    if (!has(pair[0]) || !has(pair[1])) return 'unknown_item';
    const key = cardKey(alias, pair);
    const kept = await bucket.list({ prefix: `og/${alias}/`, limit: CARD_LIMIT });
    if (kept.objects.length >= CARD_LIMIT && !kept.objects.some((o) => o.key === key)) return 'full';
  }
  await bucket.put(cardKey(alias, pair), bytes, { httpMetadata: { contentType: 'image/png' } });
  return 'ok';
}

/** Deletes every card of a board (when the board goes). */
export const deleteCards = (bucket: R2Bucket, alias: string): Promise<void> => deletePrefix(bucket, `og/${alias}`);

/** The stored card a `/og/b/…` address names, or null (the caller then serves the site's card). */
export async function readCard(bucket: R2Bucket | undefined, parts: readonly string[]): Promise<Response | null> {
  const named = parseCardPath(parts);
  if (!named || !bucket) return null;
  const object = await bucket.get(cardKey(named.alias, named.pair));
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/png',
      // The address carries the version: a redrawn card has a new one, so this copy can be kept a while.
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** What the board page's head should say, for the link as it was pasted (with or without a duel). */
export interface Preview {
  lang: UnfurlLang;
  title: string;
  description: string;
  /** The card's address and its alt text, when the app drew one. */
  image: { url: string; alt: string } | null;
}

export async function preview(
  bucket: R2Bucket | undefined,
  origin: string,
  alias: string,
  unfurl: Unfurl,
  search: string,
): Promise<Preview> {
  const lang = unfurl.lang;
  const wanted = parseDuelQuery(search);
  const a = wanted ? unfurl.items.find((i) => i.id === wanted[0]) : undefined;
  const b = wanted ? unfurl.items.find((i) => i.id === wanted[1]) : undefined;
  const duel = a && b ? ([a, b] as const) : null;
  const pair = duel ? ([duel[0].id, duel[1].id] as const) : null;
  const vars = {
    title: unfurl.title,
    a: duel?.[0].label ?? '',
    b: duel?.[1].label ?? '',
    items: unfurlPlural(lang, unfurl.items.length, 'item'),
    votes: unfurlPlural(lang, unfurl.counts.votes, 'vote'),
    voters: unfurlPlural(lang, unfurl.counts.voters, 'voter'),
  };
  const stored = bucket ? await bucket.head(cardKey(alias, pair)) : null;
  return {
    lang,
    title: unfurlText(lang, duel ? 'duelTitle' : 'boardTitle', vars),
    description: unfurlText(lang, duel ? 'duelDesc' : unfurl.status === 'closed' ? 'closedDesc' : 'boardDesc', vars),
    image: stored
      ? {
          url: cardURL(origin, alias, pair, stored.uploaded),
          alt: unfurlText(lang, duel ? 'duelImageAlt' : 'imageAlt', vars),
        }
      : null,
  };
}

/**
 * A value for HTMLRewriter's `setAttribute`, which escapes quotes and nothing else: an `&` goes in as `&amp;`, or a
 * title holding `&quot;` would read back as a quote.
 */
export const attrValue = (s: string): string => s.replace(/&/g, '&amp;');

/** Writes a preview into the app page's head: title, description, Open Graph and X tags, the page's language. */
export function rewriteHead(page: Response, p: Preview, pageURL: string): Response {
  const set = (attr: string, value: string) => ({
    element(el: Element) {
      el.setAttribute(attr, attrValue(value));
    },
  });
  const rewriter = new HTMLRewriter()
    .on('html', set('lang', p.lang))
    .on('title', {
      element(el) {
        el.setInnerContent(p.title);
      },
    })
    .on('meta[name="description"]', set('content', p.description))
    .on('meta[property="og:title"]', set('content', p.title))
    .on('meta[name="twitter:title"]', set('content', p.title))
    .on('meta[property="og:description"]', set('content', p.description))
    .on('meta[name="twitter:description"]', set('content', p.description))
    .on('meta[property="og:url"]', set('content', pageURL));
  if (p.image) {
    rewriter
      .on('meta[property="og:image"]', set('content', p.image.url))
      .on('meta[name="twitter:image"]', set('content', p.image.url))
      .on('meta[property="og:image:alt"]', set('content', p.image.alt))
      .on('meta[name="twitter:image:alt"]', set('content', p.image.alt))
      .on('meta[property="og:image:width"]', set('content', '1200'))
      .on('meta[property="og:image:height"]', set('content', '630'))
      .on('meta[property="og:image:type"]', set('content', 'image/png'));
  }
  return rewriter.transform(page);
}
