import type { Local } from '../core/backup';
import type { Computed, ItemStats, Joined, Ranking } from '../core/types';
import { t } from '../i18n';
import { toast } from './dom';
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

export function save(): void {
  if (!saveRanks(S.ranks) && !warned) {
    warned = true;
    toast(t('storageWarn'));
  }
}

/** Everything this browser keeps, for export and import (src/core/backup.ts). */
export const localData = (): Local => ({ ranks: S.ranks, owners: loadOwners(), joined: S.joined, voter: S.voter });
