import { freshLabels, labelKey, parseList } from '../core/list';
import { ADD_MAX, getItem, IMAGES_MAX, mkItem } from '../core/model';
import { compute, methodOf } from '../core/scoring';
import type { Item, Ranking } from '../core/types';
import { methodText as M, plural, t } from '../i18n';
import { closeColor, editingColor, keepName, toggleColor } from './color';
import { $, $$, doc, keepFocus, toast } from './dom';
import {
  addedToast,
  fileToThumb,
  type ItemsHost,
  imageFiles,
  imageName,
  type Row,
  renderRows,
  type Typed,
  takeColor,
  typed,
} from './editor';
import { fmtScore } from './format';
import { cur, S, save, stat } from './state';
import { effTab, renderMain, setRankMethod } from './workspace';

/** A local ranking's items in the shared editor (editor.ts): live-sorted list, and edits that apply at once. */

export function renderList(r: Ranking, animate: boolean): void {
  const C = compute(r);
  const m = C.m;
  const P = r.history.length ? compute(r, r.history.length - 1) : null;
  const rows: Row[] = C.order.map((it, i) => {
    const s = stat(C, it.id);
    const prev = P?.st[it.id];
    return {
      it,
      pos: m === 'sort' && !s.placed ? '·' : String(i + 1),
      meta: m === 'sort' ? (s.placed ? '' : t('toPlace')) : fmtScore(m, s),
      metaTitle: M(m).col,
      dim: !(s.games && s.placed),
      moved: prev ? prev.pos - s.pos : 0,
    };
  });
  renderRows(rows, true, animate);
  markPair(r);
}
export function markPair(r: Ranking): void {
  const p = r.pair;
  for (const li of $$('#item-list li[data-id]')) {
    li.classList.toggle('in-a', !!p && li.dataset.id === p[0]);
    li.classList.toggle('in-b', !!p && li.dataset.id === p[1]);
  }
}
function afterItemsChange(r: Ranking, prevCount: number): void {
  save();
  renderList(r, true);
  if (effTab() === 'results' || prevCount < 2 || !r.pair || methodOf(r) === 'sort') renderMain(r);
}
function addItems(r: Ranking, items: Typed[]): Item[] {
  const clean = items.filter((x) => x.label || x.fill).slice(0, ADD_MAX);
  if (!clean.length) return [];
  const prev = r.items.length;
  const added = clean.map((x) => mkItem(x.label, null, x.fill));
  r.items.push(...added);
  r.updated = Date.now();
  afterItemsChange(r, prev);
  return added;
}
/**
 * A list typed or pasted in the add field (core/list.ts): adds its labels not in the ranking yet, with a toast
 * that can undo. False when the text isn't a list, for the field to take it as one label.
 */
function addList(r: Ranking, text: string): boolean {
  const labels = parseList(text);
  if (labels.length < 2) return false;
  const { fresh, dupes } = freshLabels(
    labels,
    r.items.map((i) => i.label),
  );
  const added = addItems(r, fresh.map(typed));
  if (!added.length) {
    toast(t('allDupes'));
    return true;
  }
  const ids = new Set(added.map((i) => i.id));
  addedToast(added.length, dupes, () => dropItems(r, ids));
  return true;
}
/** What was typed in the add field and sent: a list, or one item. False when there was nothing to add. */
function addTyped(r: Ranking, text: string): boolean {
  return addList(r, text) || addItems(r, parseList(text).map(typed)).length > 0;
}
function addColor(r: Ranking): void {
  const color = takeColor();
  if (color) addItems(r, [color]);
}
export async function addFiles(r: Ranking, files: FileList | File[]): Promise<void> {
  const imgs = imageFiles(files);
  if (!imgs.length) {
    toast(t('onlyImages'));
    return;
  }
  const prev = r.items.length;
  let n = 0;
  for (const f of imgs.slice(0, IMAGES_MAX)) {
    try {
      r.items.push(mkItem(imageName(f), await fileToThumb(f)));
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
function dropItems(r: Ranking, ids: Set<string>): void {
  const editing = editingColor();
  if (editing && ids.has(editing)) closeColor();
  const prev = r.items.length;
  r.items = r.items.filter((i) => !ids.has(i.id));
  if (r.pair?.some((id) => ids.has(id))) r.pair = null;
  r.updated = Date.now();
  if (cur() === r) afterItemsChange(r, prev);
  else save();
}
/** The name field of a row of the list. */
const nameField = (id: string | undefined): HTMLElement | null =>
  id ? $(`#item-list .row-label[data-id="${id}"]`) : null;

/**
 * Removes an item at once; Undo puts it back in its place with its id, so its duels count again. The focus goes
 * on to the next row's name (the previous one at the end), or to the add field once the list is empty.
 */
function removeItem(id: string | undefined): void {
  const r = cur();
  const at = r && id ? r.items.findIndex((i) => i.id === id) : -1;
  const it = r?.items[at];
  if (!r || !it) return;
  const row = $(`#item-list li[data-id="${it.id}"]`);
  const next = (row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null | undefined;
  keepFocus(
    () => dropItems(r, new Set([it.id])),
    () => nameField(next?.dataset.id) ?? $('#add-input'),
  );
  toast(t('itemRemovedNamed', { label: it.label }), {
    label: t('undoToast'),
    run: () => {
      if (!S.ranks.includes(r) || getItem(r, it.id)) return;
      const prev = r.items.length;
      r.items.splice(Math.min(at, prev), 0, it);
      r.updated = Date.now();
      if (cur() !== r) {
        save();
        return;
      }
      afterItemsChange(r, prev);
      // Put back where the focus can find it (the toast's button is gone).
      if (doc.activeElement === doc.body) nameField(it.id)?.focus();
    },
  });
}

/** Commits a label edited in the side list; an empty label, or another item's, is reverted. */
function renameItem(r: Ranking, input: HTMLInputElement): void {
  const it = input.dataset.id ? getItem(r, input.dataset.id) : undefined;
  if (!it) return;
  const v = input.value.trim();
  const key = labelKey(v);
  if (!v || r.items.some((o) => o !== it && labelKey(o.label) === key)) {
    if (v && v !== it.label) toast(t('itemExists'));
    input.value = it.label;
    return;
  }
  it.label = v;
  r.updated = Date.now();
  save();
  keepName(it.id);
  if (effTab() === 'results' || r.pair?.includes(it.id)) renderMain(r);
}

/** The items pane of a local ranking (ItemsHost, editor.ts): every edit applies at once, in this browser. */
export const localHost = (r: Ranking): ItemsHost => ({
  add(input) {
    if (addTyped(r, input.value)) input.value = '';
    input.focus();
  },
  addList: (text) => addList(r, text),
  addColor: () => addColor(r),
  addFiles: (files) => void addFiles(r, files),
  remove: removeItem,
  rename: (input) => renameItem(r, input),
  recolor: (id, anchor) => {
    if (id) toggleColor(id, anchor);
  },
  setMethod: (k) => setRankMethod(r, k),
  renderMain: () => renderMain(r),
});
