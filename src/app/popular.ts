import type { PopularBoard } from '../core/protocol';
import { getLang, type Lang, t } from '../i18n';
import { $, toast } from './dom';
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
/** The last request failed (offline): the section isn't announced until one succeeds. */
let failed = false;

export const popularBoards = (): PopularBoard[] => list;

/**
 * True while the gallery waits for its first list: the section keeps its place with a word that it is loading,
 * rather than popping in under the reader's eyes.
 */
export const popularWaiting = (): boolean => online() && !failed && !list.length && listLang === null;

/** Fetches the list when it is stale, then shows the gallery again if it changed (keeping the focus: render()). */
export async function refreshPopular(): Promise<void> {
  const lang = getLang();
  if (!online() || fetching || (lang === listLang && Date.now() - fetchedAt < REFRESH_MS)) return;
  const waited = popularWaiting();
  fetching = true;
  try {
    const found = await fetchPopular(lang);
    fetchedAt = Date.now();
    listLang = lang;
    failed = false;
    const changed = JSON.stringify(found) !== JSON.stringify(list);
    list = found;
    if ((changed || waited) && S.route.view === 'gallery') render();
  } catch {
    // Offline or refused: the section waits for the next gallery, and its place goes.
    failed = true;
    if (waited && S.route.view === 'gallery') render();
  } finally {
    fetching = false;
  }
}

/** The popular board whose items are being fetched for "Make my own": one at a time. */
let making: string | null = null;

/** The "Make my own" button of a popular card, busy while its board is read. */
function makingBusy(alias: string, busy: boolean): void {
  const btn = $<HTMLButtonElement>(`[data-action="make-mine-popular"][data-alias="${alias}"]`);
  if (!btn) return;
  btn.disabled = busy;
  if (busy) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
}

/** "Make my own" from a popular card: the board's items become a ranking of this browser, without the votes. */
export async function makeMineFromPopular(alias: string | undefined): Promise<void> {
  if (!alias || making || !list.some((b) => b.alias === alias)) return;
  making = alias;
  makingBusy(alias, true);
  try {
    const view = await fetchBoard(alias);
    makeOwn(view.title, view.items, 'template');
  } catch (e) {
    toast(t(errorKey(e, READ_ERRORS)));
  } finally {
    making = null;
    makingBusy(alias, false);
  }
}
