import { freshLabels, parseList } from '../core/list';
import { getItem, mkItem } from '../core/model';
import { compute, methodOf } from '../core/scoring';
import type { Item, Ranking } from '../core/types';
import { methodText as M, plural, t } from '../i18n';
import { closeColor, cp } from './color';
import { $$, toast } from './dom';
import { fileToThumb, imageFiles, imageName, type Row, renderRows, type Typed, takeColor, typed } from './editor';
import { fmtScore } from './format';
import { cur, save, stat } from './state';
import { effTab, renderMain } from './workspace';

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
  const clean = items.filter((x) => x.label || x.fill).slice(0, 200);
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
export function addList(r: Ranking, text: string): boolean {
  const labels = parseList(text);
  if (labels.length < 2) return false;
  addLabelList(r, labels);
  return true;
}
/** Labels read from a list (pasted, typed or shared from another app): those not in the ranking yet, with a toast that can undo. */
export function addLabelList(r: Ranking, labels: string[]): void {
  const { fresh, dupes } = freshLabels(
    labels,
    r.items.map((i) => i.label),
  );
  const added = addItems(r, fresh.map(typed));
  const n = added.length;
  if (!n) {
    toast(t('allDupes'));
    return;
  }
  const items = plural(n, 'item');
  const msg = dupes
    ? t('itemsAddedDupes', { items, n, dupes: plural(dupes, 'duplicate'), d: dupes })
    : t('itemsAdded', { items, n });
  const ids = new Set(added.map((i) => i.id));
  toast(msg, { label: t('undoToast'), run: () => dropItems(r, ids) });
}
/** What was typed in the add field and sent: a list, or one item. False when there was nothing to add. */
export function addTyped(r: Ranking, text: string): boolean {
  return addList(r, text) || addItems(r, parseList(text).map(typed)).length > 0;
}
export function addColor(r: Ranking): void {
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
  for (const f of imgs.slice(0, 60)) {
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
  if (cp.id && ids.has(cp.id)) closeColor();
  const prev = r.items.length;
  r.items = r.items.filter((i) => !ids.has(i.id));
  if (r.pair?.some((id) => ids.has(id))) r.pair = null;
  r.updated = Date.now();
  if (cur() === r) afterItemsChange(r, prev);
  else save();
}
export function removeItem(id: string | undefined): void {
  const r = cur();
  if (r && id) dropItems(r, new Set([id]));
}

/** Commits a label edited in the side list; an empty label is reverted. */
export function renameItem(r: Ranking, input: HTMLInputElement): void {
  const it = input.dataset.id ? getItem(r, input.dataset.id) : undefined;
  if (!it) return;
  const v = input.value.trim();
  if (!v) {
    input.value = it.label;
    return;
  }
  it.label = v;
  r.updated = Date.now();
  save();
  if (cp.id === it.id) cp.follow = false;
  if (effTab() === 'results' || r.pair?.includes(it.id)) renderMain(r);
}
