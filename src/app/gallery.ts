import { fillCSS } from '../core/colors';
import { DEMOS } from '../core/demos';
import { compute, stability } from '../core/scoring';
import type { Item, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, pct, plural, t } from '../i18n';
import { trashSvg } from './dom';
import { ago, fmtScore } from './format';
import { S, stat } from './state';

function tileHTML(it: Item | undefined, i: number, ranked: boolean): string {
  const cls = `tile${i === 0 ? ' first' : ''}`;
  if (!it) return `<span class="${cls}"></span>`;
  const n = ranked ? `<span class="tile-n mono">${i + 1}</span>` : '';
  if (it.fill) return `<span class="${cls}" style="background:${fillCSS(it.fill)}">${n}</span>`;
  if (it.img) return `<span class="${cls}" style="background-image:url('${it.img}')">${n}</span>`;
  return `<span class="${cls} txt" style="--h:${it.h}">${n}<b>${esc(it.label)}</b></span>`;
}
function rcardHTML(r: Ranking): string {
  const C = compute(r);
  const m = C.m;
  const ranked = C.n > 0;
  const st = Math.round(stability(r, C) * 100);
  const lead = ranked ? C.order[0] : undefined;
  const id = r.id;
  const pub = r.pub;
  const alias = esc(pub?.alias);
  const actions = pub
    ? `<button class="btn sm" type="button" data-action="open-board" data-alias="${alias}">${t('openBoard')}</button>
      <button class="btn sm ghost" type="button" data-action="copy-link" data-alias="${alias}">${t('copyLink')}</button>`
    : r.demo
      ? `<button class="btn sm" type="button" data-action="open" data-id="${id}" data-tab="duel">${ranked ? t('resume') : t('tryIt')}</button>
      <button class="btn sm ghost" type="button" data-action="open" data-id="${id}" data-tab="results">${t('result')}</button>
      <button class="btn sm ghost" type="button" data-action="reset-demo" data-id="${id}">${t('reset')}</button>
      <button class="btn sm ghost" type="button" data-action="duplicate" data-id="${id}" title="${t('duplicateTitle')}">${t('duplicate')}</button>`
      : `<button class="btn sm" type="button" data-action="open" data-id="${id}" data-tab="duel">${ranked ? t('resume') : t('start')}</button>
      <button class="btn sm ghost" type="button" data-action="open" data-id="${id}" data-tab="results">${t('result')}</button>
      <button class="btn sm ghost" type="button" data-action="reset" data-id="${id}" ${r.history.length ? '' : 'disabled'}>${t('restart')}</button>
      <button class="icon-btn" type="button" data-action="delete" data-id="${id}" aria-label="${esc(t('deleteAria', { title: r.title }))}">${trashSvg}</button>`;
  const leadHTML = lead
    ? `${t('leading')} <b>${esc(lead.label)}</b>${m === 'sort' ? '' : ` <span class="mono">${fmtScore(m, stat(C, lead.id))}</span>`}`
    : t('noDuels');
  return `<article class="rcard">
    <button class="rcard-main" type="button" data-action="open" data-id="${id}" data-tab="${r.items.length >= 2 ? 'duel' : 'items'}" aria-label="${esc(t('openAria', { title: r.title }))}">
      <div class="mosaic">${[0, 1, 2].map((i) => tileHTML(C.order[i], i, ranked)).join('')}</div>
      <div class="rcard-body">
        <div class="rcard-title"><h3>${esc(r.title)}</h3>${r.demo ? `<span class="chip">${t('demoChip')}</span>` : ''}${pub ? `<span class="chip${pub.status === 'closed' ? '' : ' chip-live'}">${t(pub.status === 'closed' ? 'closedChip' : 'pubChip')}</span>` : ''}</div>
        <p class="meta mono">${plural(r.items.length, 'item')} · ${plural(C.n, 'duel')} · ${M(m).name}${r.demo ? '' : ` · ${ago(r.updated)}`}</p>
        <p class="lead">${leadHTML}</p>
        <div class="stab-line"><span>${m === 'sort' ? t('progress') : t('stability')}</span><span class="bar"><i style="width:${st}%"></i></span><span class="mono">${pct(st)}</span></div>
      </div>
    </button>
    <div class="rcard-actions">${actions}</div>
  </article>`;
}
export function galleryHTML(): string {
  const mine = S.ranks.filter((r) => !r.demo).sort((a, b) => b.updated - a.updated);
  const demos = DEMOS.map((d) => S.ranks.find((r) => r.id === d.id)).filter((r): r is Ranking => !!r);
  const hide = !!S.prefs.hideDemos;
  return `<section class="gallery">
    <div class="g-head">
      <div><h1>${t('yourRankings')}</h1><p>${t('galleryIntro')}</p></div>
      <button class="btn primary" type="button" data-action="new-rank">${t('newRankingBtn')}</button>
    </div>
    <div class="g-grid">${mine.map(rcardHTML).join('')}
      <button class="new-card" type="button" data-action="new-rank"><span class="plus" aria-hidden="true">+</span><b>${t('newRanking')}</b><span class="muted">${t('newCardHint')}</span></button>
    </div>
    <div class="demo-head">
      <div><h2>${t('demos')}</h2><p class="muted">${t('demosIntro')}</p></div>
      <button class="link" type="button" data-action="toggle-demos">${hide ? t('showDemos') : t('hideDemos')}</button>
    </div>
    ${hide ? '' : `<div class="g-grid">${demos.map(rcardHTML).join('')}</div>`}
  </section>`;
}
