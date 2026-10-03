import { CROWD_METHODS } from '../core/board';
import { METHOD_KEYS, methodOf } from '../core/scoring';
import type { MethodKey, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, t } from '../i18n';
import { authorSetMethod, renderAuthorMain } from './author';
import { $, $$, castSvg, doc, keepFocus, narrow, toast } from './dom';
import { bindStage, duelHTML } from './duel';
import { paneHTML } from './editor';
import { clearEnding, mountEnding } from './ending';
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
    return `<button class="mopt" type="button" role="menuitemradio" tabindex="-1" aria-checked="${k === m}" ${off ? 'aria-disabled="true"' : ''} data-action="set-method" data-m="${k}">
      <span class="mopt-top"><b>${X.name}</b><span class="mono">${X.tech}</span>${k === 'bt' ? `<span class="chip">${t('recommended')}</span>` : ''}</span>
      <span class="mopt-desc">${off ? t('sortCrowd') : X.desc}</span></button>`;
  }).join('');
  return `<div class="method-wrap">
    <button class="method-btn" type="button" id="method-btn" data-action="method-menu" aria-haspopup="true" aria-expanded="false"><span class="muted">${t('score')}</span> <b id="method-name">${M(m).name}</b> <span aria-hidden="true">▾</span></button>
    <div class="method-pop" id="method-pop" role="menu" aria-labelledby="method-btn" hidden>${opts}<p class="mopt-foot">${crowd ? t('methodFootCrowd') : t('methodFoot')}</p></div>
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
  // The view's h1 holds the title field: its name is the title, and a new view focuses it (rankings.ts).
  // The header's colored control comes last (first after the score on phones).
  return `<div class="ws" ${s.alias ? `data-alias="${esc(s.alias)}"` : ''}>
    <div class="ws-head">
      <button class="back" type="button" data-action="back">${t('back')}</button>
      <h1 class="ws-title"><input id="rank-title" class="title-input" value="${esc(s.title)}" aria-label="${t('rankNameAria')}" maxlength="80" autocomplete="off"></h1>${s.chip}
      ${s.action ? '<span class="ws-break" aria-hidden="true"></span>' : ''}
      ${methodMenuHTML(s.method, s.crowd)}
      ${s.action}
      <div class="tabs" role="tablist" aria-label="${t('tabsAria')}">
        <button class="tab tab-items" type="button" role="tab" id="tab-items" aria-controls="pane-items" data-action="tab" data-tab="items">${t('tabItems')}<span class="n" id="n-items"></span></button>
        <button class="tab" type="button" role="tab" id="tab-duel" aria-controls="main" data-action="tab" data-tab="duel">${t('tabDuel')}</button>
        <button class="tab" type="button" role="tab" id="tab-results" aria-controls="main" data-action="tab" data-tab="results">${t('tabResults')}</button>
      </div>
    </div>
    ${s.sub}
    <div class="ws-body" data-tab="duel">
      <aside class="pane-items" id="pane-items" aria-label="${t('itemsTitle')}">${s.pane}</aside>
      <section class="pane-main" id="main" role="tabpanel"></section>
    </div>
  </div>`;
}

const asTab = (v: string | undefined): Tab => (v === 'items' || v === 'results' ? v : 'duel');
/** The tabs on screen: Items only in the narrow layout, where the items pane is a tab of its own. */
const shownTabs = (): HTMLElement[] =>
  $$('.tabs [role="tab"]').filter((b) => narrow.matches || b.dataset.tab !== 'items');

/**
 * Keys on a tab (the APG tabs pattern): Left and Right show the previous or next tab, Home and End the first and
 * last, focus following. Only the selected tab is in the Tab order. True when the key was a tab key.
 */
export function tabKeydown(e: KeyboardEvent, tg: HTMLElement): boolean {
  const tabs = shownTabs();
  const i = tabs.indexOf(tg);
  const to: Record<string, number> = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: tabs.length - 1 };
  const k = to[e.key];
  if (i < 0 || k === undefined || e.altKey || e.ctrlKey || e.metaKey) return false;
  e.preventDefault();
  const next = tabs[(k + tabs.length) % tabs.length];
  if (!next) return true;
  setTab(asTab(next.dataset.tab));
  next.focus();
  return true;
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
  for (const b of $$('.tab')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === sel));
    b.tabIndex = b.dataset.tab === sel ? 0 : -1;
  }
  $('#main')?.setAttribute('aria-labelledby', `tab-${sel === 'items' ? 'duel' : sel}`);
  const r = cur();
  if (r) renderMain(r);
  else renderAuthorMain();
}
export function toggleMethodMenu(force?: boolean): void {
  const pop = $('#method-pop');
  const btn = $('#method-btn');
  if (!pop || !btn) return;
  const open = force ?? pop.hidden;
  // A menu closing with the focus inside (a choice, Escape, Tab) hands it back to its button.
  if (!open && pop.contains(doc.activeElement)) btn.focus();
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) $('.mopt[aria-checked="true"]', pop)?.focus();
}
/**
 * Keys in the open method menu: Up and Down move among the methods (round), Home and End to the first and last;
 * Escape closes it, and Tab too, going on from its button.
 */
export function menuKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === 'Tab') {
    toggleMethodMenu(false);
    if (e.key === 'Escape') $('#method-btn')?.focus();
    return;
  }
  const opts = $$('#method-pop [role="menuitemradio"]');
  const i = opts.indexOf(doc.activeElement as HTMLElement);
  const to: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 };
  const k = to[e.key];
  if (k === undefined) return;
  e.preventDefault();
  opts[(k + opts.length) % opts.length]?.focus();
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
  // Switched from the comparison table, the focus stays on its method's button.
  keepFocus(() => {
    renderList(r, true);
    renderMain(r);
  });
  toast(t('methodChanged', { name: M(key).name }));
}
export function renderMain(r: Ranking): void {
  const main = $('#main');
  if (!main) return;
  const tab = effTab();
  main.innerHTML = tab === 'results' ? resultsHTML(r) : duelHTML(r);
  if (tab === 'duel') {
    bindStage();
    mountEnding();
  } else mountSlopes(main);
  markPair(r);
}
