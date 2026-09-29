import { fillCSS } from '../core/colors';
import type { Item } from '../core/types';
import { esc, initials } from '../core/util';
import { t } from '../i18n';

/** Document access, environment queries and small shared UI pieces (toast, live region, confirm modal, icons). */

type MQ = Pick<MediaQueryList, 'matches' | 'addEventListener'>;

export let doc: Document;
/** Narrow layout: the items list becomes a tab. */
export let narrow: MQ;
export let reduced = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let modalDone: ((v: boolean) => void) | null = null;

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = doc): T | null =>
  root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = doc): T[] => [
  ...root.querySelectorAll<T>(sel),
];
const media = (q: string): MQ =>
  typeof window.matchMedia === 'function' ? window.matchMedia(q) : { matches: false, addEventListener: () => {} };

export function initDom(d: Document): void {
  doc = d;
  narrow = media('(max-width: 859px)');
  reduced = media('(prefers-reduced-motion: reduce)').matches;
}

export const trashSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
export const imgSvg =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';

/* ---------- UI helpers ---------- */
export function toast(msg: string): void {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
export function announce(msg: string): void {
  const el = $('#live');
  if (el) el.textContent = msg;
}
export function ask(opts: { title: string; body: string; ok?: string; danger?: boolean }): Promise<boolean> {
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
export const closeModal = (v: boolean): void => modalDone?.(v);

export const thumbHTML = (it: Item): string =>
  it.fill
    ? `<span class="thumb" style="background:${fillCSS(it.fill)}"></span>`
    : `<span class="thumb" style="--h:${it.h}">${it.img ? `<img src="${it.img}" alt="">` : esc(initials(it.label))}</span>`;
