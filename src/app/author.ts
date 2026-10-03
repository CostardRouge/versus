import { CROWD_METHODS, LIMITS } from '../core/board';
import { colorTwin, sameFill } from '../core/colors';
import { freshLabels, labelKey, parseList } from '../core/list';
import type { BoardView } from '../core/protocol';
import { dataURLBytes } from '../core/published';
import { ownerFragment } from '../core/route';
import type { BoardSettings, Fill, Item, MethodKey } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, plural, t } from '../i18n';
import {
  addBusy,
  type Board,
  boardState,
  boardURL,
  countsText,
  type FocusMark,
  focusMark,
  itemOf,
  ownerCall,
  refocus,
  renderDuel,
  renderRanking,
} from './board';
import { closeColor, cp, openBoardColor } from './color';
import { $, $$, ask, castSvg, copyText, doc, toast } from './dom';
import {
  addedToast,
  askVotes,
  fileToThumb,
  type ItemsHost,
  imageFiles,
  imageName,
  paneHTML,
  type Row,
  renderRows,
  takeColor,
  typed,
  typedItems,
} from './editor';
import { errorKey, OWNER_ERRORS } from './errors';
import { optionsHTML, readSettings, visibilityHTML } from './publish';
import {
  addBoardItem,
  addBoardItems,
  editBoardItem,
  fetchConfig,
  type NewBoardItem,
  patchBoard,
  putItemImage,
  removeBoardItem,
  rotateOwner,
} from './remote';
import { S } from './state';
import { saveOwner } from './storage';
import { effTab, setTab, shellHTML, toggleMethodMenu } from './workspace';

/**
 * The author's view of a published board (D116): the workspace of a local ranking, with the same items pane, the
 * title in the header, the score menu, and the board's settings behind its Published button. Every change goes to
 * the server, which pushes the board's new state to everyone; what a change costs in votes is asked as it happens.
 */

type Authored = Board & { view: BoardView; owner: string };

/** The board on screen, when this browser is its author. */
function authored(): Authored | null {
  const b = boardState();
  return b?.view && b.isOwner && b.owner ? (b as Authored) : null;
}

/** Whether the page shows a board to its author (their workspace), not to a visitor. */
export const authorOnScreen = (): boolean => !!authored() && !boardState()?.finale;

