import { fillCode, fillCSS, fillInk, harmonies, hexToHsl, hslToHex, isHex, normHex, PRESETS } from '../core/colors';
import { getItem } from '../core/model';
import type { Fill, Item } from '../core/types';
import { t } from '../i18n';
import { $, $$, doc, narrow } from './dom';
import { cardHTML } from './duel';
import { cur, save } from './state';
import { effTab, renderMain, toggleMethodMenu } from './workspace';

/** Color editor popover for color items: solid or gradient, stops, hex fields, harmonies and presets. */

export const cp: { id: string | null; active: number; follow: boolean; anchor: HTMLElement | null } = {
  id: null,
  active: 0,
  follow: false,
  anchor: null,
};

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
export function openColor(id: string, anchor: HTMLElement): void {
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
export function placeColor(): void {
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
export function closeColor(): void {
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
export function setActiveStop(i: number): void {
  cp.active = i;
  for (const s of $$('#cpop .cp-stop')) s.classList.toggle('on', Number(s.dataset.i) === i);
  const it = cpItem();
  const sw = $('#cp-swatches');
  const c = it?.fill?.colors[i];
  if (c && sw) sw.innerHTML = swatchesHTML(c);
}
export function cpAction(action: string, el: HTMLElement): void {
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

/** Live edits in the popover fields (input events). Returns true when the field belongs to the popover. */
export function colorInput(tg: HTMLInputElement): boolean {
  if (tg.classList.contains('cp-color')) {
    setStop(Number(tg.dataset.i), tg.value, false);
    return true;
  }
  if (tg.classList.contains('cp-hex')) {
    const v = tg.value.trim().startsWith('#') ? tg.value.trim() : `#${tg.value.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      const err = $('#cp-err');
      if (err) err.hidden = true;
      setStop(Number(tg.dataset.i), v, false);
    }
    return true;
  }
  return false;
}

/** Committed edits in the popover fields (change events): an invalid hex code is reverted with a message. */
export function colorChange(tg: HTMLInputElement): boolean {
  if (tg.classList.contains('cp-color')) {
    setStop(Number(tg.dataset.i), tg.value, true);
    return true;
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
    return true;
  }
  return false;
}
