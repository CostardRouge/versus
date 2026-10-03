import { fillCode, fillCSS, hslToHex, isHex, normHex } from '../core/colors';
import { parseList } from '../core/list';
import { LABEL_MAX } from '../core/model';
import type { Fill, Item } from '../core/types';
import { esc } from '../core/util';
import { plural, t } from '../i18n';
import { $, $$, ask, doc, imgSvg, reduced, thumbHTML, toast } from './dom';

/**
 * The item editor every ranking shares (D116): the add field (a name, a pasted list, a #hex code), images and
 * colors, and the list whose names are edited in place. A local ranking and a published board's author get the
 * same pane (`items.ts`, `author.ts`); a visitor suggesting an item gets the same field. Only what each may do,
 * and what a change costs (votes on a published board), differ.
 */

/**
 * Who fills the pane on screen and takes its edits: a local ranking (`localHost`, items.ts), where they apply at
 * once, or a published board's author (`authorHost`, author.ts), where they go through the server. The workspace
 * picks one (`itemsHost`, workspace.ts); the delegated listeners (events.ts) hand every edit to it.
 */
export interface ItemsHost {
  /** What was sent from the add field: one item, or every new label of a list. */
  add(input: HTMLInputElement): void;
  /** A list pasted or dropped in the add field; false when the text isn't one, for the field to take it. */
  addList(text: string): boolean;
  /** The color picked beside the add field. */
  addColor(): void;
  /** Images dropped, pasted or chosen. */
  addFiles(files: File[]): void;
  remove(id: string | undefined): void;
  /** A name edited in the list. */
  rename(input: HTMLInputElement): void;
  /** A color item's swatch: opens the color editor on it, or closes it. */
  recolor(id: string | undefined, anchor: HTMLElement): void;
  /** A scoring method picked in the score menu. */
  setMethod(k: string | undefined): void;
  /** Draws the main pane for the tab on screen: the duel or the results. */
  renderMain(): void;
}

/** What adding a list came to, with a way to undo it: "N items added", and the duplicates left out. */
export function addedToast(n: number, dupes: number, undo: () => void): void {
  const items = plural(n, 'item');
  const msg = dupes
    ? t('itemsAddedDupes', { items, n, dupes: plural(dupes, 'duplicate'), d: dupes })
    : t('itemsAdded', { items, n });
  toast(msg, { label: t('undoToast'), run: undo });
}

/** The add field: a name, a list (typed, pasted or dropped) or a #hex code. One per page. */
export const addFormHTML = (placeholder: string, label: string, disabled = false): string =>
  `<form id="add-form" class="add" autocomplete="off">
    <input id="add-input" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" maxlength="${LABEL_MAX}" ${disabled ? 'disabled' : ''}>
    <button class="add-btn" type="submit" aria-label="${t('add')}" ${disabled ? 'disabled' : ''}>+</button>
  </form>`;

export interface PaneSpec {
  /** Why nothing can change right now (a closed vote), with what to do: the list is then read-only. */
  frozen?: string;
  /** Whether images can be added (a board only takes them when the server reviews pictures). */
  images: boolean;
  foot: string;
}

/** The items pane: heading, add field, images and colors, the list (filled by `listHTML`) and a word of help. */
export function paneHTML(p: PaneSpec): string {
  const tools = p.frozen
    ? `<div class="ed-frozen" role="note">${p.frozen}</div>`
    : `${addFormHTML(t('addPlaceholder'), t('itemNameAria'))}
      ${p.images ? `<button class="drop" type="button" data-action="pick-files">${imgSvg}<span>${t('imagesDrop')}</span></button><input type="file" id="file-input" accept="image/*" multiple hidden>` : ''}
      <div class="add-color">
        <input type="color" id="c1" value="#2743f5" aria-label="${t('colorAria')}">
        <input type="color" id="c2" value="#e4492a" aria-label="${t('color2Aria')}" hidden>
        <label class="grad-toggle" for="c-grad"><input type="checkbox" id="c-grad"> ${t('gradient')}</label>
        <button class="btn sm" type="button" data-action="add-color">${t('addColor')}</button>
      </div>`;
  return `<div class="aside-head"><h2>${t('itemsTitle')}</h2><span class="mono muted" id="aside-count"></span></div>
    ${tools}
    <ol class="list" id="item-list"></ol>
    <p class="aside-foot">${p.foot}</p>`;
}

/** One line of the list. */
export interface Row {
  it: Item;
  pos: string;
  /** Right of the name: a score, or how many votes the item has on a published board. */
  meta: string;
  metaTitle?: string;
  dim?: boolean;
  /** Places gained (positive) or lost since the last duel. */
  moved?: number;
  /** A word under the name: a picture under review, another item of the same color; with what to do about it. */
  note?: { text: string; bad?: boolean; action?: { name: string; label: string; aria: string } };
}