/** The votes an item has, as of the newest crowd ranking. */
function votesOf(b: Board, id: string): number {
  const x = b.latest?.stats[id];
  return x ? x.w + x.l + x.d : 0;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function actionHTML(v: BoardView): string {
  const closed = v.status === 'closed';
  return `<button class="pub-btn ${closed ? 'pub-closed' : 'pub-live'}" type="button" data-action="b-settings" aria-haspopup="dialog">${castSvg}<span>${closed ? t('closedChip') : t('pubChip')}</span><span class="pub-caret" aria-hidden="true">▾</span></button>`;
}

function shell(b: Authored): string {
  const v = b.view;
  const frozen = `<span>${t('itemsFrozen')}</span><button class="btn sm" type="button" data-action="b-reopen">${t('reopenVote')}</button>`;
  return shellHTML({
    title: v.title,
    chip: '',
    method: v.settings.method,
    crowd: true,
    action: actionHTML(v),
    sub: `<p class="b-counts mono" id="b-counts">${countsText(b.counts)}</p>
      <p class="note b-conn" id="b-conn" role="status" ${b.conn === 'lost' ? '' : 'hidden'}>${t('reconnecting')}</p>`,
    pane: paneHTML({
      frozen: v.status === 'closed' ? frozen : undefined,
      images: b.pictures === true,
      foot: t('boardFoot'),
    }),
    alias: b.alias,
  });
}

/** The list: the crowd's order as shown, each item with its votes and what the author should know about it. */
function rows(b: Authored): Row[] {
  const v = b.view;
  const order = b.shown?.order ?? [];
  const known = new Set(order);
  const items = [
    ...order.map((id) => v.items.find((it) => it.id === id)).filter((it): it is Item => !!it),
    // Items the ranking on screen doesn't know yet (just added, live updates off) come last.
    ...v.items.filter((it) => !known.has(it.id)),
  ];
  return items.map((it, i) => {
    const x = b.shown?.stats[it.id];
    const votes = x ? x.w + x.l + x.d : 0;
    const twin = it.fill ? colorTwin(v.items, it.id, it.fill) : undefined;
    const note =
      it.pic === 'pending'
        ? unsent.has(picKey(b.alias, it.id))
          ? {
              text: t('picNotSent'),
              bad: true,
              action: { name: 'pic-retry', label: t('retry'), aria: t('picRetryAria', { label: it.label }) },
            }
          : { text: t('picPending') }
        : it.pic === 'refused'
          ? { text: t('picRefused'), bad: true }
          : twin
            ? { text: t('sameColor', { label: twin.label }), bad: true }
            : undefined;
    return { it, pos: String(i + 1), meta: plural(votes, 'vote'), dim: !votes, ...(note ? { note } : {}) };
  });
}

/** Highlights the duel on screen in the list, as a local ranking does. */
export function markAuthorPair(): void {
  const b = authored();
  const p = b && effTab() === 'duel' && b.view.status === 'open' ? b.pairs[0] : undefined;
  for (const li of $$('#item-list li[data-id]')) {
    li.classList.toggle('in-a', !!p && li.dataset.id === p[0]);
    li.classList.toggle('in-b', !!p && li.dataset.id === p[1]);
  }
}

function renderList(b: Authored, animate: boolean): void {
  renderRows(rows(b), b.view.status === 'open', animate);
  markAuthorPair();
}

/** New counts or a new order: the list follows, unless the author is renaming an item in it. */
export function refreshAuthorList(animate: boolean): void {
  const b = authored();
  if (!b || doc.activeElement?.matches?.('#item-list .row-label')) return;
  renderList(b, animate);
}

/** What the author was typing, and where the focus was, so that a new state from the server doesn't lose them. */
interface Typing {
  draft: string;
  focus: FocusMark | null;
  scroll: number;
}

function keepTyping(): Typing {
  return {
    draft: $<HTMLInputElement>('#add-input')?.value ?? '',
    focus: focusMark(),
    scroll: $('#item-list')?.scrollTop ?? 0,
  };
}

function restoreTyping(k: Typing, b: Authored): void {
  const add = $<HTMLInputElement>('#add-input');
  // Unless it was just sent: then it shows in the list.
  if (add && k.draft && k.draft !== b.sentLabel) add.value = k.draft;
  b.sentLabel = null;
  const list = $('#item-list');
  if (list) list.scrollTop = k.scroll;
  // A title or a name being edited keeps what was typed in it.
  const el = k.focus ? $<HTMLInputElement>(k.focus.sel) : null;
  if (el && k.focus?.value != null && el.id !== 'add-input') el.value = k.focus.value;
  refocus(k.focus);
}

/** The whole workspace, from the board's state. */
export function renderAuthor(b: Board & { view: BoardView }): void {
  const view = $('#view');
  const a = authored();
  if (!view || !a || a !== b) return;
  const typing = keepTyping();
  view.innerHTML = shell(a);
  renderList(a, false);
  // The color editor follows its swatch through re-renders, and closes when the item can't be edited anymore.
  if (cp.id) {
    const swatch = $(`.thumb-btn[data-id="${cp.id}"]`);
    if (swatch) cp.anchor = swatch;
    else closeColor();
  }
  setTab(S.route.tab);
  addBusy(adding);
  // Once the main pane is drawn too: the focus may have been in the duel.
  restoreTyping(typing, a);
}

/** The main pane: the duel (server-assigned pairs, like any voter), or the crowd's ranking with the ways to share. */
function renderAuthorMain(): void {
  const b = authored();
  const main = $('#main');
  if (!b || !main) return;
  if (effTab() === 'results') {
    main.innerHTML = `<div class="results b-results">
      <div class="res-head">
        <div><p class="eyebrow mono">${M(b.view.settings.method).name} · ${plural(b.counts.votes, 'vote')}</p><h2 class="q">${esc(b.view.title)}</h2></div>
        <div class="res-actions">
          <button class="btn primary" type="button" data-action="share-board">${t('share')}</button>
          <button class="btn" type="button" data-action="b-share">${t('copyLink')}</button>
        </div>
      </div>
      <section class="b-rank" id="b-rank"></section>
    </div>`;
    renderRanking();
  } else {
    main.innerHTML = '<section class="b-main" id="b-main"></section>';
    renderDuel();
  }
  markAuthorPair();
}

// ─── The board: title, method, settings ─────────────────────────────────────

/** A new title for everyone; an empty one puts the current title back. */
export async function authorRetitle(input: HTMLInputElement): Promise<void> {
  const b = authored();
  if (!b) return;
  const title = input.value.trim();
  if (!title || title === b.view.title) {
    input.value = b.view.title;
    return;
  }
  if ((await ownerCall((alias, token) => patchBoard(alias, token, { title }))) === null) input.value = b.view.title;
}

/** The crowd's scoring method, from the score menu (Exact sort can't serve a crowd). */
async function authorSetMethod(k: string | undefined): Promise<void> {
  toggleMethodMenu(false);
  const b = authored();
  if (!b || !CROWD_METHODS.includes(k as MethodKey) || k === b.view.settings.method) return;
  const method = k as MethodKey;
  if ((await ownerCall((alias, token) => patchBoard(alias, token, { method }))) !== null) {
    toast(t('methodChanged', { name: M(method).name }));
  }
}

/** The open settings dialog's form as the author left it, read at each change; sent once it closes on Done. */
let settingsForm: { draft: Partial<BoardSettings> | null } | null = null;

/** What `next` changes in `now`: the fields to send, none when nothing changed. */
function changedSettings(next: Partial<BoardSettings>, now: BoardSettings): Partial<BoardSettings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (v !== now[k as keyof BoardSettings]) out[k] = v;
  return out as Partial<BoardSettings>;
}

