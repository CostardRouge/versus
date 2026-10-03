import { fillCode, fillCSS, fillText } from '../core/colors';
import { getItem } from '../core/model';
import {
  compute,
  ensurePair,
  expected,
  finishedBy,
  methodOf,
  nextPair,
  pushDuel,
  remaining,
  stability,
  undoDuel,
} from '../core/scoring';
import type { Computed, Item, Outcome, Ranking } from '../core/types';
import { esc, sizeClass } from '../core/util';
import { methodText as M, pct, plural, t } from '../i18n';
import { $, announce, doc, focusOn, keepFocus, reduced, toast } from './dom';
import { clearEnding, endingHTML, endingOf, startEnding } from './ending';
import { deltaInfo } from './format';
import { renderList } from './items';
import { cur, save, stat } from './state';
import { effTab, renderMain, setTab } from './workspace';

/** Duel stage: cards, swipe and tap, picks with score deltas, skip, undo and keyboard shortcuts. */

/** True while a pick animates, so a second pick can't land on the same pair. */
let busy = false;

export function cardHTML(it: Item, side: 'a' | 'b'): string {
  const label = esc(it.label);
  let inner: string;
  if (it.fill) {
    const code = fillCode(it.fill);
    inner = `<span class="fillbg" style="background:${fillCSS(it.fill)}"></span><span class="cap" style="${fillText(it.fill)}">${label}${it.label.toUpperCase() !== code ? `<small>${code}</small>` : ''}</span>`;
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
export function duelHTML(r: Ranking): string {
  if (r.items.length < 2) return emptyDuelHTML();
  const C = compute(r);
  if (endingOf(r)) return endingHTML(r, C.n);
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
/** Swipe and tap on the stage. The board page reuses it with its own pick and busy state. */
export function bindStage(pick: (side: string | undefined) => void = choose, isBusy = (): boolean => busy): void {
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
    if (isBusy() || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
      if (card) pick(card.dataset.side);
      return;
    }
    if (e.type === 'pointerup' && dx < -thr) pick('a');
    else if (e.type === 'pointerup' && dx > thr) pick('b');
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
export function choose(side: string | undefined): void {
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
  const done = finishedBy(r, C0, C1);
  if (done) startEnding(r, done);
  // The next pair is drawn now, so that one write keeps both the duel and the duel a reload shows.
  r.pair = null;
  if (!done) ensurePair(r, C1);
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
  // The next duel takes the place of this one: a focused card or button is focused again on the new pair.
  setTimeout(
    () => {
      busy = false;
      if (cur() === r && effTab() === 'duel') keepFocus(() => renderMain(r));
    },
    reduced ? 80 : 540,
  );
}
export function skip(): void {
  const r = cur();
  if (busy || !r?.pair || methodOf(r) === 'sort') return;
  r.pair = nextPair(r, r.pair);
  save();
  keepFocus(() => renderMain(r));
}
export function undoLast(): void {
  const r = cur();
  if (busy || !r) return;
  if (undoDuel(r)) {
    clearEnding();
    save();
    renderList(r, true);
    // Nothing left to undo: the link is disabled, the focus goes to the duel's first card.
    keepFocus(
      () => renderMain(r),
      () => $('#stage .card-a'),
    );
    toast(t('undone'));
  }
}

/** The announcement's buttons: go to the ranking, or keep dueling. The focus follows to the new view. */
export function endSee(): void {
  clearEnding();
  setTab('results');
  $('.results')?.classList.add('res-enter');
  $('#tab-results')?.focus();
}
export function endContinue(): void {
  const r = cur();
  clearEnding();
  if (r) renderMain(r);
  focusOn($('.duel .q'));
}

/** Duel shortcuts: ← and → pick, ↓ or = ties, S skips, ⌘/Ctrl+Z undoes. */
export function duelKeydown(e: KeyboardEvent, tg: HTMLElement): void {
  const r = cur();
  if (!r || effTab() !== 'duel' || endingOf(r)) return;
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
