import { fillCode, fillCSS, fillInk, harmonies, hexToHsl, hslToHex, isHex, normHex, PRESETS } from '../core/colors';
import { buildDemo, DEMOS, relabelDemos } from '../core/demos';
import { getItem, mkItem, mkRank } from '../core/model';
import {
  compute,
  ensurePair,
  expected,
  METHOD_KEYS,
  methodOf,
  nextPair,
  pushDuel,
  remaining,
  stability,
  undoDuel,
} from '../core/scoring';
import type { Computed, Fill, Item, ItemStats, MethodKey, Outcome, Ranking } from '../core/types';
import { esc, fmtDelta, initials, sizeClass, uid } from '../core/util';
import {
  detectLang,
  getLang,
  isLang,
  type Lang,
  locale,
  methodText as M,
  pct,
  plural,
  setLang as setI18nLang,
  t,
} from '../i18n';
import {
  isTheme,
  loadLegacyRanks,
  loadPrefs,
  loadRanks,
  type Prefs,
  savePrefs,
  saveRanks,
  type Theme,
} from './storage';

type Tab = 'items' | 'duel' | 'results';
interface Route {
  view: 'gallery' | 'rank';
  id?: string;
  tab: Tab;
}
type MQ = Pick<MediaQueryList, 'matches' | 'addEventListener'>;

const S: { ranks: Ranking[]; prefs: Prefs; route: Route } = {
  ranks: [],
  prefs: {},
  route: { view: 'gallery', tab: 'duel' },
};
const cp: { id: string | null; active: number; follow: boolean; anchor: HTMLElement | null } = {
  id: null,
  active: 0,
  follow: false,
  anchor: null,
};
let doc: Document;
let narrow: MQ;
let reduced = false;
let busy = false;
let warned = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let modalDone: ((v: boolean) => void) | null = null;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = doc): T | null =>
  root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = doc): T[] => [
  ...root.querySelectorAll<T>(sel),
];
const media = (q: string): MQ =>
  typeof window.matchMedia === 'function' ? window.matchMedia(q) : { matches: false, addEventListener: () => {} };

const trashSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const imgSvg =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';

/* ---------- State helpers ---------- */
const cur = (): Ranking | undefined => (S.route.view === 'rank' ? S.ranks.find((r) => r.id === S.route.id) : undefined);
const stat = (C: Computed, id: string): ItemStats => C.st[id] as ItemStats;

function save(): void {
  if (!saveRanks(S.ranks) && !warned) {
    warned = true;
    toast(t('storageWarn'));
  }
}

/* ---------- Formatting ---------- */
function fmtScore(m: MethodKey, s: ItemStats): string {
  if (m === 'win') return pct(Math.round(s.score * 100));
  if (m === 'sort') return s.placed ? t('placed') : t('toPlace');
  return String(Math.round(s.score));
}
const fmtRecord = (s: ItemStats, withTies: boolean): string =>
  `${s.w}${t('recW')} ${s.l}${t('recL')}${withTies ? ` ${s.d}${t('recD')}` : ''}`;

function deltaInfo(m: MethodKey, before: ItemStats, after: ItemStats, res: number): { text: string; cls: string } {
  if (m === 'sort') return res > 0 ? { text: '↑', cls: 'up' } : { text: '↓', cls: 'down' };
  const d = m === 'win' ? Math.round((after.score - before.score) * 100) : Math.round(after.score - before.score);
  return { text: fmtDelta(d) + (m === 'win' ? ' pt' : ''), cls: d > 0 ? 'up' : d < 0 ? 'down' : 'eq' };
}
function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('agoNow');
  if (m < 60) return t('agoMin', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('agoH', { n: h });
  return t('agoD', { n: Math.round(h / 24) });
}

/* ---------- UI helpers ---------- */
function toast(msg: string): void {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function announce(msg: string): void {
  const el = $('#live');
  if (el) el.textContent = msg;
}
function ask(opts: { title: string; body: string; ok?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const m = $('#modal');
    const okB = $<HTMLButtonElement>('#m-ok');
    const cancel = $('#m-cancel');
    const title = $('#m-title');
    const body = $('#m-body');
    if (!m || !okB || !cancel || !title || !body) return resolve(false);
    title.textContent = opts.title;
    body.textContent = opts.body;
    okB.textContent = opts.ok ?? t('confirm');
    okB.className = `btn ${opts.danger ? 'danger' : 'primary'}`;
    cancel.textContent = t('cancel');
    const prev = doc.activeElement as HTMLElement | null;
    m.hidden = false;
    modalDone = (v) => {
      m.hidden = true;
      modalDone = null;
      prev?.focus();
      resolve(v);
    };
    setTimeout(() => okB.focus(), 10);
  });
}
const closeModal = (v: boolean): void => modalDone?.(v);

const thumbHTML = (it: Item): string =>
  it.fill
    ? `<span class="thumb" style="background:${fillCSS(it.fill)}"></span>`
    : `<span class="thumb" style="--h:${it.h}">${it.img ? `<img src="${it.img}" alt="">` : esc(initials(it.label))}</span>`;

