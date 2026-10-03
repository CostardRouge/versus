import { ALIAS_RE, LIMITS } from '../../src/core/board';
import { isJpeg } from '../../src/core/share';

/**
 * Items' pictures on published boards (docs/published-boards.md#images): sent by the author right after
 * publishing (or adding an item), kept in R2 under `img/<alias>/<item>.jpg` with a `state` (pending, then ok),
 * shown to visitors under `/img/b/<alias>/<item>.jpg` only once the moderator approved them, served to the
 * moderator meanwhile through the admin routes. A refused picture is deleted.
 */

const ITEM_ID_RE = /^[\w-]{1,32}$/;

export const pictureKey = (alias: string, id: string): string => `img/${alias}/${id}.jpg`;

/** Reads a public picture address back: `img/b/<alias>/<item>.jpg`, split on `/`. */
export function parsePicturePath(parts: readonly string[]): { alias: string; id: string } | null {
  const [img, b, alias, file, ...more] = parts;
  if (img !== 'img' || b !== 'b' || !alias || !ALIAS_RE.test(alias) || !file || more.length) return null;
  const id = file.replace(/\.jpg$/, '');
  if (id === file || !ITEM_ID_RE.test(id)) return null;
  return { alias, id };
}

export type Stored = 'ok' | 'bad_request' | 'too_large';

/** Stores a picture the author sent, waiting for review: a JPEG within the size limit. */
export async function storePicture(bucket: R2Bucket, alias: string, id: string, bytes: Uint8Array): Promise<Stored> {
  if (bytes.byteLength > LIMITS.picture) return 'too_large';
  if (!isJpeg(bytes)) return 'bad_request';
  await bucket.put(pictureKey(alias, id), bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: { state: 'pending' },
  });
  return 'ok';
}

/**
 * The picture of an item: for visitors only once approved, for the moderator whatever its state (to review it), with
 * its ETag, which the moderator's decision sends back (`approvePicture`). Null when there is none to show.
 */
export async function readPicture(
  bucket: R2Bucket | undefined,
  alias: string,
  id: string,
  admin: boolean,
): Promise<Response | null> {
  if (!bucket) return null;
  const object = await bucket.get(pictureKey(alias, id));
  if (!object) return null;
  if (!admin && object.customMetadata?.state !== 'ok') return null;
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': admin ? 'no-store' : 'public, max-age=86400',
      ETag: object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Marks a stored picture approved (R2 rewrites the object to change its metadata), provided it is still the one the
 * moderator looked at: `etag` is the ETag they were served. `changed` when the author sent another one since,
 * `not_found` when there is none.
 */
export async function approvePicture(
  bucket: R2Bucket,
  alias: string,
  id: string,
  etag: string,
): Promise<'ok' | 'not_found' | 'changed'> {
  const key = pictureKey(alias, id);
  const object = await bucket.get(key);
  if (!object) return 'not_found';
  if (etag !== object.httpEtag && etag !== object.etag) return 'changed';
  // The bytes written back are the ones just compared: whatever arrives meanwhile, what is approved is what was seen.
  await bucket.put(key, object.body, {
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: { state: 'ok' },
  });
  return 'ok';
}

export const deletePicture = (bucket: R2Bucket, alias: string, id: string): Promise<void> =>
  bucket.delete(pictureKey(alias, id));

/** Deletes every object under a prefix (a board's cards or pictures, when the board goes); returns how many went. */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (keys.length) await bucket.delete(keys);
  return keys.length;
}
