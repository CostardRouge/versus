import { describe, expect, it } from 'vitest';
import {
  GRACE_MS,
  hydrate,
  imageKey,
  imageKeys,
  isImageRef,
  REF_PREFIX,
  refKeys,
  shownImage,
  staleKeys,
  toStored,
} from '../src/core/images';
import type { Item, Ranking } from '../src/core/types';

const IMG1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const IMG2 = 'data:image/png;base64,iVBORw0KGgo=';
const K1 = imageKey(IMG1);
const K2 = imageKey(IMG2);

const item = (id: string, img: string | null = null): Item => ({ id, label: id, img, fill: null, h: 0 });
const rank = (id: string, items: Item[]): Ranking => ({
  id,
  title: id,
  method: 'bt',
  items,
  history: [],
  pair: null,
  created: 1,
  updated: 1,
});

describe('image keys and references', () => {
  it('derives a stable key from the content, with its length', () => {
    expect(imageKey(IMG1)).toBe(K1);
    expect(K1).not.toBe(K2);
    expect(K1.endsWith(`-${IMG1.length.toString(36)}`)).toBe(true);
    expect(imageKey(`${IMG1}A`)).not.toBe(K1);
  });

  it('tells a reference from an image', () => {
    expect(isImageRef(REF_PREFIX + K1)).toBe(true);
    expect(isImageRef(IMG1)).toBe(false);
    expect(isImageRef('idb:<script>')).toBe(false);
    expect(shownImage(IMG1)).toBe(IMG1);
    expect(shownImage(REF_PREFIX + K1)).toBeNull();
    expect(shownImage(null)).toBeNull();
  });
});

describe('toStored', () => {
  it('passes rankings without inline images through untouched', () => {
    const text = rank('t', [item('a'), item('b')]);
    const ref = rank('r', [item('a', REF_PREFIX + K1)]);
    const { ranks, pending } = toStored([text, ref], new Set());
    expect(ranks[0]).toBe(text);
    expect(ranks[1]).toBe(ref);
    expect(pending.size).toBe(0);
  });

  it('writes stored images as references and lists the others, once each', () => {
    const r1 = rank('r1', [item('a', IMG1), item('b', IMG2), item('c')]);
    const r2 = rank('r2', [item('a', IMG2)]);
    const { ranks, pending } = toStored([r1, r2], new Set([K1]));
    expect(ranks[0]?.items.map((i) => i.img)).toEqual([REF_PREFIX + K1, IMG2, null]);
    expect(ranks[1]?.items[0]?.img).toBe(IMG2);
    expect([...pending]).toEqual([[K2, IMG2]]);
    // The rankings in memory keep their images.
    expect(r1.items[0]?.img).toBe(IMG1);
  });

  it("keeps a published picture's address as it is", () => {
    const r = rank('r', [item('a', '/img/Ab3dEf7hJk/p0.jpg'), item('b', 'https://example.com/a.jpg')]);
    const { ranks, pending } = toStored([r], new Set());
    expect(ranks[0]).toBe(r);
    expect(pending.size).toBe(0);
    expect(imageKeys([r])).toEqual(new Set());
  });

  it('uses the given key function', () => {
    const seen: string[] = [];
    toStored([rank('r', [item('a', IMG1)])], new Set(), (d) => {
      seen.push(d);
      return 'k-1';
    });
    expect(seen).toEqual([IMG1]);
  });
});

describe('imageKeys and refKeys', () => {
  it('lists every image, inline or referenced, and the references alone', () => {
    const ranks = [rank('r1', [item('a', IMG1), item('b', REF_PREFIX + K2), item('c')])];
    expect(imageKeys(ranks)).toEqual(new Set([K1, K2]));
    expect(refKeys(ranks)).toEqual(new Set([K2]));
  });
});

describe('hydrate', () => {
  it('puts the images back and leaves what is missing or not an image', () => {
    const r = rank('r', [
      item('a', REF_PREFIX + K1),
      item('b', REF_PREFIX + K2),
      item('c', `${REF_PREFIX}zz-1`),
      item('d', IMG1),
      item('e'),
    ]);
    const left = hydrate(
      [r],
      new Map<string, unknown>([
        [K1, IMG1],
        [K2, 'javascript:alert(1)'],
      ]),
    );
    expect(r.items.map((i) => i.img)).toEqual([IMG1, REF_PREFIX + K2, `${REF_PREFIX}zz-1`, IMG1, null]);
    expect(left).toBe(2);
  });
});

describe('staleKeys', () => {
  const now = 10 * GRACE_MS;
  it('removes only unused images stored before the grace period', () => {
    const entries: [string, number][] = [
      ['used', 0],
      ['old', now - GRACE_MS],
      ['fresh', now - GRACE_MS + 1],
    ];
    expect(staleKeys(entries, new Set(['used']), now)).toEqual(['old']);
  });
});
