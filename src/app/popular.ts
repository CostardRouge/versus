import type { PopularBoard } from '../core/protocol';
import { getLang, type Lang, t } from '../i18n';
import { toast } from './dom';
import { errorKey, READ_ERRORS } from './errors';
import { makeOwn, render } from './rankings';
import { fetchBoard, fetchPopular, online } from './remote';
import { S } from './state';

/**
 * The Popular section of the gallery (docs/published-boards.md#official-templates): the boards the admin put
 * forward and the site's official templates, in the app's language, fetched once in a while from the server.
 * Nothing is stored: offline, or on a build without a server, the section simply isn't there.
 */

/** The list is asked for again after this delay, or when the language changes. */
const REFRESH_MS = 10 * 60_000;
let list: PopularBoard[] = [];
let listLang: Lang | null = null;
let fetchedAt = -Infinity;
let fetching = false;

export const popularBoards = (): PopularBoard[] => list;

/** Fetches the list when it is stale, then shows the gallery again if it changed. */
export async function refreshPopular(): Promise<void> {
  const lang = getLang();
  if (!online() || fetching || (lang === listLang && Date.now() - fetchedAt < REFRESH_MS)) return;
  fetching = true;
  try {
    const found = await fetchPopular(lang);
    fetchedAt = Date.now();
    listLang = lang;
    const changed = JSON.stringify(found) !== JSON.stringify(list);
    list = found;
    if (changed && S.route.view === 'gallery') render();
  } catch {
    // Offline or refused: the section waits for the next gallery.
  } finally {
    fetching = false;
  }
}

/** "Make my own" from a popular card: the board's items become a ranking of this browser, without the votes. */
export async function makeMineFromPopular(alias: string | undefined): Promise<void> {
  if (!alias || !list.some((b) => b.alias === alias)) return;
  try {
    const view = await fetchBoard(alias);
    makeOwn(view.title, view.items, 'template');
  } catch (e) {
    toast(t(errorKey(e, READ_ERRORS)));
  }
}
