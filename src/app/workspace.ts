import { METHOD_KEYS, methodOf } from '../core/scoring';
import type { MethodKey, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, t } from '../i18n';
import { $, $$, imgSvg, narrow, toast } from './dom';
import { bindStage, duelHTML } from './duel';
import { markPair, renderList } from './items';
import { resultsHTML } from './results';
import { cur, S, save, type Tab } from './state';

/** Workspace shell: header, tabs, method menu, and the main pane (duel or results). */

function methodMenuHTML(m: MethodKey): string {
  const opts = METHOD_KEYS.map((k) => {
    const X = M(k);
    return `<button class="mopt" type="button" role="menuitemradio" aria-checked="${k === m}" data-action="set-method" data-m="${k}">
      <span class="mopt-top"><b>${X.name}</b><span class="mono">${X.tech}</span>${k === 'bt' ? `<span class="chip">${t('recommended')}</span>` : ''}</span>
      <span class="mopt-desc">${X.desc}</span></button>`;
  }).join('');
  return `<div class="method-wrap">
    <button class="method-btn" type="button" id="method-btn" data-action="method-menu" aria-haspopup="true" aria-expanded="false"><span class="muted">${t('score')}</span> <b id="method-name">${M(m).name}</b> <span aria-hidden="true">▾</span></button>
    <div class="method-pop" id="method-pop" role="menu" hidden>${opts}<p class="mopt-foot">${t('methodFoot')}</p></div>
  </div>`;
}
export function wsHTML(r: Ranking): string {
  return `<div class="ws">
    <div class="ws-head">
      <button class="back" type="button" data-action="back">${t('back')}</button>
      <input id="rank-title" class="title-input" value="${esc(r.title)}" aria-label="${t('rankNameAria')}" maxlength="80" autocomplete="off">${r.demo ? `<span class="chip">${t('demoChip')}</span>` : ''}
      ${methodMenuHTML(methodOf(r))}
      <div class="tabs" role="tablist">
        <button class="tab tab-items" type="button" role="tab" data-action="tab" data-tab="items">${t('tabItems')}<span class="n" id="n-items"></span></button>
        <button class="tab" type="button" role="tab" data-action="tab" data-tab="duel">${t('tabDuel')}</button>
        <button class="tab" type="button" role="tab" data-action="tab" data-tab="results">${t('tabResults')}</button>
      </div>
    </div>
    <div class="ws-body" data-tab="duel">
      <aside class="pane-items" aria-label="${t('itemsTitle')}">
        <div class="aside-head"><h2>${t('itemsTitle')}</h2><span class="mono muted" id="aside-count"></span></div>
        <form id="add-form" class="add" autocomplete="off">
          <input id="add-input" placeholder="${t('addPlaceholder')}" aria-label="${t('itemNameAria')}" maxlength="120">
          <button class="add-btn" type="submit" aria-label="${t('add')}">+</button>
        </form>
        <button class="drop" type="button" data-action="pick-files">${imgSvg}<span>${t('imagesDrop')}</span></button>
        <input type="file" id="file-input" accept="image/*" multiple hidden>
        <div class="add-color">
          <input type="color" id="c1" value="#2743f5" aria-label="${t('colorAria')}">
          <input type="color" id="c2" value="#e4492a" aria-label="${t('color2Aria')}" hidden>
          <label class="grad-toggle" for="c-grad"><input type="checkbox" id="c-grad"> ${t('gradient')}</label>
          <button class="btn sm" type="button" data-action="add-color">${t('addColor')}</button>
        </div>
        <ol class="list" id="item-list"></ol>
        <p class="aside-foot">${t('asideFoot')}</p>
      </aside>
      <section class="pane-main" id="main"></section>
    </div>
  </div>`;
}
export function effTab(): Tab {
  const tab = S.route.tab;
  return tab === 'items' && !narrow.matches ? 'duel' : tab;
}
export function setTab(tab: Tab): void {
  S.route.tab = tab;
  const body = $('.ws-body');
  if (!body) return;
  body.dataset.tab = tab;
  const sel = narrow.matches ? tab : effTab();
  for (const b of $$('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === sel));
  const r = cur();
  if (r) renderMain(r);
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
  const r = cur();
  if (!r || !METHOD_KEYS.includes(k as MethodKey)) return;
  const key = k as MethodKey;
  toggleMethodMenu(false);
  if (methodOf(r) === key) return;
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
  if (tab === 'duel') bindStage();
  markPair(r);
}
