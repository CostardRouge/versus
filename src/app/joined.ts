import { trackEvent } from '../audience';
import { LIMITS } from '../core/board';
import { applySummary, type BoardSnapshot, joinedCopy, seeBoard, sortJoined, upsertJoined } from '../core/joined';
import type { Joined } from '../core/types';
import { t } from '../i18n';
import { toast } from './dom';
import { open, render } from './rankings';
import { fetchSummaries, online } from './remote';
import { S, save } from './state';
import { saveJoined, savePrefs } from './storage';

/**
 * "Your votes": the published boards this browser voted on without managing them, kept on this device.
 * The board page writes a card at the first vote and keeps it current; the gallery refreshes the cards
 * from the server (one request for all of them) to show what changed since the last visit.
 */

/** A gallery shown again within this delay keeps the cards it has. */
const REFRESH_MS = 60_000;
let refreshedAt = -Infinity;
let refreshing = false;
/** Changes from live ranking updates wait for the next write (a vote, leaving the board). */
let dirty = false;

export const joinedOf = (alias: string): Joined | undefined => S.joined.find((j) => j.alias === alias);

function persist(): void {
  dirty = false;
  saveJoined(S.joined);
}

/**
 * Called by the board page with what's on screen. A board gets its card once this voter has a vote on it;
 * `lazy` (live ranking updates) keeps the change in memory until the next write.
 */
export function noteBoard(snap: BoardSnapshot, voted: boolean, lazy = false): void {
  const prev = joinedOf(snap.alias);
  if (!prev && !snap.count) return;
  S.joined = upsertJoined(S.joined, seeBoard(prev, snap, Date.now(), voted));
  if (lazy) {
    dirty = true;
    return;
  }
  persist();
  if (!prev) trackEvent('board-joined');
  if (!prev && !S.prefs.joinedHint) {
    S.prefs.joinedHint = true;
    savePrefs(S.prefs);
    toast(t('joinedHint'));
  }
}

/** Saves what live updates changed; called when leaving a board. */
export function flushJoined(): void {
  if (dirty) persist();
}

/** The board no longer exists: its card says so, and stays until the voter forgets it. */
export function markGone(alias: string): void {
  const j = joinedOf(alias);
  if (!j || j.gone) return;
  S.joined = upsertJoined(S.joined, { ...j, gone: true });
  persist();
}

/**
 * Asks the server how the boards under "Your votes" are doing (at most once a minute, the most recent
 * first), then shows the gallery again if a card changed. Offline, the cards keep their snapshot.
 */
export async function refreshJoined(): Promise<void> {
  if (!online() || refreshing || Date.now() - refreshedAt < REFRESH_MS) return;
  const aliases = sortJoined(S.joined)
    .filter((j) => !j.gone)
    .slice(0, LIMITS.summaries)
    .map((j) => j.alias);
  if (!aliases.length) return;
  refreshing = true;
  try {
    const found = await fetchSummaries(S.voter, aliases);
    refreshedAt = Date.now();
    const before = JSON.stringify(S.joined);
    S.joined = S.joined.map((j) => (Object.hasOwn(found, j.alias) ? applySummary(j, found[j.alias] ?? null) : j));
    if (JSON.stringify(S.joined) === before) return;
    persist();
    if (S.route.view === 'gallery') render();
  } catch {
    // Offline or refused: try again next time the gallery shows.
  } finally {
    refreshing = false;
  }
}

/** Removes a card from the gallery; the board and the votes stay. Undo puts it back. */
export function forgetJoined(alias: string | undefined): void {
  const i = S.joined.findIndex((j) => j.alias === alias);
  const j = S.joined[i];
  if (!j) return;
  S.joined = S.joined.filter((x) => x !== j);
  persist();
  render();
  toast(t('forgotten', { title: j.title }), {
    label: t('undoForget'),
    run: () => {
      if (joinedOf(j.alias)) return;
      S.joined = [...S.joined.slice(0, i), j, ...S.joined.slice(i)];
      persist();
      render();
    },
  });
}

/** A board that is gone becomes a ranking of the voter's own, with its items and their votes. */
export function keepJoinedCopy(alias: string | undefined): void {
  const j = alias ? joinedOf(alias) : undefined;
  if (!j) return;
  const r = joinedCopy(j);
  S.ranks.push(r);
  save();
  S.joined = S.joined.filter((x) => x !== j);
  persist();
  open(r.id, 'results');
  toast(t('copyKept'));
}
