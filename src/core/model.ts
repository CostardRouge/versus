import type { Fill, Item, MethodKey, Ranking } from './types.ts';
import { hueOf, uid } from './util.ts';

export function mkItem(label: string, img: string | null = null, fill: Fill | null = null): Item {
  return { id: uid(), label, img, fill, h: hueOf(label) };
}

export function mkRank(title: string, method: MethodKey = 'bt'): Ranking {
  const now = Date.now();
  return { id: uid(), title, method, items: [], history: [], pair: null, created: now, updated: now };
}

export const getItem = (r: Ranking, id: string): Item | undefined => r.items.find((i) => i.id === id);

/** The two forms of picture the app writes: an image kept as a data URL, or a published board's approved picture. */
const IMAGE_RE =
  /^(?:data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*|\/img\/b\/[1-9A-HJ-NP-Za-km-z]{10}\/[\w-]+\.jpg)$/;

/**
 * The address an item's picture is drawn from, or null. Every view goes through it: what storage, a file or a server
 * hands back can only ever be one of the forms the app writes, never markup, a script or another site.
 */
export const imageSrc = (it: Pick<Item, 'img'>): string | null =>
  typeof it.img === 'string' && IMAGE_RE.test(it.img) ? it.img : null;

/** An item's hue for the `--h` style variable: a number, whatever storage holds. */
export const hueValue = (it: Pick<Item, 'h'>): number => (Number.isFinite(it.h) ? it.h : 0);
