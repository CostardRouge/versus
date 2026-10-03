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
/** Moves the focus to what isn't a control (a view's heading), without putting it in the Tab order. */
export function focusOn(el: HTMLElement | null): void {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
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
    const box = $('.modal-box', m);
    if (body.textContent?.trim()) box?.setAttribute('aria-describedby', 'm-body');
    else box?.removeAttribute('aria-describedby');
    const prev = doc.activeElement as HTMLElement | null;
    // The page behind can't be reached (Tab, a screen reader's cursor) while the question is open.
    $('#app')?.setAttribute('inert', '');
    m.hidden = false;
    modalDone = (v) => {
      m.hidden = true;
      modalDone = null;
      $('#app')?.removeAttribute('inert');
      prev?.focus();
      resolve(v);
    };
    // A destructive question starts on Cancel: Enter alone must never delete.
    setTimeout(() => (opts.danger && !cancel.hidden ? cancel : okB).focus(), 10);
  });
}

const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]';

/** Keeps Tab inside an open dialog: from its last control back to its first, and the other way round. */
export function trapTab(e: KeyboardEvent, box: HTMLElement): void {
  const all = $$<HTMLElement>(FOCUSABLE, box).filter(
    (el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled && el.tabIndex >= 0,
  );
  const first = all[0];
  const last = all.at(-1);
  if (!first || !last) return;
  const at = doc.activeElement;
  if (e.shiftKey ? at === first || !box.contains(at) : at === last || !box.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
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

/**
 * An item's small square: its color, its picture, or its initials. A picture from the server (a published board's,
 * up to 250 KB) waits until its row is near the screen, so a long list doesn't hold back the duel's pictures.
 */
export const thumbHTML = (it: Item): string =>
  it.fill
    ? `<span class="thumb" style="background:${fillCSS(it.fill)}"></span>`
    : `<span class="thumb" style="--h:${it.h}">${it.img ? `<img src="${esc(it.img)}" alt=""${it.img.startsWith('data:') ? '' : ' loading="lazy" decoding="async"'}>` : esc(initials(it.label))}</span>`;
