import { describe, expect, it } from 'vitest';
import {
  addItem,
  awaitsPicture,
  createBoard,
  DEFAULT_SETTINGS,
  decidePicture,
  LIMITS,
  parseNewItem,
  parsePublish,
  pendingPictures,
} from '../src/core/board';
import { hueValue, imageSrc, mkItem, mkRank } from '../src/core/model';
import { dataURLBytes, pictureItems, publishRequest } from '../src/core/published';
import { isJpeg } from '../src/core/share';
import type { Item, Result, SharedBoard } from '../src/core/types';

/** Pictures on published boards (docs/published-boards.md#images): what the server accepts, what the app sends. */

const V1 = 'voter-one-1';
const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: `Item ${i}`, img: null, fill: null, h: 10 }));

function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unexpected error ${r.error}`);
  return r.value;
}
const errorOf = <T>(r: Result<T>): string | null => (r.ok ? null : r.error);

const board = (list: Item[]): SharedBoard =>
  createBoard({ title: 'T', items: list, settings: { ...DEFAULT_SETTINGS }, voter: V1, duels: [], lang: 'en' }, 1000);

describe('what the server accepts', () => {
  it('takes no picture at all by default', () => {
    expect(errorOf(parseNewItem({ label: 'x', img: 'data:image/jpeg;base64,' }))).toBe('images_not_allowed');
    expect(errorOf(parseNewItem({ label: 'x', img: 'https://example.com/a.jpg' }))).toBe('images_not_allowed');
    expect(errorOf(parseNewItem({ label: 'x', pic: 'pending' }))).toBe('images_not_allowed');
    expect(value(parseNewItem({ label: 'x' }))).toEqual({ label: 'x', fill: null, img: null });
  });

  it('lets an item announce a picture for review, never carry one', () => {
    expect(value(parseNewItem({ label: 'x', pic: 'pending' }, 'review'))).toEqual({
      label: 'x',
      fill: null,
      img: null,
      pic: 'pending',
    });
    expect(errorOf(parseNewItem({ label: 'x', pic: 'refused' }, 'review'))).toBe('images_not_allowed');
    expect(errorOf(parseNewItem({ label: 'x', img: 'https://example.com/a.jpg' }, 'review'))).toBe(
      'images_not_allowed',
    );
    expect(errorOf(parseNewItem({ label: 'x', img: 'data:image/jpeg;base64,' }, 'review'))).toBe('images_not_allowed');
  });

  it('never takes a picture as an address, whatever the policy', () => {
    for (const img of ['https://example.com/a.jpg', '/img/b/Ab3dEf7hJk/i0.jpg', 'javascript:alert(1)', 'x y']) {
      for (const policy of ['off', 'review'] as const) {
        expect(errorOf(parseNewItem({ label: 'x', img }, policy)), img).toBe('images_not_allowed');
      }
    }
    expect(errorOf(parseNewItem({ label: 'x', img: '/img/b/Ab3dEf7hJk/i0.jpg', pic: 'pending' }, 'review'))).toBe(
      'images_not_allowed',
    );
  });

  it('keeps the announcement through publication and later additions', () => {
    const raw = { title: 'T', voter: V1, items: [{ ...items(2)[0], pic: 'pending' }, items(2)[1]] };
    expect(errorOf(parsePublish(raw))).toBe('images_not_allowed');
    const input = value(parsePublish(raw, 'review'));
    expect(input.items[0]).toMatchObject({ id: 'i0', img: null, pic: 'pending' });
    expect(Object.keys(input.items[1] ?? {})).not.toContain('pic');
    const b = board(items(2));
    const added = value(addItem(b, { label: 'Pic', fill: null, img: null, pic: 'pending' }, 'new1', 2000));
    expect(added).toMatchObject({ id: 'new1', img: null, pic: 'pending' });
    expect(pendingPictures(b)).toBe(1);
    expect(awaitsPicture(b, 'new1')).toBe(true);
    expect(awaitsPicture(b, 'i0')).toBe(false);
  });

  it('applies the moderator’s decision once, on an item that announced a picture', () => {
    const b = board([{ ...items(3)[0], pic: 'pending' } as Item, ...items(3).slice(1)]);
    expect(errorOf(decidePicture(b, 'nope', 'ok', '/img/x.jpg'))).toBe('not_found');
    expect(errorOf(decidePicture(b, 'i1', 'ok', '/img/x.jpg'))).toBe('bad_request');
    const shown = value(decidePicture(b, 'i0', 'ok', '/img/b/Ab3dEf7hJk/i0.jpg'));
    expect(shown).toEqual({ id: 'i0', label: 'Item 0', img: '/img/b/Ab3dEf7hJk/i0.jpg', fill: null, h: 10 });
    expect(b.items[0]).toBe(shown);
    expect(pendingPictures(b)).toBe(0);
    expect(errorOf(decidePicture(b, 'i0', 'refused', ''))).toBe('bad_request');
    const c = board([{ ...items(2)[0], pic: 'pending' } as Item, items(2)[1] as Item]);
    expect(value(decidePicture(c, 'i0', 'refused', ''))).toMatchObject({ id: 'i0', img: null, pic: 'refused' });
    // Not an activity for the TTL.
    expect(c.touched).toBe(1000);
  });

  it('recognizes a JPEG by its first bytes', () => {
    expect(isJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(true);
    expect(isJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(Uint8Array.from([0xff, 0xd8]))).toBe(false);
    expect(LIMITS.picture).toBeGreaterThan(100_000);
  });
});

describe('what the views draw', () => {
  it('draws only the two forms of picture the app writes', () => {
    const src = (img: unknown) => imageSrc({ img } as Pick<Item, 'img'>);
    expect(src('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(src('/img/b/Ab3dEf7hJk/i0.jpg')).toBe('/img/b/Ab3dEf7hJk/i0.jpg');
    for (const bad of [
      null,
      42,
      'x" onerror="1',
      'javascript:alert(1)',
      'https://example.com/a.jpg',
      'data:text/html;base64,PHNjcmlwdD4=',
      "data:image/png;base64,AAAA')",
      '/img/b/Ab3dEf7hJk/../x.jpg',
      '/img/b/Ab3dEf7hJk/i0.jpg?x',
    ]) {
      expect(src(bad), String(bad)).toBeNull();
    }
    expect(hueValue({ h: 120 })).toBe(120);
    expect(hueValue({ h: '1;x' as unknown as number })).toBe(0);
  });
});

describe('what the app sends', () => {
  const ranking = () => {
    const r = mkRank('Photos');
    r.items = [mkItem('Beach'), mkItem('Hills'), mkItem('Town')];
    (r.items[0] as Item).img = 'data:image/jpeg;base64,/9j/4AAQ';
    (r.items[2] as Item).img = 'data:image/jpeg;base64,/9j/4AAQ';
    return r;
  };

  it('announces the pictures only when asked, and never ships them in the request', () => {
    const r = ranking();
    const plain = publishRequest(r, V1, {}, false, 'en');
    expect(plain.items.every((it) => it.img === null && !('pic' in it))).toBe(true);
    const withPics = publishRequest(r, V1, {}, false, 'fr', true);
    expect(withPics.items.map((it) => it.pic)).toEqual(['pending', undefined, 'pending']);
    expect(withPics.items.every((it) => it.img === null)).toBe(true);
    expect(JSON.stringify(withPics)).not.toContain('base64');
    expect(pictureItems(r).map((it) => it.label)).toEqual(['Beach', 'Town']);
  });

  it('turns a stored data URL back into bytes', () => {
    const d = dataURLBytes('data:image/jpeg;base64,/9j/4AAQ');
    expect(d?.type).toBe('image/jpeg');
    expect([...(d?.bytes ?? [])]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(isJpeg(d?.bytes ?? new Uint8Array())).toBe(true);
    expect(dataURLBytes('https://example.com/a.jpg')).toBeNull();
    expect(dataURLBytes('data:image/jpeg;base64,***')).toBeNull();
  });
});
