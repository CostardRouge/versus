import { CROWD_METHODS } from '../core/board';
import { METHOD_KEYS, methodOf } from '../core/scoring';
import type { MethodKey, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, t } from '../i18n';
import { authorSetMethod, renderAuthorMain } from './author';
import { $, $$, castSvg, narrow, toast } from './dom';
import { bindStage, duelHTML, endSee } from './duel';
import { paneHTML } from './editor';
import { clearEnding, mountEnding, stopEnding } from './ending';
import { markPair, renderList } from './items';
import { online } from './remote';
import { resultsHTML } from './results';
import { syncURL } from './router';
import { mountSlopes } from './slope';
import { cur, S, save, type Tab } from './state';

/**
 * Workspace shell: header, tabs, method menu, the items pane and the main pane (duel or results). A local
 * ranking and the author's view of a published board (author.ts, D116) share it.
 */

function methodMenuHTML(m: MethodKey, crowd: boolean): string {
  const opts = METHOD_KEYS.map((k) => {
    const X = M(k);
    // A crowd can't use Exact sort: listed, greyed out, with the reason (D45).
    const off = crowd && !CROWD_METHODS.includes(k);
    return `<button class="mopt" type="button" role="menuitemradio" aria-checked="${k === m}" ${off ? 'aria-disabled="true"' : ''} data-action="set-method" data-m="${k}">
      <span class="mopt-top"><b>${X.name}</b><span class="mono">${X.tech}</span>${k === 'bt' ? `<span class="chip">${t('recommended')}</span>` : ''}</span>
      <span class="mopt-desc">${off ? t('sortCrowd') : X.desc}</span></button>`;
  }).join('');
  return `<div class="method-wrap">
    <button class="method-btn" type="button" id="method-btn" data-action="method-menu" aria-haspopup="true" aria-expanded="false"><span class="muted">${t('score')}</span> <b id="method-name">${M(m).name}</b> <span aria-hidden="true">▾</span></button>
    <div class="method-pop" id="method-pop" role="menu" hidden>${opts}<p class="mopt-foot">${crowd ? t('methodFootCrowd') : t('methodFoot')}</p></div>
  </div>`;
}

export interface Shell {
  title: string;
  /** After the title: the Demo chip. */
  chip: string;
  method: MethodKey;
  /** A published board's scoring: the crowd's methods only. */
  crowd: boolean;
  /** The header's one colored control: Publish, or the published board's settings. */
  action: string;
  /** Under the header: a published board's counts and connection state. */
  sub: string;
  /** The items pane (editor.ts). */
  pane: string;
  /** The alias of the published board this workspace shows. */
  alias?: string;
}

export function shellHTML(s: Shell): string {
  // The header's colored control comes last (first after the score on phones).
  return `<div class="ws" ${s.alias ? `data-alias="${esc(s.alias)}"` : ''}>
    <div class="ws-head">
      <button class="back" type="button" data-action="back">${t('back')}</button>
      <input id="rank-title" class="title-input" value="${esc(s.title)}" aria-label="${t('rankNameAria')}" maxlength="80" autocomplete="off">${s.chip}
      ${s.action ? '<span class="ws-break" aria-hidden="true"></span>' : ''}
      ${methodMenuHTML(s.method, s.crowd)}
      ${s.action}
      <div class="tabs" role="tablist">
        <button class="tab tab-items" type="button" role="tab" data-action="tab" data-tab="items">${t('tabItems')}<span class="n" id="n-items"></span></button>
        <button class="tab" type="button" role="tab" data-action="tab" data-tab="duel">${t('tabDuel')}</button>
        <button class="tab" type="button" role="tab" data-action="tab" data-tab="results">${t('tabResults')}</button>
      </div>
    </div>
    ${s.sub}
    <div class="ws-body" data-tab="duel">
      <aside class="pane-items" aria-label="${t('itemsTitle')}">${s.pane}</aside>
      <section class="pane-main" id="main"></section>
    </div>
  </div>`;
}

export function wsHTML(r: Ranking): string {
  const pub = online() && !r.demo;
  return shellHTML({
    title: r.title,
    chip: r.demo ? `<span class="chip">${t('demoChip')}</span>` : '',
    method: methodOf(r),
    crowd: false,
    action: pub
      ? `<button class="pub-btn" type="button" data-action="publish">${castSvg}<span>${t('publish')}</span></button>`
      : '',
    sub: '',
    pane: paneHTML({ images: true, foot: t('asideFoot') }),
  });
}
export function effTab(): Tab {
  const tab = S.route.tab;
  return tab === 'items' && !narrow.matches ? 'duel' : tab;
}
export function setTab(tab: Tab): void {
  S.route.tab = tab;
  // The tab is part of the address, without a history entry of its own.
  syncURL('replace');
  const body = $('.ws-body');
  if (!body) return;
  body.dataset.tab = tab;
  const sel = narrow.matches ? tab : effTab();
  for (const b of $$('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === sel));
  const r = cur();
  if (r) renderMain(r);
  else renderAuthorMain();
}
export function toggleMethodMenu(force?: boolean): void {
  const pop = $('#method-pop');
  const btn = $('#method-btn');
  if (!pop || !btn) return;
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) $('.mopt[aria-checked="true"]', pop)?.focus();
}
export function setMethod(k: string | undefined): void {
  if (S.route.view === 'board') {
    void authorSetMethod(k);
    return;
  }
  const r = cur();
  if (!r || !METHOD_KEYS.includes(k as MethodKey)) return;
  const key = k as MethodKey;
  toggleMethodMenu(false);
  if (methodOf(r) === key) return;
  clearEnding();
  r.method = key;
  r.pair = null;
  r.updated = Date.now();
  save();
  const nm = $('#method-name');
  if (nm) nm.textContent = M(key).name;
  for (const b of $$('.mopt')) b.setAttribute('aria-checked', String(b.dataset.m === key));
  renderList(r, true);
  renderMain(r);
  toast(t('methodChanged', { name: M(key).name }));
}
export function renderMain(r: Ranking): void {
  const main = $('#main');
  if (!main) return;
  const tab = effTab();
  main.innerHTML = tab === 'results' ? resultsHTML(r) : duelHTML(r);
  if (tab === 'duel') {
    bindStage();
    mountEnding(endSee);
  } else {
    // Leaving the announcement keeps it, without its countdown.
    stopEnding();
    mountSlopes(main);
  }
  markPair(r);
}