/**
 * The board's settings, links and lifecycle, behind the header's Published button. Changes apply on Done (or one of
 * the dialog's actions), in one request with the changed fields only: a keyboard going through the radio buttons
 * publishes nothing on its way. Refused, the dialog opens again on the settings in force, saying why.
 */
export async function authorSettings(problem?: string): Promise<void> {
  const b = authored();
  if (!b) return;
  const v = b.view;
  const closed = v.status === 'closed';
  const html = `<div class="b-settings" id="b-settings">
    <div class="b-set-row">
      <button class="btn sm primary" type="button" data-action="share-board">${t('share')}</button>
      <button class="btn sm" type="button" data-action="b-share">${t('copyLink')}</button>
      <button class="btn sm ghost" type="button" data-action="b-admin-link">${t('copyAdminLink')}</button>
      <button class="btn sm ghost" type="button" data-action="b-new-admin-link">${t('newAdminLink')}</button>
    </div>
    ${visibilityHTML('b', v.settings)}
    <fieldset class="set"><legend>${t('moreOptions')}</legend>${optionsHTML('b', v.settings)}</fieldset>
    <div class="b-set-row">
      <button class="btn sm" type="button" data-action="${closed ? 'b-reopen' : 'b-close'}">${closed ? t('reopenVote') : t('closeVote')}</button>
      <button class="btn sm danger" type="button" data-action="b-withdraw">${t('withdraw')}</button>
    </div>
  </div>${problem ? `<p class="m-error" role="alert">${esc(problem)}</p>` : ''}`;
  const form: { draft: Partial<BoardSettings> | null } = { draft: null };
  settingsForm = form;
  const ok = await ask({ title: t('boardSettings'), html, ok: t('done') });
  const { draft } = form;
  if (settingsForm === form) settingsForm = null;
  if (!ok || !draft || authored() !== b) return;
  const changes = changedSettings(draft, b.view.settings);
  if (!Object.keys(changes).length) return;
  try {
    await patchBoard(b.alias, b.owner, changes);
  } catch (e) {
    const why = `${t('settingsNotSaved')} ${t(errorKey(e, OWNER_ERRORS))}`;
    // Unless another dialog opened meanwhile (an action of the settings): then a word is enough.
    if ($('#modal')?.hidden && authored() === b) void authorSettings(why);
    else toast(why);
  }
}