function swatchHTML(it: Item, editable: boolean): string {
  if (!it.fill || !editable) return thumbHTML(it);
  return `<button class="thumb thumb-btn" type="button" data-action="edit-color" data-id="${esc(it.id)}" style="background:${fillCSS(it.fill)}" aria-label="${esc(t('editColorAria', { label: it.label }))}" title="${t('editColor')}"></button>`;
}

const rtClass = (row: Row): string => `rt mono ${row.dim ? 'dim' : ''}`;
const dlClass = (moved: number): string => `dl mono ${moved > 0 ? 'up' : moved < 0 ? 'down' : ''}`;
const dlText = (moved: number): string => (moved > 0 ? `↑${moved}` : moved < 0 ? `↓${-moved}` : '');

const noteActionHTML = ({ it, note }: Row): string =>
  note?.action
    ? ` <button class="link row-act" type="button" data-action="${note.action.name}" data-id="${esc(it.id)}" aria-label="${esc(note.action.aria)}">${esc(note.action.label)}</button>`
    : '';

function rowHTML(row: Row, editable: boolean): string {
  const { it, moved = 0 } = row;
  const name = editable
    ? `<input class="row-label" data-id="${esc(it.id)}" value="${esc(it.label)}" aria-label="${esc(t('renameAria', { label: it.label }))}" maxlength="${LABEL_MAX}">`
    : `<span class="row-text">${esc(it.label)}</span>`;
  const label = row.note
    ? `<span class="row-main">${name}<small class="row-note ${row.note.bad ? 'bad' : ''}">${esc(row.note.text)}${noteActionHTML(row)}</small></span>`
    : name;
  const remove = editable
    ? `<button class="rm" type="button" data-action="remove-item" data-id="${esc(it.id)}" aria-label="${esc(t('removeAria', { label: it.label }))}">×</button>`
    : '<span></span>';
  return `<li data-id="${esc(it.id)}">
      <span class="pos mono">${row.pos}</span>
      ${swatchHTML(it, editable)}
      ${label}
      <span class="${rtClass(row)}" ${row.metaTitle ? `title="${esc(row.metaTitle)}"` : ''}>${row.meta}</span>
      <span class="${dlClass(moved)}">${dlText(moved)}</span>
      ${remove}
    </li>`;
}

/** What a row was drawn with, apart from what changes at every duel (its place, score and move). */
interface Drawn {
  it: Item;
  label: string;
  img: string | null;
  fill: string;
  note: string;
  editable: boolean;
}

const drawn = new WeakMap<Element, Drawn>();

const drawnOf = (row: Row, editable: boolean): Drawn => ({
  it: row.it,
  label: row.it.label,
  img: row.it.img,
  fill: row.it.fill ? `${row.it.fill.type}:${row.it.fill.colors.join(',')}` : '',
  note: row.note ? `${row.note.bad ? '!' : ''}${row.note.text}${row.note.action?.name ?? ''}` : '',
  editable,
});

/** True when the row's picture, name, color and note are as drawn: only its place, score and move need patching. */
const unchanged = (a: Drawn | undefined, b: Drawn): boolean =>
  !!a &&
  a.it.id === b.it.id &&
  a.label === b.label &&
  a.img === b.img &&
  a.fill === b.fill &&
  a.note === b.note &&
  a.editable === b.editable;

function patchRow(li: Element, row: Row): void {
  const pos = $('.pos', li);
  if (pos && pos.textContent !== row.pos) pos.textContent = row.pos;
  const rt = $('.rt', li);
  if (rt) {
    if (rt.innerHTML !== row.meta) rt.innerHTML = row.meta;
    rt.className = rtClass(row);
    if (row.metaTitle) rt.title = row.metaTitle;
    else rt.removeAttribute('title');
  }
  const dl = $('.dl', li);
  const moved = row.moved ?? 0;
  if (dl) {
    dl.className = dlClass(moved);
    dl.textContent = dlText(moved);
  }
}

function rowElement(row: Row, editable: boolean): Element {
  const tpl = doc.createElement('template');
  tpl.innerHTML = rowHTML(row, editable);
  const li = tpl.content.firstElementChild as Element;
  drawn.set(li, drawnOf(row, editable));
  return li;
}

/**
 * Fills the list, rows sliding from their old place to the new one (none under reduced motion); a row that
 * wasn't there pops in. Rows already on screen are kept and patched (their place, score and move): a duel no
 * longer rebuilds every row, its pictures and its name fields. A row is drawn again only when its content changed.
 */
