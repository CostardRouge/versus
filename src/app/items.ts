import { fillCode, fillCSS, hslToHex, isHex, normHex } from '../core/colors';
import { getItem, mkItem } from '../core/model';
import { compute, methodOf } from '../core/scoring';
import type { Fill, Item, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, plural, t } from '../i18n';
import { closeColor, cp } from './color';
import { $, $$, doc, reduced, thumbHTML, toast } from './dom';
import { fmtScore } from './format';
import { cur, save, stat } from './state';
import { effTab, renderMain } from './workspace';

/** Items side list (live-sorted, animated) and item edits: add text, colors and images, rename, remove. */

function listThumbHTML(it: Item): string {
  if (!it.fill) return thumbHTML(it);
  return `<button class="thumb thumb-btn" type="button" data-action="edit-color" data-id="${it.id}" style="background:${fillCSS(it.fill)}" aria-label="${esc(t('editColorAria', { label: it.label }))}" title="${t('editColor')}"></button>`;
}
export function renderList(r: Ranking, animate: boolean): void {
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
export function addLabels(r: Ranking, labels: string[]): number {
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
export function addColor(): void {
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
export async function addFiles(r: Ranking, files: FileList | File[]): Promise<void> {
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
export function removeItem(id: string | undefined): void {
  const r = cur();
  if (!r || !id) return;
  if (cp.id === id) closeColor();
  const prev = r.items.length;
  r.items = r.items.filter((i) => i.id !== id);
  if (r.pair?.includes(id)) r.pair = null;
  r.updated = Date.now();
  afterItemsChange(r, prev);
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