function applyStatic(): void {
  const lang = getLang();
  doc.documentElement.lang = lang;
  $('.brand')?.setAttribute('aria-label', t('brandAria'));
  const note = $('#top-note');
  if (note) note.textContent = t('tagline');
  const drop = $('#drop-text');
  if (drop) drop.textContent = t('dropOverlay');
  $('.lang')?.setAttribute('aria-label', t('langAria'));
  for (const b of $$('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.l === lang));
  $('.theme')?.setAttribute('aria-label', t('themeAria'));
  const labels: Record<Theme, string> = { system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') };
  for (const b of $$('.theme button')) {
    const label = labels[b.dataset.t as Theme] ?? '';
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  applyTheme();
}

/** Browser chrome colors matching the two palettes (see --bg in styles.css). */
const THEME_COLORS: Record<'light' | 'dark', string> = { light: '#ECEEF2', dark: '#0E1015' };

/** "system" leaves the choice to prefers-color-scheme; light and dark pin the palette via data-theme. */
function applyTheme(): void {
  const theme: Theme = S.prefs.theme ?? 'system';
  const root = doc.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const b of $$('.theme button')) b.setAttribute('aria-pressed', String(b.dataset.t === theme));
  for (const meta of $$<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.content = theme === 'system' ? own : THEME_COLORS[theme];
  }
}
function changeTheme(v: string | undefined): void {
  if (!isTheme(v)) return;
  S.prefs.theme = v;
  savePrefs(S.prefs);
  applyTheme();
}

/* ---------- Gallery ---------- */
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
  const actions = r.demo
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
        <div class="rcard-title"><h3>${esc(r.title)}</h3>${r.demo ? `<span class="chip">${t('demoChip')}</span>` : ''}</div>
        <p class="meta mono">${plural(r.items.length, 'item')} · ${plural(C.n, 'duel')} · ${M(m).name}${r.demo ? '' : ` · ${ago(r.updated)}`}</p>
        <p class="lead">${leadHTML}</p>
        <div class="stab-line"><span>${m === 'sort' ? t('progress') : t('stability')}</span><span class="bar"><i style="width:${st}%"></i></span><span class="mono">${pct(st)}</span></div>
      </div>
    </button>
    <div class="rcard-actions">${actions}</div>
  </article>`;
}
function galleryHTML(): string {
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

/* ---------- Workspace ---------- */
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
function wsHTML(r: Ranking): string {
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
function effTab(): Tab {
  const tab = S.route.tab;
  return tab === 'items' && !narrow.matches ? 'duel' : tab;
}
function setTab(tab: Tab): void {
  S.route.tab = tab;
  const body = $('.ws-body');
  if (!body) return;
  body.dataset.tab = tab;
  const sel = narrow.matches ? tab : effTab();
  for (const b of $$('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === sel));
  const r = cur();
  if (r) renderMain(r);
}
function listThumbHTML(it: Item): string {
  if (!it.fill) return thumbHTML(it);
  return `<button class="thumb thumb-btn" type="button" data-action="edit-color" data-id="${it.id}" style="background:${fillCSS(it.fill)}" aria-label="${esc(t('editColorAria', { label: it.label }))}" title="${t('editColor')}"></button>`;
}
function renderList(r: Ranking, animate: boolean): void {
  const ul = $('#item-list');
  if (!ul) return;
  const before: Record<string, number> = {};
  if (animate) for (const li of $$('li[data-id]', ul)) before[li.dataset.id ?? ''] = li.getBoundingClientRect().top;
  const C = compute(r);
  const m = C.m;
  const P = r.history.length ? compute(r, r.history.length - 1) : null;
  ul.innerHTML = C.order.length
    ? C.order
        .map((it, i) => {
          const s = stat(C, it.id);
          const prev = P?.st[it.id];
          const mv = prev ? prev.pos - s.pos : 0;
          return `<li data-id="${it.id}">
      <span class="pos mono">${m === 'sort' && !s.placed ? '·' : i + 1}</span>
      ${listThumbHTML(it)}
      <input class="row-label" data-id="${it.id}" value="${esc(it.label)}" aria-label="${esc(t('renameAria', { label: it.label }))}" maxlength="120">
      <span class="rt mono ${s.games && s.placed ? '' : 'dim'}" title="${M(m).col}">${m === 'sort' ? (s.placed ? '' : t('toPlace')) : fmtScore(m, s)}</span>
      <span class="dl mono ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}">${mv > 0 ? `↑${mv}` : mv < 0 ? `↓${-mv}` : ''}</span>
      <button class="rm" type="button" data-action="remove-item" data-id="${it.id}" aria-label="${esc(t('removeAria', { label: it.label }))}">×</button>
    </li>`;
        })
        .join('')
    : `<li class="empty">${t('emptyList')}</li>`;
  if (animate && !reduced) {
    for (const li of $$('li[data-id]', ul)) {
      const b = before[li.dataset.id ?? ''];
      if (b === undefined) {
        li.classList.add('new');
        continue;
      }
      const d = b - li.getBoundingClientRect().top;
      if (Math.abs(d) > 1 && typeof li.animate === 'function') {
        li.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], {
          duration: 520,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    }
  }
  const count = $('#aside-count');
  if (count) count.textContent = plural(r.items.length, 'item');
  const n = $('#n-items');
  if (n) n.textContent = String(r.items.length);
  markPair(r);
}
function markPair(r: Ranking): void {
  const p = r.pair;
  for (const li of $$('#item-list li[data-id]')) {
    li.classList.toggle('in-a', !!p && li.dataset.id === p[0]);
    li.classList.toggle('in-b', !!p && li.dataset.id === p[1]);
  }
}
function toggleMethodMenu(force?: boolean): void {
  const pop = $('#method-pop');
  const btn = $('#method-btn');
  if (!pop || !btn) return;
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) $('.mopt[aria-checked="true"]', pop)?.focus();
}
function setMethod(k: string | undefined): void {
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

/* ---------- Color editor popover ---------- */
const cpItem = (): Item | undefined => {
  const r = cur();
  return r && cp.id ? getItem(r, cp.id) : undefined;
};
const swatchesHTML = (hex: string): string =>
  harmonies(hex)
    .concat(PRESETS)
    .map(
      (c) =>
        `<button class="cp-sw" type="button" style="background:${c}" data-action="cp-swatch" data-c="${c}" aria-label="${c.toUpperCase()}" title="${c.toUpperCase()}"></button>`,
    )
    .join('');
function cpHTML(f: Fill): string {
  const isG = f.type === 'gradient';
  const act = f.colors[Math.min(cp.active, f.colors.length - 1)] ?? '#000000';
  const stops = f.colors
    .map(
      (c, i) => `<div class="cp-stop ${i === cp.active ? 'on' : ''}" data-i="${i}">
        <input type="color" class="cp-color" data-i="${i}" value="${normHex(c)}" aria-label="${t('stopAria', { n: i + 1 })}">
        <input class="cp-hex" data-i="${i}" value="${normHex(c).toUpperCase()}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${t('hexAria', { n: i + 1 })}">
        ${isG && f.colors.length > 2 ? `<button class="icon-btn" type="button" data-action="cp-remove" data-i="${i}" aria-label="${t('removeStop', { n: i + 1 })}">×</button>` : ''}
      </div>`,
    )
    .join('');
  return `<p class="cp-label">${t('cpTitle')}</p>
    <div class="cp-preview" id="cp-preview" style="background:${fillCSS(f)};color:${fillInk(f)}"><span>${fillCode(f)}</span></div>
    <div class="cp-seg" role="radiogroup">
      <button type="button" role="radio" aria-checked="${!isG}" data-action="cp-type" data-type="solid">${t('solid')}</button>
      <button type="button" role="radio" aria-checked="${isG}" data-action="cp-type" data-type="gradient">${t('gradientT')}</button>
    </div>
    <div class="cp-stops">${stops}${isG && f.colors.length < 3 ? `<button class="link" type="button" data-action="cp-add">${t('addStop')}</button>` : ''}</div>
    <p class="cp-err" id="cp-err" hidden>${t('invalidHex')}</p>
    <p class="cp-label">${t('suggestions')}</p>
    <div class="cp-swatches" id="cp-swatches">${swatchesHTML(act)}</div>
    <div class="cp-foot"><button class="btn sm primary" type="button" data-action="cp-done">${t('done')}</button></div>`;
}
function openColor(id: string, anchor: HTMLElement): void {
  const r = cur();
  const it = r ? getItem(r, id) : undefined;
  const pop = $('#cpop');
  if (!it?.fill || !pop) return;
  toggleMethodMenu(false);
  cp.id = id;
  cp.active = 0;
  cp.follow = it.label.toUpperCase() === fillCode(it.fill);
  cp.anchor = anchor;
  pop.innerHTML = cpHTML(it.fill);
  pop.hidden = false;
  placeColor();
  if (!narrow.matches) $('.cp-hex', pop)?.focus();
}
function placeColor(): void {
  const pop = $('#cpop');
  if (!pop || pop.hidden) return;
  if (narrow.matches || !cp.anchor?.isConnected) {
    pop.style.left = '';
    pop.style.top = '';
    return;
  }
  const a = cp.anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(Math.max(16, a.left), window.innerWidth - w - 16);
  let top = a.bottom + 8;
  if (top + h > window.innerHeight - 16) top = Math.max(16, a.top - h - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}
function closeColor(): void {
  const pop = $('#cpop');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  const anchorId = cp.id;
  cp.id = null;
  const r = cur();
  if (r) {
    save();
    if (effTab() === 'results') renderMain(r);
  }
  if (anchorId) $(`.thumb-btn[data-id="${anchorId}"]`)?.focus();
}
function redrawColor(): void {
  const it = cpItem();
  const pop = $('#cpop');
  if (it?.fill && pop) {
    pop.innerHTML = cpHTML(it.fill);
    placeColor();
  }
}
function applyFill(commit: boolean): void {
  const r = cur();
  const it = cpItem();
  if (!r || !it?.fill) return;
  if (cp.follow) it.label = fillCode(it.fill);
  const css = fillCSS(it.fill);
  const pv = $('#cp-preview');
  if (pv) {
    pv.style.background = css;
    pv.style.color = fillInk(it.fill);
    const span = pv.firstElementChild;
    if (span) span.textContent = fillCode(it.fill);
  }
  const row = $(`#item-list li[data-id="${it.id}"]`);
  if (row) {
    const th = $('.thumb-btn', row);
    if (th) th.style.background = css;
    const input = $<HTMLInputElement>('.row-label', row);
    if (cp.follow && input) input.value = it.label;
  }
  const card = $(`.card[data-id="${it.id}"]`);
  if (card) {
    $('#stage')?.classList.remove('enter');
    card.outerHTML = cardHTML(it, card.dataset.side === 'b' ? 'b' : 'a');
  }
  if (commit) {
    r.updated = Date.now();
    save();
  }
}
function setStop(i: number, hex: string, commit: boolean): void {
  const it = cpItem();
  const pop = $('#cpop');
  if (!it?.fill || !pop || !isHex(hex)) return;
  const v = normHex(hex);
  it.fill.colors[i] = v;
  const col = $<HTMLInputElement>(`.cp-color[data-i="${i}"]`, pop);
  if (col && col.value !== v) col.value = v;
  const hx = $<HTMLInputElement>(`.cp-hex[data-i="${i}"]`, pop);
  if (hx && doc.activeElement !== hx) hx.value = v.toUpperCase();
  const sw = $('#cp-swatches');
  if (i === cp.active && sw) sw.innerHTML = swatchesHTML(v);
  applyFill(commit);
}
function setActiveStop(i: number): void {
  cp.active = i;
  for (const s of $$('#cpop .cp-stop')) s.classList.toggle('on', Number(s.dataset.i) === i);
  const it = cpItem();
  const sw = $('#cp-swatches');
  const c = it?.fill?.colors[i];
  if (c && sw) sw.innerHTML = swatchesHTML(c);
}
function cpAction(action: string, el: HTMLElement): void {
  const f = cpItem()?.fill;
  if (!f) return;
  if (action === 'cp-type') {
    const type = el.dataset.type === 'gradient' ? 'gradient' : 'solid';
    if (f.type === type) return;
    const first = f.colors[0] ?? '#2743f5';
    if (type === 'solid') {
      f.type = 'solid';
      f.colors = [first];
      cp.active = 0;
    } else {
      const [h, s, l] = hexToHsl(first);
      f.type = 'gradient';
      f.colors = [first, hslToHex(h + 40, s, l - 12)];
    }
    applyFill(true);
    redrawColor();
  } else if (action === 'cp-add') {
    const [h, s, l] = hexToHsl(f.colors[f.colors.length - 1] ?? '#2743f5');
    f.colors.push(hslToHex(h + 40, s, l + 10));
    cp.active = f.colors.length - 1;
    applyFill(true);
    redrawColor();
  } else if (action === 'cp-remove') {
    f.colors.splice(Number(el.dataset.i), 1);
    cp.active = 0;
    applyFill(true);
    redrawColor();
  } else if (action === 'cp-swatch') {
    if (el.dataset.c) setStop(Math.min(cp.active, f.colors.length - 1), el.dataset.c, true);
  } else if (action === 'cp-done') closeColor();
}

/* ---------- Duel ---------- */
function cardHTML(it: Item, side: 'a' | 'b'): string {
  const label = esc(it.label);
  let inner: string;
  if (it.fill) {
    const code = fillCode(it.fill);
    inner = `<span class="fillbg" style="background:${fillCSS(it.fill)}"></span><span class="cap" style="color:${fillInk(it.fill)}">${label}${it.label.toUpperCase() !== code ? `<small>${code}</small>` : ''}</span>`;
  } else if (it.img)
    inner = `<img src="${it.img}" alt="" draggable="false"><span class="shade"></span><span class="cap">${label}</span>`;
  else inner = `<span class="txt ${sizeClass(it.label)}">${label}</span>`;
  return `<div class="card card-${side}" role="button" tabindex="0" data-side="${side}" data-id="${it.id}" style="--h:${it.h}" aria-label="${esc(t('chooseAria', { label: it.label }))}"><span class="side-tag" aria-hidden="true">${side.toUpperCase()}</span>${inner}</div>`;
}
function emptyDuelHTML(): string {
  return `<div class="empty-duel">
    <div class="ghosts" aria-hidden="true"><span class="ghost-card ga">A</span><span class="vs-dot">vs</span><span class="ghost-card gb">B</span></div>
    <h2 class="q">${t('needTwo')}</h2>
    <p class="muted">${t('needTwoBody')}</p>
    <button class="btn primary only-narrow" type="button" data-action="tab" data-tab="items">${t('addItems')}</button>
  </div>`;
}
function sortDoneHTML(C: Computed): string {
  return `<div class="empty-duel">
    <div class="ghosts" aria-hidden="true"><span class="ghost-card ga">✓</span></div>
    <h2 class="q">${t('sortDone')}</h2>
    <p class="muted">${t('sortDoneBody', { duels: plural(C.n, 'duel') })}</p>
    <button class="btn primary" type="button" data-action="tab" data-tab="results">${t('seeRanking')}</button>
  </div>`;
}
function duelHTML(r: Ranking): string {
  if (r.items.length < 2) return emptyDuelHTML();
  const C = compute(r);
  const m = C.m;
  if (ensurePair(r, C)) save();
  const pair = r.pair;
  const A = pair ? getItem(r, pair[0]) : undefined;
  const B = pair ? getItem(r, pair[1]) : undefined;
  if (!A || !B) return sortDoneHTML(C);
  const showP = m === 'elo' || m === 'bt';
  const pa = showP ? Math.round(expected(stat(C, A.id).score, stat(C, B.id).score) * 100) : 0;
  const st = stability(r, C);
  const stp = Math.round(st * 100);
  const rest = remaining(r, C);
  const isSort = m === 'sort';
  return `<div class="duel">
    <div class="duel-top">
      <div><p class="eyebrow mono">${t('duelN', { n: C.n + 1 })} · ${M(m).name}</p><h2 class="q">${t('question')}</h2></div>
      <div class="stab"><span>${isSort ? t('progress') : t('stability')}</span><span class="bar"><i style="width:${stp}%"></i></span><span class="mono">${pct(stp)}</span>${st >= 1 ? `<button class="link" type="button" data-action="tab" data-tab="results">${t('stableSee')}</button>` : ''}</div>
    </div>
    <div class="stage enter" id="stage">
      ${cardHTML(A, 'a')}
      <div class="vs" aria-hidden="true">${showP ? `<span class="p pa mono">${pa}</span>` : ''}<span class="vs-dot">vs</span>${showP ? `<span class="p pb mono">${100 - pa}</span><span class="vs-lbl">${t('forecast')}</span>` : ''}</div>
      ${cardHTML(B, 'b')}
      <span class="float fa" aria-hidden="true"></span><span class="float fb" aria-hidden="true"></span>
    </div>
    <div class="controls">
      <button class="ctl ctl-a" type="button" data-action="pick" data-side="a"><kbd>←</kbd> ${t('aWins')}</button>
      <button class="ctl" type="button" data-action="pick" data-side="draw" ${isSort ? `disabled title="${t('noDrawSort')}"` : ''}>${t('draw')} <kbd>↓</kbd></button>
      <button class="ctl" type="button" data-action="skip" ${isSort ? `disabled title="${t('noSkipSort')}"` : ''}>${t('skip')} <kbd>S</kbd></button>
      <button class="ctl ctl-b" type="button" data-action="pick" data-side="b">${t('bWins')} <kbd>→</kbd></button>
    </div>
    <div class="duel-foot">
      <button class="link" type="button" data-action="undo" ${r.history.length ? '' : 'disabled'}>${t('undo')}</button>
      <span class="muted">${isSort ? t('sortLeft', { duels: plural(rest, 'duel') }) : ''}${t('swipeHint')}</span>
    </div>
  </div>`;
}
function bindStage(): void {
  const st = $('#stage');
  if (!st) return;
  let x0: number | null = null;
  let dx = 0;
  let pid: number | null = null;
  let moved = false;
  const clear = () => {
    for (const p of ['--dx', '--pa', '--pb']) st.style.removeProperty(p);
  };
  st.addEventListener('pointerdown', (e) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    x0 = e.clientX;
    dx = 0;
    pid = e.pointerId;
    moved = false;
    try {
      st.setPointerCapture(pid);
    } catch {
      /* not supported */
    }
    st.classList.remove('enter');
    st.classList.add('dragging');
  });
  st.addEventListener('pointermove', (e) => {
    if (x0 === null || e.pointerId !== pid) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 6) moved = true;
    const p = Math.max(-1, Math.min(1, dx / 140));
    st.style.setProperty('--dx', String(dx));
    st.style.setProperty('--pa', String(Math.max(0, -p)));
    st.style.setProperty('--pb', String(Math.max(0, p)));
  });
  const end = (e: PointerEvent) => {
    if (x0 === null || e.pointerId !== pid) return;
    x0 = null;
    st.classList.remove('dragging');
    const thr = Math.min(110, st.clientWidth * 0.2);
    if (e.type === 'pointerup' && !moved) {
      clear();
      const card = doc.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.card');
      if (card) choose(card.dataset.side);
      return;
    }
    if (e.type === 'pointerup' && dx < -thr) choose('a');
    else if (e.type === 'pointerup' && dx > thr) choose('b');
    else clear();
  };
  st.addEventListener('pointerup', end);
  st.addEventListener('pointercancel', end);
}
function setFloat(el: HTMLElement | null, info: { text: string; cls: string }): void {
  if (!el) return;
  const side = el.classList.contains('fa') ? 'fa' : 'fb';
  el.textContent = info.text;
  el.className = `float ${side} ${info.cls}`;
}
function choose(side: string | undefined): void {
  const r = cur();
  if (busy || !r?.pair) return;
  const m = methodOf(r);
  if (m === 'sort' && side === 'draw') return;
  const [a, b] = r.pair;
  const A = getItem(r, a);
  const B = getItem(r, b);
  if (!A || !B) return;
  busy = true;
  const outcome: Outcome = side === 'a' ? 1 : side === 'b' ? 0 : 0.5;
  const C0 = compute(r);
  pushDuel(r, a, b, outcome);
  const C1 = compute(r);
  r.pair = null;
  save();
  renderList(r, true);
  const st = $('#stage');
  if (st) {
    for (const p of ['--dx', '--pa', '--pb']) st.style.removeProperty(p);
    st.classList.remove('enter', 'dragging');
    const resA = outcome === 1 ? 1 : outcome === 0 ? -1 : 0;
    setFloat($('.fa', st), deltaInfo(m, stat(C0, a), stat(C1, a), resA));
    setFloat($('.fb', st), deltaInfo(m, stat(C0, b), stat(C1, b), -resA));
    st.classList.add('picked', `pick-${side}`);
  }
  announce(
    side === 'draw' ? t('tieBetween', { a: A.label, b: B.label }) : t('wins', { x: (side === 'a' ? A : B).label }),
  );
  setTimeout(
    () => {
      busy = false;
      if (cur() === r && effTab() === 'duel') renderMain(r);
    },
    reduced ? 80 : 540,
  );
}
function skip(): void {
  const r = cur();
  if (busy || !r?.pair || methodOf(r) === 'sort') return;
  r.pair = nextPair(r, r.pair);
  save();
  renderMain(r);
}
function undoLast(): void {
  const r = cur();
  if (busy || !r) return;
  if (undoDuel(r)) {
    save();
    renderList(r, true);
    renderMain(r);
    toast(t('undone'));
  }
}

