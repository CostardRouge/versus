import { fillCSS } from '../core/colors';
import { compute, METHOD_KEYS, remaining, stability } from '../core/scoring';
import type { Computed, Item, ItemStats, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, pct, plural, t } from '../i18n';
import { thumbHTML, toast } from './dom';
import { fmtRecord, fmtScore } from './format';
import { cur, stat } from './state';

/** Results tab: podium, full table, method comparison, copy as text. */

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
  return `<div class="results">
    <div class="res-head">
      <div><p class="eyebrow mono">${plural(C.n, 'duel')} · ${M(m).name} (${M(m).tech}) · ${m === 'sort' ? t('progressLc') : t('stabilityLc')} ${pct(Math.round(st * 100))}</p><h2 class="q">${esc(r.title)}</h2></div>
      <div class="res-actions">
        <button class="btn primary" type="button" data-action="tab" data-tab="duel" ${n < 2 ? 'disabled' : ''}>${t('keepDueling')}</button>
        <button class="btn" type="button" data-action="copy">${t('copy')}</button>
        <button class="btn ghost" type="button" data-action="reset" data-id="${r.id}" ${r.history.length || r.demo ? '' : 'disabled'}>${r.demo ? t('reset') : t('restart')}</button>
      </div>
    </div>
    ${note}${pod}
    <ol class="rows">
      <li class="hdr" aria-hidden="true"><span>#</span><span></span><span>${t('colItem')}</span><span class="rbar-cell">${t('colGap')}</span><span class="num">${M(m).col}</span><span class="rec">${t('colRecord')}</span></li>
      ${rows}
    </ol>
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