/**
 * A new admin link, when the one in use leaked or sits on a lost device: the old one stops working everywhere, this
 * browser keeps managing the board with the new one, which is copied (or shown when the clipboard can't take it).
 */
export async function authorNewAdminLink(): Promise<void> {
  const b = authored();
  if (!b) return;
  const ok = await ask({ title: t('newAdminLinkTitle'), body: t('newAdminLinkBody'), ok: t('newAdminLinkOk') });
  if (!ok || authored() !== b) return;
  const next = await ownerCall(rotateOwner);
  if (!next) return;
  saveOwner(b.alias, next.owner);
  b.owner = next.owner;
  b.socket?.setOwner(next.owner);
  const url = `${boardURL(b.alias)}${ownerFragment(next.owner)}`;
  if (await copyText(url)) toast(t('newAdminLinkCopied'));
  else {
    const html = `<p>${t('newAdminLinkShow')}</p><input class="b-admin-url mono" type="text" readonly value="${esc(url)}">`;
    void ask({ title: t('newAdminLink'), html, ok: t('done'), cancel: false });
  }
}

/** The author's fields beside the items pane: the title, the settings. True when the change was theirs. */
export function authorChange(tg: HTMLInputElement): boolean {
  if (!authored()) return false;
  if (tg.id === 'rank-title') void authorRetitle(tg);
  else if (tg.closest('#b-settings')) {
    if (settingsForm) settingsForm.draft = readSettings($('#b-settings') ?? tg, 'b');
  } else return false;
  return true;
}

// ─── Items ──────────────────────────────────────────────────────────────────

/** Sends new items; a list says how many came in and can be undone. */
async function sendItems(b: Authored, items: NewBoardItem[], dupes: number, list: boolean): Promise<Item[] | null> {
  const [first] = items;
  if (!first) return null;
  const added = await ownerCall((alias, token) =>
    list ? addBoardItems(alias, token, items) : addBoardItem(alias, token, first).then((it) => [it]),
  );
  if (!added?.length) return added;
  if (!list) toast(t('itemAdded'));
  // Items the server refused (a label taken meanwhile, a full board) count with the duplicates.
  else addedToast(added.length, dupes + items.length - added.length, () => void dropItems(b, added));
  return added;
}

/** Undoes a list just added. */
async function dropItems(b: Authored, items: Item[]): Promise<void> {
  for (const it of items) await ownerCall((alias, token) => removeBoardItem(alias, token, it.id));
  if (authored() === b) toast(t('addUndone'));
}

/** Items being sent from the add field (typed, pasted, a color): another Enter or click waits for the answer. */
let adding = false;

/** Runs `send` as the add field's one request in flight, its button busy meanwhile. */
async function addOnce<T>(send: () => Promise<T>): Promise<T | null> {
  if (adding) return null;
  adding = true;
  addBusy(true);
  try {
    return await send();
  } finally {
    adding = false;
    addBusy(false);
  }
}

/** What was typed or pasted in the add field: one item, or every new label of a list (core/list.ts). */
async function authorAdd(text: string): Promise<boolean> {
  const b = authored();
  if (b?.view.status !== 'open' || adding) return false;
  const all = typedItems(text);
  if (!all.length) return false;
  const { fresh, dupes } = freshLabels(
    all.map((x) => x.label),
    b.view.items.map((i) => i.label),
  );
  if (!fresh.length) {
    toast(t(all.length > 1 ? 'allDupes' : 'itemExists'));
    return true;
  }
  b.sentLabel = text;
  const added = await addOnce(() => sendItems(b, fresh.map(typed), dupes, all.length > 1));
  if (!added) {
    b.sentLabel = null;
    return false;
  }
  const input = $<HTMLInputElement>('#add-input');
  if (input?.value === text) input.value = '';
  return true;
}

/** The color picked beside the add field. */
async function authorAddColor(): Promise<void> {
  const b = authored();
  if (!b || adding) return;
  const color = takeColor();
  if (color) await addOnce(() => sendItems(b, [color], 0, false));
}

/** Labels for new images, each new on the board: "Beach", then "Beach 2". */
function freeNames(names: string[], taken: string[]): string[] {
  const used = new Set(taken.map(labelKey));
  return names.map((name) => {
    let label = name;
    for (let n = 2; used.has(labelKey(label)); n++) label = `${name} ${n}`;
    used.add(labelKey(label));
    return label;
  });
}

