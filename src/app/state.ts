import type { Local } from '../core/backup';
import type { Computed, ItemStats, Joined, Ranking } from '../core/types';
import { t } from '../i18n';
import { toast } from './dom';
import { storedForm, storeImages } from './images';
import { loadOwners, type Prefs, saveRanks } from './storage';

/** App state: saved rankings, preferences and the current route. */

export type Tab = 'items' | 'duel' | 'results';
interface Route {
  view: 'gallery' | 'rank' | 'board';
  /** Local ranking id (rank view). */
  id?: string;
  /** Published board alias (board view). */
  alias?: string;
  tab: Tab;
}

export const S: { ranks: Ranking[]; joined: Joined[]; prefs: Prefs; route: Route; voter: string } = {
  ranks: [],
  /** Published boards voted on from this browser ("Your votes"). */
  joined: [],
  prefs: {},
  route: { view: 'gallery', tab: 'duel' },
  /** This browser's anonymous voter id on published boards. */
  voter: '',
};
let warned = false;

export const cur = (): Ranking | undefined =>
  S.route.view === 'rank' ? S.ranks.find((r) => r.id === S.route.id) : undefined;
export const stat = (C: Computed, id: string): ItemStats => C.st[id] as ItemStats;

function warn(): void {
  if (warned) return;
  warned = true;
  toast(t('storageWarn'));
}

/**
 * Writes the rankings. Images IndexedDB holds are written as references (src/app/images.ts); a new image is
 * written inline first, then stored, then the rankings are written again, smaller. The warning waits for that
 * second write: a first write that failed only because of new images isn't a problem yet.
 */
export function save(): void {
  const { ranks, pending } = storedForm(S.ranks);
  const ok = saveRanks(ranks);
  if (!pending.size) {
    if (!ok) warn();
    return;
  }
  void storeImages(pending).then((stored) => {
    if (stored) save();
    else if (!ok) warn();
  });
}

/** Writes rankings once their new images are stored, for a write that must fit at once (an import). False if it doesn't. */
export async function saveSettled(ranks: readonly Ranking[]): Promise<boolean> {
  await storeImages(storedForm(ranks).pending);
  return saveRanks(storedForm(ranks).ranks);
}

/** Everything this browser keeps, for export and import (src/core/backup.ts). */
export const localData = (): Local => ({ ranks: S.ranks, owners: loadOwners(), joined: S.joined, voter: S.voter });
