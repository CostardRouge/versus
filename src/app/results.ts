import { fillCSS } from '../core/colors';
import { compute, METHOD_KEYS, remaining, stability } from '../core/scoring';
import type { Computed, Item, ItemStats, MethodKey, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, pct, plural, t } from '../i18n';
import { $, thumbHTML, toast } from './dom';
import { fmtRecord, fmtScore } from './format';
import { cur, S, stat } from './state';
import { savePrefs } from './storage';
import { renderMain } from './workspace';

/**
 * Results tab: podium and full table, or lines comparing the ranking's method with another one on the
 * same duels (a discreet switch, remembered); then the method comparison and copy as text.
 */

type RankView = 'podium' | 'lines';
const rankView = (): RankView => (S.prefs.rankView === 'lines' ? 'lines' : 'podium');

/** The method the lines compare with, while the page is open. */
let other: MethodKey | null = null;
/** Draw the lines with their animation on the next render (a switch, not a live update). */
let animateLines = false;

const podiumSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="11" width="6" height="10" rx="1"/><rect x="9" y="4" width="6" height="17" rx="1"/><rect x="15.5" y="14" width="6" height="7" rx="1"/></svg>';
const linesSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 5h3M18 5h3M3 12h3M18 12h3M3 19h3M18 19h3M7 5c5 0 5 7 10 7M7 12c5 0 5-7 10-7M7 19h10"/></svg>';

/** Methods the lines can compare with: the others, and Exact sort only once these duels complete it. */
function comparable(r: Ranking, m: MethodKey): MethodKey[] {
  return METHOD_KEYS.filter((k) => k !== m && (k !== 'sort' || compute({ ...r, method: 'sort' }).ex?.done));
}

function viewsHTML(): string {
  const btn = (v: RankView, label: string, icon: string) =>
    `<button type="button" data-action="rank-view" data-view="${v}" aria-pressed="${rankView() === v}" aria-label="${label}" title="${label}">${icon}</button>`;
  return `<span class="res-views" role="group" aria-label="${t('rankViews')}">${btn('podium', t('rankPodium'), podiumSvg)}${btn('lines', t('rankLines'), linesSvg)}</span>`;
}

function slopeHTML(r: Ranking, C: Computed): string {
  const m = C.m;
  const options = comparable(r, m);
  const k = other && options.includes(other) ? other : (options.find((x) => x === 'bt') ?? options[0]);
  if (!k) return '';
  const D = compute({ ...r, method: k });
  const pos = (Cx: Computed, it: Item, i: number) => (Cx.m === 'sort' && !stat(Cx, it.id).placed ? '·' : String(i + 1));
  const left = C.order
    .map(
      (it, i) =>
        `<li data-id="${esc(it.id)}"><span class="nm">${esc(it.label)}</span>${thumbHTML(it)}<span class="pos mono">${pos(C, it, i)}</span></li>`,
    )
    .join('');
  const right = D.order
    .map(
      (it, i) =>
        `<li data-id="${esc(it.id)}"><span class="pos mono">${pos(D, it, i)}</span>${thumbHTML(it)}<span class="nm">${esc(it.label)}</span></li>`,
    )
    .join('');
  const picks = options
    .map(
      (x) =>
        `<button type="button" data-action="set-compare" data-m="${x}" aria-pressed="${x === k}">${M(x).name}</button>`,
    )
    .join('');
  const draw = animateLines ? ' draw' : '';
  return `<section class="slope${draw}" data-slope aria-label="${t('slopeAria')}">
    <div class="slope-bar"><span class="muted">${t('compareWith')}</span><span class="slope-picks" role="group" aria-label="${t('compareWith')}">${picks}</span></div>
    <div class="slope-cols">
      <div class="slope-l" data-slope-l><p class="slope-h">${M(m).name} <i class="fin-dot-a"></i></p><ol>${left}</ol></div>
      <div class="slope-mid" aria-hidden="true"><svg class="slope-svg" data-slope-svg data-delay="0.05"></svg></div>
      <div class="slope-r" data-slope-r><p class="slope-h"><i class="fin-dot-b"></i>${M(k).name}</p><ol>${right}</ol></div>
    </div>
    <p class="slope-foot">${t('slopeFoot')}</p>
  </section>`;
}

/** Podium or lines; remembered in this browser. */
export function setRankView(v: string | undefined): void {
  const r = cur();
  if (!r || (v !== 'podium' && v !== 'lines') || v === rankView()) return;
  S.prefs.rankView = v;
  savePrefs(S.prefs);
  animateLines = v === 'lines';
  renderMain(r);
  animateLines = false;
  $(`[data-action="rank-view"][data-view="${v}"]`)?.focus();
}

export function setCompare(k: string | undefined): void {
  const r = cur();
  if (!r || !METHOD_KEYS.includes(k as MethodKey)) return;
  other = k as MethodKey;
  animateLines = true;
  renderMain(r);
  animateLines = false;
  $(`[data-action="set-compare"][data-m="${k}"]`)?.focus();
}