/**
 * Images dropped, pasted or chosen: added as items that announce a picture, then each picture is sent for the
 * moderator's review (D113). Only when the server reviews pictures; otherwise the author is told why not.
 */
async function authorAddFiles(files: FileList | File[]): Promise<void> {
  const b = authored();
  if (b?.view.status !== 'open') return;
  const imgs = imageFiles(files);
  if (!imgs.length) {
    toast(t('onlyImages'));
    return;
  }
  if ((await fetchConfig()).images !== 'review') {
    toast(t('boardNoPictures'));
    return;
  }
  const read: { name: string; data: string }[] = [];
  for (const f of imgs.slice(0, LIMITS.items)) {
    try {
      read.push({ name: imageName(f), data: await fileToThumb(f) });
    } catch {
      /* unreadable file: skip it */
    }
  }
  if (!read.length) {
    toast(t('cantRead'));
    return;
  }
  const labels = freeNames(
    read.map((r) => r.name),
    b.view.items.map((i) => i.label),
  );
  const items = labels.map((label): NewBoardItem => ({ label, fill: null, pic: 'pending' }));
  const added = await ownerCall((alias, token) => addBoardItems(alias, token, items));
  if (!added) return;
  let sent = 0;
  let failed = 0;
  for (const it of added) {
    const data = dataURLBytes(read[labels.indexOf(it.label)]?.data ?? '');
    if (!data) continue;
    if (await sendPicture(b.alias, b.owner, it.id, new Blob([data.bytes], { type: 'image/jpeg' }))) sent++;
    else failed++;
  }
  picturesToast(sent, failed);
}

// ─── Pictures the server never received ─────────────────────────────────────

/**
 * Pictures whose upload failed, by board and item. The server can't tell a picture it never received from one
 * awaiting review (both are `pending`), so this browser remembers them, in memory, for their rows to say so and offer
 * to send them again (a reload forgets them: those rows say "awaiting review" again).
 */
const unsent = new Map<string, Blob>();
const picKey = (alias: string, id: string): string => `${alias}/${id}`;
const retrying = new Set<string>();

/** Sends an item's picture for review; one that fails is kept, and its row offers to send it again. */
export async function sendPicture(alias: string, owner: string, id: string, jpeg: Blob): Promise<boolean> {
  try {
    await putItemImage(alias, owner, id, jpeg);
    unsent.delete(picKey(alias, id));
    return true;
  } catch {
    unsent.set(picKey(alias, id), jpeg);
    return false;
  }
}

/** What sending a batch of pictures came to; the list shows which ones didn't go. */
export function picturesToast(sent: number, failed: number): void {
  if (failed) toast(t('picturesUnsent', { pictures: plural(failed, 'picture'), n: failed }));
  else toast(sent ? t('picturesSent', { pictures: plural(sent, 'picture') }) : t('picturesFailed'));
  refreshAuthorList(false);
}

/** "Retry" on a picture that wasn't sent. */
export async function authorRetryPicture(id: string | undefined): Promise<void> {
  const b = authored();
  const key = b && id ? picKey(b.alias, id) : '';
  const jpeg = unsent.get(key);
  if (!b || !id || !jpeg || retrying.has(key)) return;
  retrying.add(key);
  const btn = $<HTMLButtonElement>(`[data-action="pic-retry"][data-id="${id}"]`);
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    await putItemImage(b.alias, b.owner, id, jpeg);
    unsent.delete(key);
    toast(t('picturesSent', { pictures: plural(1, 'picture') }));
  } catch (e) {
    toast(t(errorKey(e, OWNER_ERRORS)));
  } finally {
    retrying.delete(key);
  }
  if (authored() === b) renderList(b, false);
}

/**
 * A name changed in the list. With votes, the author says what they become (D116): kept (a correction, checked
 * first) or dropped (another choice). Cancelled or refused, the name goes back.
 */
