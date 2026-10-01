import type { Ranking } from './types';

/**
 * Images out of localStorage (docs/pwa.md, D118). In memory an item's image is a data URL, as it always was.
 * In localStorage it is either that data URL or a reference, `idb:<key>`, to the same data URL kept in
 * IndexedDB (src/app/images.ts). The key comes from the content, so an image shared by several items (a
 * duplicated ranking) is stored once. An image becomes a reference only once IndexedDB holds it, so
 * localStorage never points to something missing.
 */

export const REF_PREFIX = 'idb:';
const REF_RE = /^idb:[0-9a-z]{1,12}-[0-9a-z]{1,12}$/;

/** What an image may be once in memory: an image data URL (items.ts makes JPEGs; imports may bring others). */
export const IMG_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export const isImageRef = (s: string): boolean => REF_RE.test(s);

/** An image held in the ranking itself: what moves to IndexedDB. A published board's picture is an address, kept as is. */
const isInline = (s: string): boolean => s.startsWith('data:');

/** The image to show: none while it is still a reference (not read yet, or missing). */
export const shownImage = (img: string | null): string | null => (img && !isImageRef(img) ? img : null);

/** cyrb53: a fast 53-bit string hash (public domain). Enough to tell images apart, with the length in the key. */
function hash53(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The key an image is stored under: its hash and its length, in base 36. */
export const imageKey = (data: string): string => `${hash53(data).toString(36)}-${data.length.toString(36)}`;

export type KeyOf = (data: string) => string;

/**
 * Rankings as written to localStorage. Images IndexedDB already holds (`stored`) become references; the
 * others stay inline and are listed in `pending`, to be stored, after which the next save shrinks them.
 * Rankings without an inline image are passed through as they are.
 */
export function toStored(
  ranks: readonly Ranking[],
  stored: ReadonlySet<string>,
  keyOf: KeyOf = imageKey,
): { ranks: Ranking[]; pending: Map<string, string> } {
  const pending = new Map<string, string>();
  const out = ranks.map((r) => {
    if (!r.items.some((i) => i.img && isInline(i.img))) return r;
    const items = r.items.map((i) => {
      if (!i.img || !isInline(i.img)) return i;
      const key = keyOf(i.img);
      if (stored.has(key)) return { ...i, img: REF_PREFIX + key };
      pending.set(key, i.img);
      return i;
    });
    return { ...r, items };
  });
  return { ranks: out, pending };
}

/** Keys of every image the rankings hold, as references or inline (addresses aren't stored). */
export function imageKeys(ranks: readonly Ranking[], keyOf: KeyOf = imageKey): Set<string> {
  const keys = new Set<string>();
  for (const r of ranks) {
    for (const i of r.items) {
      if (!i.img) continue;
      if (isImageRef(i.img)) keys.add(i.img.slice(REF_PREFIX.length));
      else if (isInline(i.img)) keys.add(keyOf(i.img));
    }
  }
  return keys;
}

/** Keys of the references only: the images to read from IndexedDB at startup. */
export function refKeys(ranks: readonly Ranking[]): Set<string> {
  const keys = new Set<string>();
  for (const r of ranks) {
    for (const i of r.items) if (i.img && isImageRef(i.img)) keys.add(i.img.slice(REF_PREFIX.length));
  }
  return keys;
}

/**
 * Puts the images read from IndexedDB back in place of their references, in memory. A reference whose image
 * is missing or isn't an image stays as it is: saved again unchanged, shown as the item's label meanwhile.
 * Returns how many references are left.
 */
export function hydrate(ranks: Ranking[], found: ReadonlyMap<string, unknown>): number {
  let left = 0;
  for (const r of ranks) {
    for (const i of r.items) {
      if (!i.img || !isImageRef(i.img)) continue;
      const data = found.get(i.img.slice(REF_PREFIX.length));
      if (typeof data === 'string' && IMG_RE.test(data)) i.img = data;
      else left++;
    }
  }
  return left;
}

/** An image newer than this is never removed, even unused: another tab may be about to save a reference to it. */
export const GRACE_MS = 24 * 60 * 60 * 1000;

/** Stored images to remove: used by no ranking, and stored long enough ago. */
export function staleKeys(
  entries: Iterable<readonly [key: string, storedAt: number]>,
  used: ReadonlySet<string>,
  now: number,
): string[] {
  const out: string[] = [];
  for (const [key, t] of entries) if (!used.has(key) && t <= now - GRACE_MS) out.push(key);
  return out;
}