function compareHTML(r: Ranking, C: Computed): string {
  const cols = METHOD_KEYS.map((k) => ({ k, C: compute({ ...r, method: k }) }));
  const rows = Math.min(6, r.items.length);
  let body = '';
  for (let i = 0; i < rows; i++) {
    const cells = cols
      .map((c) => {
        const it = c.C.order[i];
        const ok = !!it && (c.k !== 'sort' || stat(c.C, it.id).placed);
        const same = ok && C.order[i]?.id === it?.id;
        return `<td class="${c.k === C.m ? 'on' : ''} ${ok && !same ? 'diff' : ''}">${ok && it ? esc(it.label) : '…'}</td>`;
      })
      .join('');
    body += `<tr><td class="mono">${i + 1}</td>${cells}</tr>`;
  }
  const head = cols
    .map(
      (c) =>
        `<th scope="col" class="${c.k === C.m ? 'on' : ''}"><button type="button" data-action="set-method" data-m="${c.k}">${M(c.k).name}<span class="mono">${M(c.k).tech}</span></button></th>`,
    )
    .join('');
  return `<section class="cmp">
    <div class="cmp-head"><h3>${t('cmpTitle')}</h3><p class="muted">${t('cmpIntro')}</p></div>
    <div class="cmp-scroll"><table class="cmp-table"><thead><tr><th scope="col">#</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}
export function resultsHTML(r: Ranking): string {
  const C = compute(r);
  const m = C.m;
  const s = C.order;
  const n = s.length;
  if (!n)
    return `<div class="empty-duel"><h2 class="q">${t('nothingToRank')}</h2><p class="muted">${t('nothingBody')}</p><button class="btn primary only-narrow" type="button" data-action="tab" data-tab="items">${t('addItems')}</button></div>`;
  const ranked = C.n > 0;
  const st = stability(r, C);
  const rest = remaining(r, C);
  const scores = s.map((i) => stat(C, i.id).score);
  const mn = Math.min(...scores);
  const mx = Math.max(...scores);
  const width = (it: Item) =>
    m === 'sort'
      ? Math.round((100 * (n - stat(C, it.id).pos)) / n)
      : mx === mn
        ? 50
        : Math.round(8 + (92 * (stat(C, it.id).score - mn)) / (mx - mn));
  const note = !ranked
    ? `<p class="note">${t('noDuelsNote')}</p>`
    : st < 1
      ? `<p class="note">${t(m === 'sort' ? 'provisionalSort' : 'provisionalStab', { duels: plural(rest, 'duel') })}</p>`
      : '';
  const line = (x: ItemStats) =>
    m === 'sort'
      ? fmtRecord(x, false)
      : `${fmtScore(m, x)}${m === 'bt' ? ` ±${Math.round(x.se ?? 0)}` : ''} · ${fmtRecord(x, true)}`;
  const showPodium = ranked && n >= 3 && (m !== 'sort' || (C.ex?.sorted.length ?? 0) >= 3);
  const pod = showPodium
    ? `<ol class="podium">${s
        .slice(0, 3)
        .map(
          (it, i) => `<li class="pod pod-${i + 1}">
      <div class="pod-media" style="${it.fill ? `background:${fillCSS(it.fill)}` : `--h:${it.h}`}">${it.img ? `<img src="${it.img}" alt="">` : it.fill ? '' : `<span class="pod-txt">${esc(it.label)}</span>`}</div>
      <div class="pod-info"><span class="pod-place">${i + 1}</span><div><b>${esc(it.label)}</b><span class="mono">${line(stat(C, it.id))}</span></div></div>
    </li>`,
        )
        .join('')}</ol>`
    : '';
  const rows = s
    .map((it, i) => {
      const x = stat(C, it.id);
      return `<li><span class="pos mono">${m === 'sort' && !x.placed ? '·' : i + 1}</span>${thumbHTML(it)}<span class="rlabel">${esc(it.label)}</span><span class="rbar-cell"><span class="rbar"><i style="width:${width(it)}%"></i></span></span><span class="num mono">${fmtScore(m, x)}${m === 'bt' ? `<small>±${Math.round(x.se ?? 0)}</small>` : ''}</span><span class="rec mono">${x.w} · ${x.l} · ${x.d}</span></li>`;
    })
    .join('');
  const slope = ranked && n >= 2 && rankView() === 'lines' ? slopeHTML(r, C) : '';
  const lines = slope !== '';
  return `<div class="results">
    <div class="res-head">
      <div><p class="eyebrow mono">${plural(C.n, 'duel')} · ${M(m).name} (${M(m).tech}) · ${m === 'sort' ? t('progressLc') : t('stabilityLc')} ${pct(Math.round(st * 100))}</p><h2 class="q">${esc(r.title)}</h2></div>
      <div class="res-actions">
        ${ranked && n >= 2 ? viewsHTML() : ''}
        <button class="btn primary" type="button" data-action="tab" data-tab="duel" ${n < 2 ? 'disabled' : ''}>${t('keepDueling')}</button>
        <button class="btn" type="button" data-action="copy">${t('copy')}</button>
        <button class="btn ghost" type="button" data-action="reset" data-id="${r.id}" ${r.history.length || r.demo ? '' : 'disabled'}>${r.demo ? t('reset') : t('restart')}</button>
      </div>
    </div>
    ${note}${
      lines
        ? slope
        : `${pod}
    <ol class="rows">
      <li class="hdr" aria-hidden="true"><span>#</span><span></span><span>${t('colItem')}</span><span class="rbar-cell">${t('colGap')}</span><span class="num">${M(m).col}</span><span class="rec">${t('colRecord')}</span></li>
      ${rows}
    </ol>`
    }
    ${ranked && n >= 2 ? compareHTML(r, C) : ''}
  </div>`;
}
export function copyRanking(): void {
  const r = cur();
  if (!r) return;
  const C = compute(r);
  const lines = C.order.map(
    (it, i) => `${i + 1}. ${it.label}${C.m === 'sort' ? '' : ` (${fmtScore(C.m, stat(C, it.id))})`}`,
  );
  const text = `${r.title} (${M(C.m).name})\n${lines.join('\n')}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(t('copied')),
      () => toast(t('copyRefused')),
    );
  } else toast(t('copyNA'));
}