async function authorRename(input: HTMLInputElement): Promise<void> {
  const b = authored();
  const id = input.dataset.id;
  const it = id ? itemOf(id) : undefined;
  if (!b || !id || !it) return;
  const label = input.value.trim();
  const revert = () => {
    input.value = it.label;
  };
  if (!label || label === it.label) return revert();
  if (b.view.items.some((i) => i.id !== id && labelKey(i.label) === labelKey(label))) {
    toast(t('itemExists'));
    return revert();
  }
  const votes = votesOf(b, id);
  let reset = false;
  if (votes) {
    const choice = await askVotes({
      title: t('renameTitle', { from: it.label, to: label }),
      body: t('renameBody', { label: it.label, votes: plural(votes, 'vote') }),
      ok: t('renameOk'),
      reset: false,
    });
    if (!choice) return revert();
    reset = choice === 'reset';
  }
  const n = await ownerCall((alias, token) => editBoardItem(alias, token, id, { label, reset }));
  if (n === null) return revert();
  if (votes) toast(reset ? t('renamedReset', { label }) : t('renamedKept', { n: votes }));
}

/** Opens the color editor on a color item of the board (a second click on its swatch closes it). */
function authorEditColor(id: string | undefined, anchor: HTMLElement): void {
  const b = authored();
  const it = id ? itemOf(id) : undefined;
  if (!b || !it?.fill || b.view.status !== 'open') return;
  if (cp.id === it.id) {
    closeColor();
    return;
  }
  openBoardColor(it, b.view.items, anchor, (fill) => void authorRecolor(it.id, fill));
}

/**
 * Gives an item a new color for everyone. Its votes were cast on the old one: with some, the author says what they
 * become, starting again from zero checked first (the color is the item).
 */
async function authorRecolor(id: string, fill: Fill): Promise<void> {
  const b = authored();
  const it = itemOf(id);
  if (!b || !it?.fill || sameFill(it.fill, fill)) return;
  const votes = votesOf(b, id);
  let reset = false;
  if (votes) {
    const choice = await askVotes({
      title: t('recolorTitle', { label: it.label }),
      body: t('recolorBody', { label: it.label, votes: plural(votes, 'vote') }),
      ok: t('recolorOk'),
      reset: true,
    });
    if (!choice) return;
    reset = choice === 'reset';
  }
  const n = await ownerCall((alias, token) => editBoardItem(alias, token, id, { fill, reset }));
  if (n !== null) toast(n ? t('recoloredReset', { label: it.label }) : t('recolored'));
}

/**
 * Removes an item. Without votes it goes at once, and Undo brings it back (as a new item); with votes, or a
 * picture that can't come back, after a confirmation.
 */
async function authorRemove(id: string | undefined): Promise<void> {
  const b = authored();
  const it = id ? itemOf(id) : undefined;
  if (!b || !id || !it) return;
  const votes = votesOf(b, id);
  const remove = () => ownerCall((alias, token) => removeBoardItem(alias, token, id));
  if (votes || it.img || it.pic) {
    const ok = await ask({
      title: t('removeItemTitle', { label: it.label }),
      body: votes ? t('removeItemBody', { votes: plural(votes, 'vote') }) : t('removePictureBody'),
      ok: t('removeOk'),
      danger: true,
    });
    if (!ok || authored() !== b) return;
    if ((await remove()) !== null) toast(t('itemRemoved'));
    return;
  }
  if ((await remove()) === null) return;
  const back = { label: it.label, fill: it.fill };
  toast(t('itemRemovedNamed', { label: it.label }), {
    label: t('undoToast'),
    run: () => void ownerCall((alias, token) => addBoardItem(alias, token, back)),
  });
}

/** The items pane of a published board's author (ItemsHost, editor.ts): every edit goes through the server. */
export const authorHost: ItemsHost = {
  add: (input) => void authorAdd(input.value),
  addList(text) {
    if (parseList(text).length < 2) return false;
    void authorAdd(text);
    return true;
  },
  addColor: () => void authorAddColor(),
  addFiles: (files) => void authorAddFiles(files),
  remove: (id) => void authorRemove(id),
  rename: (input) => void authorRename(input),
  recolor: authorEditColor,
  setMethod: (k) => void authorSetMethod(k),
  renderMain: renderAuthorMain,
};
