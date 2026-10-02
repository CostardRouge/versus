import { fillCSS } from '../core/colors';
import { shownImage } from '../core/images';
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
let toastRun: (() => void) | null = null;
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
export const castSvg =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/></svg>';
export const bellSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
export const imgSvg =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';

/* ---------- UI helpers ---------- */
/** A short message; with an action (Undo), it stays longer and carries a button. */
export function toast(msg: string, action?: { label: string; run: () => void }): void {
  const el = $('#toast');
  if (!el) return;
  toastRun = action?.run ?? null;
  if (action) {
    el.innerHTML = `<span>${esc(msg)}</span><button class="toast-act" type="button" data-action="toast-act">${esc(action.label)}</button>`;
  } else el.textContent = msg;
  el.classList.toggle('has-act', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 2600);
}
function hideToast(): void {
  toastRun = null;
  $('#toast')?.classList.remove('show');
}
/** Runs the action of the toast on screen, once. */
export function toastAct(): void {
  const run = toastRun;
  clearTimeout(toastTimer);
  hideToast();
  run?.();
}
export function announce(msg: string): void {
  const el = $('#live');
  if (el) el.textContent = msg;
}
/**
 * Confirm modal. `html` replaces the text body with markup the caller reads back after OK (a small
 * form); `cancel: false` makes it a plain notice.
 */
export function ask(opts: {
  title: string;
  body?: string;
  html?: string;
  ok?: string;
  danger?: boolean;
  cancel?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const m = $('#modal');
    const okB = $<HTMLButtonElement>('#m-ok');
    const cancel = $('#m-cancel');
    const title = $('#m-title');
    const body = $('#m-body');
    if (!m || !okB || !cancel || !title || !body) return resolve(false);
    title.textContent = opts.title;
    if (opts.html === undefined) body.textContent = opts.body ?? '';
    else body.innerHTML = opts.html;
    okB.textContent = opts.ok ?? t('confirm');
    okB.className = `btn ${opts.danger ? 'danger' : 'primary'}`;
    cancel.textContent = t('cancel');
    cancel.hidden = opts.cancel === false;
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

/** False when the clipboard is unavailable or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function thumbHTML(it: Item): string {
  if (it.fill) return `<span class="thumb" style="background:${fillCSS(it.fill)}"></span>`;
  const img = shownImage(it.img);
  return `<span class="thumb" style="--h:${it.h}">${img ? `<img src="${img}" alt="">` : esc(initials(it.label))}</span>`;
}
