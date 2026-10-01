import { hydrate, imageKey, imageKeys, refKeys, staleKeys, toStored } from '../core/images';
import type { Ranking } from '../core/types';

/**
 * Images in IndexedDB (src/core/images.ts, D118): one database, `versus`, one store, `images`, a record per
 * image `{ key, data, t }` (t = when it was stored, indexed for the clean-up). Every call is guarded: without
 * IndexedDB (an old browser, some private modes, the tests) images stay inline in localStorage, as before.
 */

const DB_NAME = 'versus';
const STORE = 'images';

interface ImageRecord {
  key: string;
  data: string;
  t: number;
}

let opening: Promise<IDBDatabase | null> | undefined;
/** Keys IndexedDB is known to hold: images saved as references. */
const known = new Set<string>();
/** Data URL → key, so a save doesn't hash every image again. */
const keys = new Map<string, string>();
/** Images being stored, so two saves in a row store each one once. */
const storing = new Map<string, Promise<boolean>>();

export function keyOf(data: string): string {
  let key = keys.get(data);
  if (!key) {
    key = imageKey(data);
    keys.set(data, key);
  }
  return key;
}

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return resolve(null);
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('t', 't');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

const result = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Whether the saved rankings point to images in IndexedDB, to read before the first render. */
export const hasImageRefs = (ranks: readonly Ranking[]): boolean => refKeys(ranks).size > 0;

/** Reads the images the rankings refer to and puts them in place, in memory. Never fails: what is missing stays a reference. */
export async function loadImages(ranks: Ranking[]): Promise<void> {
  const wanted = refKeys(ranks);
  if (!wanted.size) return;
  try {
    const d = await db();
    if (!d) return;
    const store = d.transaction(STORE).objectStore(STORE);
    const found = new Map<string, string>();
    await Promise.all(
      [...wanted].map(async (key) => {
        const rec = (await result(store.get(key))) as ImageRecord | undefined;
        if (rec && typeof rec.data === 'string') found.set(key, rec.data);
      }),
    );
    for (const [key, data] of found) {
      known.add(key);
      keys.set(data, key);
    }
    hydrate(ranks, found);
  } catch {
    /* the items show their label */
  }
}

async function put(key: string, data: string): Promise<boolean> {
  try {
    const d = await db();
    if (!d) return false;
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, data, t: Date.now() } satisfies ImageRecord);
    await committed(tx);
    known.add(key);
    return true;
  } catch {
    // Full or refused: the image stays inline in localStorage.
    return false;
  }
}

/** Stores images; true once any of them is stored (the caller saves again, with references). */
export function storeImages(pending: ReadonlyMap<string, string>): Promise<boolean> {
  const jobs = [...pending].map(([key, data]) => {
    let job = storing.get(key);
    if (!job) {
      job = put(key, data).finally(() => storing.delete(key));
      storing.set(key, job);
    }
    return job;
  });
  return Promise.all(jobs).then((done) => done.some(Boolean));
}

/** Rankings as written to localStorage: images IndexedDB holds as references, the others inline and pending. */
export const storedForm = (ranks: readonly Ranking[]) => toStored(ranks, known, keyOf);

/** Removes stored images no ranking uses any more (after a grace period). Run once, after startup. */
export async function tidyImages(ranks: readonly Ranking[], now = Date.now()): Promise<number> {
  try {
    const d = await db();
    if (!d) return 0;
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const entries: [string, number][] = [];
    await new Promise<void>((resolve, reject) => {
      // Keys and dates only: the images themselves aren't read.
      const req = store.index('t').openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        entries.push([String(cursor.primaryKey), Number(cursor.key)]);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const stale = staleKeys(entries, imageKeys(ranks, keyOf), now);
    for (const key of stale) {
      store.delete(key);
      known.delete(key);
    }
    await committed(tx);
    return stale.length;
  } catch {
    return 0;
  }
}
