import { trackEvent } from '../audience';
import { methodOf } from '../core/scoring';
import type { Ranking } from '../core/types';
import { plural, t } from '../i18n';
import { $, reduced } from './dom';

/**
 * End of a local ranking: when a duel completes the exact sort, or brings a rating method to full
 * stability for the first time, the duel pane announces it (confetti, a bar that empties) and then
 * moves to the Ranking tab by itself. "Stay here" stops the countdown; without motion there is none.
 */

export type EndKind = 'sort' | 'stable';

const COUNT_S = 4;

let ending: { id: string; kind: EndKind; stopped: boolean } | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

export const endingOf = (r: Ranking): EndKind | null => (ending?.id === r.id ? ending.kind : null);

export function startEnding(r: Ranking, kind: EndKind): void {
  ending = { id: r.id, kind, stopped: reduced };
  trackEvent('ranking-finished', { method: methodOf(r), end: kind, demo: Boolean(r.demo), items: r.items.length });
}

/** Stops the countdown; the announcement stays. */
export function stopEnding(): void {
  clearInterval(timer);
  if (ending) ending.stopped = true;
}

export function clearEnding(): void {
  clearInterval(timer);
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
  const counting = !ending.stopped;
  const facts = sort
    ? t('endSortFacts', { items: plural(r.items.length, 'item'), duels: plural(duels, 'duel') })
    : t('endStableFacts', { duels: plural(duels, 'duel') });
  const second = counting
    ? `<button class="btn ghost" type="button" data-action="end-stay">${t('endStay')}</button>`
    : sort
      ? ''
      : `<button class="btn ghost" type="button" data-action="end-continue">${t('endContinue')}</button>`;
  return `<div class="end ${counting ? 'end-run' : ''}" role="status">
    ${reduced ? '' : confettiHTML()}
    <span class="end-badge">${checkSvg}</span>
    <p class="end-facts mono">${facts}</p>
    <h2 class="end-h">${sort ? t('endSortTitle') : t('endStableTitle')}</h2>
    <p class="end-body">${sort ? t('endSortBody') : t('endStableBody')}</p>
    ${counting ? `<div class="end-count"><span class="end-bar"><i style="animation-duration:${COUNT_S}s"></i></span><span>${t('endCountdown', { n: `<b id="end-secs">${COUNT_S}</b>` })}</span></div>` : ''}
    <div class="end-acts"><button class="btn primary" type="button" data-action="end-see">${t('seeRanking')}</button>${second}</div>
  </div>`;
}

/** After endingHTML is in the page: runs the countdown, then calls `done`. */
export function mountEnding(done: () => void): void {
  clearInterval(timer);
  if (!ending || ending.stopped || !$('.end-run')) return;
  let left = COUNT_S;
  timer = setInterval(() => {
    left -= 1;
    const secs = $('#end-secs');
    if (secs) secs.textContent = String(Math.max(0, left));
    if (left <= 0) {
      clearInterval(timer);
      done();
    }
  }, 1000);
}
