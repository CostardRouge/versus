import type { Local } from '../core/backup';
import type { Route, RouteTab } from '../core/route';
import type { Computed, ItemStats, Joined, Ranking } from '../core/types';
import { t } from '../i18n';
import { toast } from './dom';
import { loadOwners, type Prefs, saveRanks } from './storage';

/** App state: saved rankings, preferences and the current route. */

export type Tab = RouteTab;
/**
 * The view on screen: the address's route (core/route.ts), with the workspace's tab on every view, kept while
 * the gallery or a board shows (a board's author has the tabs too).
 */
type ViewRoute = Route & { tab: Tab };

export const S: { ranks: Ranking[]; joined: Joined[]; prefs: Prefs; route: ViewRoute; voter: string } = {
  ranks: [],
  /** Published boards voted on from this browser ("Your votes"). */
  joined: [],
  prefs: {},
  route: { view: 'gallery', tab: 'duel' },
  /** This browser's anonymous voter id on published boards. */
  voter: '',
};
let warned = false;

export function cur(): Ranking | undefined {
  const route = S.route;
  return route.view === 'rank' ? S.ranks.find((r) => r.id === route.id) : undefined;
}
export const stat = (C: Computed, id: string): ItemStats => C.st[id] as ItemStats;

export function save(): void {
  clearTimeout(soon);
  if (!saveRanks(S.ranks) && !warned) {
    warned = true;
    toast(t('storageWarn'));
  }
}

let soon: ReturnType<typeof setTimeout> | undefined;
/** Saves a moment after the last call: a title typed is written once, not at every key (every ranking is rewritten). */
export function saveSoon(): void {
  clearTimeout(soon);
  soon = setTimeout(save, 400);
}

/** Everything this browser keeps, for export and import (src/core/backup.ts). */
export const localData = (): Local => ({ ranks: S.ranks, owners: loadOwners(), joined: S.joined, voter: S.voter });
