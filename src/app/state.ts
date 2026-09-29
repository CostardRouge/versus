import type { Computed, ItemStats, Ranking } from '../core/types';
import { t } from '../i18n';
import { toast } from './dom';
import { type Prefs, saveRanks } from './storage';

/** App state: saved rankings, preferences and the current route. */

export type Tab = 'items' | 'duel' | 'results';
interface Route {
  view: 'gallery' | 'rank';
  id?: string;
  tab: Tab;
}

export const S: { ranks: Ranking[]; prefs: Prefs; route: Route } = {
  ranks: [],
  prefs: {},
  route: { view: 'gallery', tab: 'duel' },
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