/* ---------- Results ---------- */
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
function resultsHTML(r: Ranking): string {
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
function renderMain(r: Ranking): void {
  const main = $('#main');
  if (!main) return;
  const tab = effTab();
  main.innerHTML = tab === 'results' ? resultsHTML(r) : duelHTML(r);
  if (tab === 'duel') bindStage();
  markPair(r);
}

/* ---------- Actions ---------- */
function render(): void {
  const pop = $('#cpop');
  if (pop && !pop.hidden) {
    pop.hidden = true;
    cp.id = null;
  }
  const view = $('#view');
  if (!view) return;
  if (S.route.view === 'rank') {
    const r = cur();
    if (!r) {
      S.route = { view: 'gallery', tab: 'duel' };
      render();
      return;
    }
    view.innerHTML = wsHTML(r);
    renderList(r, false);
    setTab(S.route.tab);
  } else view.innerHTML = galleryHTML();
}
function open(id: string | undefined, tab: string | undefined): void {
  if (!id) return;
  S.route = { view: 'rank', id, tab: tab === 'results' || tab === 'items' ? tab : 'duel' };
  render();
  window.scrollTo?.(0, 0);
}
function newRank(title?: string): Ranking {
  const r = mkRank(title ?? t('newRanking'));
  S.ranks.push(r);
  save();
  open(r.id, narrow.matches ? 'items' : 'duel');
  if (!title) {
    const input = $<HTMLInputElement>('#rank-title');
    input?.focus();
    input?.select();
  }
  return r;
}
async function resetRank(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  if (r.demo) return resetDemo(id);
  const ok = await ask({
    title: t('resetTitle'),
    body: t('resetBody', { duels: plural(r.history.length, 'duel'), title: r.title }),
    ok: t('restart'),
    danger: true,
  });
  if (!ok) return;
  r.history = [];
  r.pair = null;
  r.updated = Date.now();
  save();
  render();
  toast(t('resetDone'));
}
async function resetDemo(id: string | undefined): Promise<void> {
  const d = DEMOS.find((x) => x.id === id);
  if (!d) return;
  const ok = await ask({ title: t('resetDemoTitle'), body: t('resetDemoBody'), ok: t('reset') });
  if (!ok) return;
  const i = S.ranks.findIndex((r) => r.id === id);
  const fresh = buildDemo(d, getLang());
  if (i >= 0) S.ranks[i] = fresh;
  else S.ranks.push(fresh);
  save();
  render();
  toast(t('demoReset'));
}
function duplicateRank(id: string | undefined): void {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const c = mkRank(`${r.title} ${t('copySuffix')}`, methodOf(r));
  c.items = r.items.map((it) => ({ ...structuredClone(it), id: uid() }));
  S.ranks.push(c);
  save();
  open(c.id, 'duel');
  toast(t('copyCreated'));
}
function toggleDemos(): void {
  S.prefs.hideDemos = !S.prefs.hideDemos;
  savePrefs(S.prefs);
  render();
}
function changeLang(l: string | undefined): void {
  const from = getLang();
  if (!isLang(l) || l === from) return;
  relabelDemos(S.ranks, from, l);
  setI18nLang(l);
  S.prefs.lang = l;
  savePrefs(S.prefs);
  save();
  applyStatic();
  render();
}
async function deleteRank(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const ok = await ask({
    title: t('deleteTitle'),
    body: t('deleteBody', { title: r.title, items: plural(r.items.length, 'item') }),
    ok: t('deleteOk'),
    danger: true,
  });
  if (!ok) return;
  S.ranks = S.ranks.filter((x) => x.id !== id);
  save();
  if (S.route.id === id) S.route = { view: 'gallery', tab: 'duel' };
  render();
  toast(t('deleted'));
}
function afterItemsChange(r: Ranking, prevCount: number): void {
  save();
  renderList(r, true);
  if (effTab() === 'results' || prevCount < 2 || !r.pair || methodOf(r) === 'sort') renderMain(r);
}
function addLabels(r: Ranking, labels: string[]): number {
  const clean = labels
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (!clean.length) return 0;
  const prev = r.items.length;
  for (const l of clean) {
    r.items.push(
      isHex(l) ? mkItem(normHex(l).toUpperCase(), null, { type: 'solid', colors: [normHex(l)] }) : mkItem(l),
    );
  }
  r.updated = Date.now();
  afterItemsChange(r, prev);
  return clean.length;
}
function addColor(): void {
  const r = cur();
  const c1 = $<HTMLInputElement>('#c1');
  const c2 = $<HTMLInputElement>('#c2');
  const g = $<HTMLInputElement>('#c-grad');
  if (!r || !c1 || !c2 || !g) return;
  const fill: Fill = g.checked
    ? { type: 'gradient', colors: [c1.value, c2.value] }
    : { type: 'solid', colors: [c1.value] };
  const prev = r.items.length;
  r.items.push(mkItem(fillCode(fill), null, fill));
  r.updated = Date.now();
  afterItemsChange(r, prev);
  const h = Math.floor(Math.random() * 360);
  c1.value = hslToHex(h, 72, 52);
  c2.value = hslToHex(h + 110, 72, 52);
}
function fileToThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 640;
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = doc.createElement('canvas');
        c.width = Math.round(img.width * sc);
        c.height = Math.round(img.height * sc);
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = String(fr.result);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
async function addFiles(r: Ranking, files: FileList | File[]): Promise<void> {
  const imgs = [...files].filter((f) => f.type?.startsWith('image/'));
  if (!imgs.length) {
    toast(t('onlyImages'));
    return;
  }
  const prev = r.items.length;
  let n = 0;
  for (const f of imgs.slice(0, 60)) {
    try {
      const data = await fileToThumb(f);
      const name =
        (f.name || 'Image')
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .trim() || 'Image';
      r.items.push(mkItem(name.charAt(0).toUpperCase() + name.slice(1), data));
      n++;
    } catch {
      /* unreadable file: skip it */
    }
  }
  r.updated = Date.now();
  if (cur() === r) afterItemsChange(r, prev);
  else save();
  toast(n ? t('imagesAdded', { images: plural(n, 'image'), n }) : t('cantRead'));
}
function removeItem(id: string | undefined): void {
  const r = cur();
  if (!r || !id) return;
  if (cp.id === id) closeColor();
  const prev = r.items.length;
  r.items = r.items.filter((i) => i.id !== id);
  if (r.pair?.includes(id)) r.pair = null;
  r.updated = Date.now();
  afterItemsChange(r, prev);
}
function copyRanking(): void {
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

/* ---------- Events ---------- */
function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const mpop = $('#method-pop');
  if (mpop && !mpop.hidden && !target.closest('.method-wrap')) toggleMethodMenu(false);
  const cpop = $('#cpop');
  if (cpop && !cpop.hidden && !target.closest('#cpop') && !target.closest('.thumb-btn')) closeColor();
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const id = el.dataset.id;
  const action = el.dataset.action ?? '';
  if (action.startsWith('cp-')) {
    cpAction(action, el);
    return;
  }
  switch (action) {
    case 'new-rank':
      newRank();
      break;
    case 'open':
      open(id, el.dataset.tab);
      break;
    case 'back':
      if (S.route.view !== 'gallery') {
        S.route = { view: 'gallery', tab: 'duel' };
        render();
        window.scrollTo?.(0, 0);
      }
      break;
    case 'tab': {
      const tab = el.dataset.tab;
      setTab(tab === 'items' || tab === 'results' ? tab : 'duel');
      if (tab === 'items') setTimeout(() => $('#add-input')?.focus(), 30);
      break;
    }
    case 'lang':
      changeLang(el.dataset.l);
      break;
    case 'theme':
      changeTheme(el.dataset.t);
      break;
    case 'method-menu':
      toggleMethodMenu();
      break;
    case 'set-method':
      setMethod(el.dataset.m);
      break;
    case 'edit-color':
      if (id && cp.id === id && cpop && !cpop.hidden) closeColor();
      else if (id) openColor(id, el);
      break;
    case 'reset':
      void resetRank(id);
      break;
    case 'reset-demo':
      void resetDemo(id);
      break;
    case 'duplicate':
      duplicateRank(id);
      break;
    case 'toggle-demos':
      toggleDemos();
      break;
    case 'add-color':
      addColor();
      break;
    case 'delete':
      void deleteRank(id);
      break;
    case 'remove-item':
      removeItem(id);
      break;
    case 'pick':
      choose(el.dataset.side);
      break;
    case 'skip':
      skip();
      break;
    case 'undo':
      undoLast();
      break;
    case 'copy':
      copyRanking();
      break;
    case 'pick-files':
      $('#file-input')?.click();
      break;
  }
}
function onInput(e: Event): void {
  const tg = e.target as HTMLInputElement;
  if (tg.id === 'rank-title') {
    const r = cur();
    if (r) {
      r.title = tg.value.trim() || t('untitled');
      r.updated = Date.now();
      save();
    }
    return;
  }
  if (tg.classList.contains('cp-color')) {
    setStop(Number(tg.dataset.i), tg.value, false);
    return;
  }
  if (tg.classList.contains('cp-hex')) {
    const v = tg.value.trim().startsWith('#') ? tg.value.trim() : `#${tg.value.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      const err = $('#cp-err');
      if (err) err.hidden = true;
      setStop(Number(tg.dataset.i), v, false);
    }
  }
}
function onChange(e: Event): void {
  const tg = e.target as HTMLInputElement;
  const r = cur();
  if (!r) return;
  if (tg.classList.contains('cp-color')) {
    setStop(Number(tg.dataset.i), tg.value, true);
    return;
  }
  if (tg.classList.contains('cp-hex')) {
    const i = Number(tg.dataset.i);
    const v = tg.value.trim().startsWith('#') ? tg.value.trim() : `#${tg.value.trim()}`;
    const err = $('#cp-err');
    if (isHex(v)) {
      if (err) err.hidden = true;
      setStop(i, v, true);
      tg.value = normHex(v).toUpperCase();
    } else {
      if (err) err.hidden = false;
      const c = cpItem()?.fill?.colors[i];
      if (c) tg.value = normHex(c).toUpperCase();
    }
    return;
  }
  if (tg.id === 'c-grad') {
    const c2 = $('#c2');
    if (c2) c2.hidden = !tg.checked;
    return;
  }
  if (tg.id === 'file-input') {
    if (tg.files) void addFiles(r, [...tg.files]);
    tg.value = '';
    return;
  }
  if (tg.classList.contains('row-label')) {
    const it = tg.dataset.id ? getItem(r, tg.dataset.id) : undefined;
    if (!it) return;
    const v = tg.value.trim();
    if (!v) {
      tg.value = it.label;
      return;
    }
    it.label = v;
    r.updated = Date.now();
    save();
    if (cp.id === it.id) cp.follow = false;
    if (effTab() === 'results' || r.pair?.includes(it.id)) renderMain(r);
  }
}
function onKeydown(e: KeyboardEvent): void {
  const modal = $('#modal');
  if (modal && !modal.hidden) {
    if (e.key === 'Escape') closeModal(false);
    return;
  }
  const tg = e.target as HTMLElement;
  const cpop = $('#cpop');
  if (cpop && !cpop.hidden) {
    if (e.key === 'Enter' && tg.classList.contains('cp-hex')) {
      tg.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (e.key === 'Escape') {
      closeColor();
      return;
    }
    if (tg.closest('#cpop')) return;
  }
  const mpop = $('#method-pop');
  if (mpop && !mpop.hidden) {
    if (e.key === 'Escape') {
      toggleMethodMenu(false);
      $('#method-btn')?.focus();
    }
    return;
  }
  if (tg.id === 'rank-title' && e.key === 'Enter') {
    e.preventDefault();
    if (narrow.matches) setTab('items');
    $('#add-input')?.focus();
    return;
  }
  if (tg.classList.contains('row-label') && e.key === 'Enter') {
    tg.blur();
    return;
  }
  const r = cur();
  if (!r || effTab() !== 'duel') return;
  if (tg.classList.contains('card') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    choose(tg.dataset.side);
    return;
  }
  if (tg.matches('input, textarea, [contenteditable]')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoLast();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    choose('a');
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    choose('b');
  } else if (e.key === 'ArrowDown' || e.key === '=') {
    e.preventDefault();
    choose('draw');
  } else if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    skip();
  }
}
function onPaste(e: ClipboardEvent): void {
  const r = cur();
  const tg = e.target as HTMLElement;
  if (!r || !e.clipboardData || tg.closest?.('#cpop')) return;
  const files = [...(e.clipboardData.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    void addFiles(r, files);
    return;
  }
  if (tg.id === 'add-input') {
    const txt = e.clipboardData.getData('text/plain') || '';
    if (/\n/.test(txt.trim())) {
      e.preventDefault();
      const n = addLabels(r, txt.split(/\r?\n/));
      if (n) toast(t('itemsAdded', { items: plural(n, 'item'), n }));
    }
  }
}
const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes('Files');

function bindEvents(): void {
  doc.addEventListener('click', onClick);
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onChange);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('paste', onPaste);
  doc.addEventListener('submit', (e) => {
    if ((e.target as HTMLElement).id !== 'add-form') return;
    e.preventDefault();
    const r = cur();
    const input = $<HTMLInputElement>('#add-input');
    if (!r || !input) return;
    if (addLabels(r, [input.value])) input.value = '';
    input.focus();
  });
  doc.addEventListener('focusin', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.matches?.('#cpop input[data-i]')) setActiveStop(Number(tg.dataset.i));
  });
  doc.addEventListener('focusout', (e) => {
    const tg = e.target as HTMLInputElement;
    if (tg.id === 'rank-title' && !tg.value.trim()) tg.value = t('untitled');
  });
  let dragDepth = 0;
  doc.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    doc.body.classList.add('dropping');
  });
  doc.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  doc.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) doc.body.classList.remove('dropping');
  });
  doc.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    doc.body.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    const date = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    const r = cur() ?? newRank(t('imagesRankTitle', { date }));
    void addFiles(r, files);
  });
  doc.addEventListener(
    'scroll',
    (e) => {
      if ((e.target as HTMLElement | null)?.id === 'item-list') placeColor();
    },
    true,
  );
  window.addEventListener('resize', placeColor);
  narrow.addEventListener('change', () => {
    if (cur()) setTab(S.route.tab);
    placeColor();
  });
  $('#m-ok')?.addEventListener('click', () => closeModal(true));
  $('#m-cancel')?.addEventListener('click', () => closeModal(false));
  $('#modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal') closeModal(false);
  });
}

/** Loads saved data (or migrates prototype data), adds the demos and renders the gallery. */
export function mount(d: Document): void {
  doc = d;
  narrow = media('(max-width: 859px)');
  reduced = media('(prefers-reduced-motion: reduce)').matches;
  S.prefs = loadPrefs();
  const lang: Lang = detectLang(S.prefs.lang, navigator.language);
  setI18nLang(lang);
  S.ranks = loadRanks() ?? loadLegacyRanks();
  for (const demo of DEMOS) {
    if (!S.ranks.some((r) => r.id === demo.id)) S.ranks.push(buildDemo(demo, lang));
  }
  relabelDemos(S.ranks, lang === 'fr' ? 'en' : 'fr', lang);
  save();
  bindEvents();
  applyStatic();
  render();
}
