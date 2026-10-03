import { trackEvent } from '../audience';
import { methodOf } from '../core/scoring';
import type { Ranking } from '../core/types';
import { plural, t } from '../i18n';
import { $, announce, reduced } from './dom';

/**
 * End of a local ranking: when a duel completes the exact sort, or brings a rating method to full
 * stability for the first time, the duel pane announces it (confetti) and offers the Ranking tab. It never
 * moves there by itself (WCAG 2.2.1): the focus goes to "See the ranking", and one sentence is announced.
 */

export type EndKind = 'sort' | 'stable';

/** `fresh` until the announcement is first on screen: then it is read out and takes the focus, once. */
let ending: { id: string; kind: EndKind; fresh: boolean } | null = null;

export const endingOf = (r: Ranking): EndKind | null => (ending?.id === r.id ? ending.kind : null);

export function startEnding(r: Ranking, kind: EndKind): void {
  ending = { id: r.id, kind, fresh: true };
  trackEvent('ranking-finished', { method: methodOf(r), end: kind, demo: Boolean(r.demo), items: r.items.length });
}

export function clearEnding(): void {
  ending = null;
}

const checkSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function confettiHTML(): string {
  const colors = ['end-ca', 'end-cb', 'end-cg'];
  let out = '';
  for (let i = 0; i < 26; i++) {
    const angle = (Math.PI * 2 * i) / 26;
    const dist = 90 + ((i * 53) % 110);
    const x = Math.round(Math.cos(angle) * dist * 1.6);
    const y = Math.round(Math.sin(angle) * dist + 40);
    out += `<i class="${colors[i % 3]}" style="--x:${x}px;--y:${y}px;--r:${(i * 97) % 540}deg;--dl:${((i % 5) * 0.04).toFixed(2)}s"></i>`;
  }
  return `<span class="end-confetti" aria-hidden="true">${out}</span>`;
}

export function endingHTML(r: Ranking, duels: number): string {
  if (!ending || ending.id !== r.id) return '';
  const sort = ending.kind === 'sort';
  const facts = sort
    ? t('endSortFacts', { items: plural(r.items.length, 'item'), duels: plural(duels, 'duel') })
    : t('endStableFacts', { duels: plural(duels, 'duel') });
  const more = sort
    ? ''
    : `<button class="btn ghost" type="button" data-action="end-continue">${t('endContinue')}</button>`;
  return `<div class="end" data-duels="${duels}">
    ${reduced || !ending.fresh ? '' : confettiHTML()}
    <span class="end-badge">${checkSvg}</span>
    <p class="end-facts mono">${facts}</p>
    <h2 class="end-h">${sort ? t('endSortTitle') : t('endStableTitle')}</h2>
    <p class="end-body">${sort ? t('endSortBody') : t('endStableBody')}</p>
    <div class="end-acts"><button class="btn primary" type="button" data-action="end-see">${t('seeRanking')}</button>${more}</div>
  </div>`;
}

/** After endingHTML is in the page: the first time, the news is announced and "See the ranking" takes the focus. */
export function mountEnding(): void {
  const end = $('.end');
  if (!ending?.fresh || !end) return;
  ending.fresh = false;
  const duels = plural(Number(end.dataset.duels), 'duel');
  announce(ending.kind === 'sort' ? t('endSortLive', { duels }) : t('endStableLive', { duels }));
  $('[data-action="end-see"]', end)?.focus();
}