export function renderRows(rows: readonly Row[], editable: boolean, animate: boolean): void {
  const ul = $('#item-list');
  if (!ul) return;
  const count = $('#aside-count');
  if (count) count.textContent = plural(rows.length, 'item');
  const n = $('#n-items');
  if (n) n.textContent = String(rows.length);
  if (!rows.length) {
    ul.innerHTML = `<li class="empty">${t('emptyList')}</li>`;
    return;
  }
  const old = new Map<string, Element>();
  for (const li of $$('li[data-id]', ul)) old.set(li.dataset.id ?? '', li);
  // Positions are read (a layout) only when rows will move: live counts on a board leave the order as it is.
  const moves = animate && !reduced && [...old.keys()].join('\n') !== rows.map((r) => r.it.id).join('\n');
  const before = new Map<Element, number>();
  if (moves) for (const li of old.values()) before.set(li, li.getBoundingClientRect().top);
  for (const li of $$('li:not([data-id])', ul)) li.remove();
  const lis = rows.map((row) => {
    const li = old.get(row.it.id);
    old.delete(row.it.id);
    if (li && unchanged(drawn.get(li), drawnOf(row, editable))) {
      patchRow(li, row);
      return li;
    }
    const fresh = rowElement(row, editable);
    // A name being typed in is kept: only another name from elsewhere replaces it.
    li?.replaceWith(fresh);
    if (li && before.has(li)) before.set(fresh, before.get(li) as number);
    return fresh;
  });
  for (const li of old.values()) li.remove();
  // Only rows out of place move: a focused field stays where it is unless its row moves.
  lis.forEach((li, i) => {
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] ?? null);
  });
  if (!moves) return;
  for (const li of lis) {
    const b = before.get(li);
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

/** A new item's content: its label, and its fill when it is a color. */
export interface Typed {
  label: string;
  fill: Fill | null;
}

/** A label as an item: a #hex code becomes a color, named after its code. */
export function typed(label: string): Typed {
  const v = label.trim();
  if (!isHex(v)) return { label: v, fill: null };
  return { label: normHex(v).toUpperCase(), fill: { type: 'solid', colors: [normHex(v)] } };
}

/** What was typed or pasted in the add field, as items: one per label of a list (core/list.ts). */
export const typedItems = (text: string): Typed[] => parseList(text).map(typed);

/** The color picked beside the add field, solid or gradient; the pickers then offer a new color. */
export function takeColor(): Typed | null {
  const c1 = $<HTMLInputElement>('#c1');
  const c2 = $<HTMLInputElement>('#c2');
  const g = $<HTMLInputElement>('#c-grad');
  if (!c1 || !c2 || !g) return null;
  const fill: Fill = g.checked
    ? { type: 'gradient', colors: [c1.value, c2.value] }
    : { type: 'solid', colors: [c1.value] };
  const h = Math.floor(Math.random() * 360);
  c1.value = hslToHex(h, 72, 52);
  c2.value = hslToHex(h + 110, 72, 52);
  return { label: fillCode(fill), fill };
}

/** An image file as the app keeps it: at most 640 px, JPEG 0.82, as a data URL. */
export function fileToThumb(file: File): Promise<string> {
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
        // A canvas the browser refuses to read back (SecurityError) must not leave the import waiting forever.
        try {
          resolve(c.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = String(fr.result);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/** An image's label, from its file name: "beach_day-2.jpg" becomes "Beach day 2". */
export function imageName(file: File): string {
  const name =
    (file.name || 'Image')
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim() || 'Image';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The image files among dropped or pasted files. */
export const imageFiles = (files: FileList | File[]): File[] => [...files].filter((f) => f.type?.startsWith('image/'));

export type VotesChoice = 'keep' | 'reset';

/**
 * What an edit does to an item's votes on a published board (D116): keep them (a correction, the same choice) or
 * start the item again from zero (another choice). `reset` is the answer checked first. Null when cancelled.
 */
export async function askVotes(o: {
  title: string;
  body: string;
  ok: string;
  reset: boolean;
}): Promise<VotesChoice | null> {
  const choice = (v: VotesChoice, title: string, text: string) =>
    `<label class="opt votes-opt"><input type="radio" name="votes-choice" value="${v}" ${(v === 'reset') === o.reset ? 'checked' : ''}><span><b>${esc(title)}</b><small>${esc(text)}</small></span></label>`;
  const html = `<p>${esc(o.body)}</p>
    <fieldset class="set votes-set"><legend class="sr-only">${t('votesChoice')}</legend>
      ${choice('keep', t('keepVotes'), t('keepVotesBody'))}
      ${choice('reset', t('resetVotes'), t('resetVotesBody'))}
    </fieldset>`;
  if (!(await ask({ title: o.title, html, ok: o.ok }))) return null;
  return $<HTMLInputElement>('#m-body input[name="votes-choice"]:checked')?.value === 'reset' ? 'reset' : 'keep';
}
