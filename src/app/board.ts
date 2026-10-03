import { trackEvent } from '../audience';
import { LIMITS, REPORT_REASONS, revealAt } from '../core/board';
import { imageSrc } from '../core/model';
import type { BoardView, ClientMessage, Counts, RankingView, ServerMessage } from '../core/protocol';
import { PROTOCOL_VERSION } from '../core/protocol';
import { agreement, neckAndNeck, totalPairs } from '../core/published';
import { ownerFragment } from '../core/route';
import type { BoardStatus, Duel, ErrorCode, Item, Ranking, ReportReason } from '../core/types';
import { esc, uid } from '../core/util';
import { methodText as M, type MsgKey, pct, plural, t } from '../i18n';
import { authorChange, markAuthorPair, refreshAuthorList, renderAuthor } from './author';
import {
  answered,
  authoring,
  type Board,
  boardState,
  canVote,
  castCheck,
  castReset,
  castSkip,
  castSuggest,
  castUndo,
  castVote,
  itemOf,
  newBoard,
  type Pending,
  refused,
  setBoardState,
  suggesting,
} from './board-state';
import { closeColor, cp } from './color';
import { $, ask, copyText, doc, reduced, thumbHTML, toast } from './dom';
import { bindStage, cardHTML, controlsHTML, duelKeys, outcomeOf, playPick } from './duel';
import { addFormHTML, typed } from './editor';
import { errorKey, OWNER_ERRORS, REPORT_ERRORS } from './errors';
import {
  type FinaleData,
  type FinaleMode,
  finaleHTML,
  finalePlaying,
  mountFinale,
  type ResultView,
  resetFinale,
  setPodiumWho,
} from './finale';
import { fmtCrowd } from './format';
import { flushJoined, joinedOf, markGone, noteBoard } from './joined';
import { makeOwn, open } from './rankings';
import { BoardSocket, type Connection, fetchConfig, reportBoard, setBoardStatus, withdrawBoard } from './remote';
import { currentLayer, dropLayer, popLayer, pushLayer, routeURL } from './router';
import { S, save } from './state';
import { loadOwners, saveOwner, savePrefs } from './storage';
import { turnstileKey, turnstileWidget } from './turnstile';
import { effTab } from './workspace';

/**
 * Board page of a published ranking: duels come from the server queue, the crowd ranking updates live
 * (or waits for a refresh). Its author sees it in the workspace of a local ranking instead (author.ts, D116).
 */

/**
 * What to tell the user when the server refuses an action; the queue it sends next puts the duel and the vote count
 * right again. A refused skip says nothing: its pair simply comes back.
 */
function errorText(code: ErrorCode, kind: Pending['kind'] | undefined): MsgKey | null {
  if (code === 'upgrade') return 'appOutdated';
  if (code === 'rate_limited') return 'tooManyTries';
  // A first vote held for a human check opens the check (humanCheck); a check refused says so.
  if (code === 'captcha') return kind === 'vote' ? null : 'captchaFailed';
  if (code === 'closed') return 'voteClosed';
  if (code === 'final') return 'finalVotes';
  if (kind === 'add') {
    const add: Partial<Record<ErrorCode, MsgKey>> = {
      full: 'boardFull',
      exists: 'itemExists',
      too_fast: 'addTooFast',
      forbidden: 'addNotAllowed',
    };
    return add[code] ?? 'actionFailed';
  }
  if (kind === 'vote') return code === 'too_fast' ? 'voteTooFast' : 'voteNotCounted';
  return kind === 'undo' || kind === 'reset' ? 'actionFailed' : null;
}

/** A board's own address (b/<alias> under the app's folder), the link to share. */
export const boardURL = (alias: string): string => routeURL({ view: 'board', alias });

// ─── Focus across re-renders ────────────────────────────────────────────────

/** The focused control, as a selector that finds it again once its part of the page is drawn anew. */
export interface FocusMark {
  sel: string;
  /** A text field's value and caret; null for any other control. */
  value: string | null;
  start: number | null;
  end: number | null;
}

/** The data attributes that tell one control from its siblings, after its data-action. */
const MARK_KEYS = ['action', 'id', 'side', 'view', 'who', 'tab', 'm', 'alias'] as const;
const attr = (k: string, v: string): string => `[data-${k}="${v.replace(/["\\]/g, '\\$&')}"]`;

function markOf(el: HTMLElement): string | null {
  if (el.id) return `#${el.id}`;
  const d = el.dataset;
  if (d.action) return MARK_KEYS.map((k) => (d[k] === undefined ? '' : attr(k, d[k]))).join('');
  if (el.classList.contains('row-label') && d.id) return `#item-list .row-label${attr('id', d.id)}`;
  if (el.classList.contains('card') && d.side) return `.card${attr('side', d.side)}`;
  return null;
}

/**
 * Where the focus is, when it is inside `root` (the part about to be redrawn): a live update must never send a
 * keyboard or screen reader user back to the top of the page.
 */
export function focusMark(root: Element | null = $('#view')): FocusMark | null {
  const el = doc.activeElement as HTMLInputElement | null;
  const sel = el && root?.contains(el) && el !== root ? markOf(el) : null;
  if (!el || !sel) return null;
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = el.selectionStart ?? null;
    end = el.selectionEnd ?? null;
  } catch {
    /* a field without a caret (a number) */
  }
  const text = (el.tagName === 'INPUT' && start !== null) || el.tagName === 'TEXTAREA';
  return { sel, value: text ? el.value : null, start, end };
}

/** Puts the focus (and a text field's caret) back on the control `mark` names, if it is still there. */
export function refocus(mark: FocusMark | null): void {
  if (!mark) return;
  const el = $<HTMLInputElement>(mark.sel);
  if (!el || el === doc.activeElement || el.disabled) return;
  el.focus({ preventScroll: true });
  if (mark.start === null) return;
  try {
    el.setSelectionRange(mark.start, mark.end);
  } catch {
    /* not a text field anymore */
  }
}

const live = (): boolean => S.prefs.live !== false;
const localOf = (alias: string): Ranking | undefined => S.ranks.find((r) => r.pub?.alias === alias);

/**
 * Connects to a board (or keeps the current connection when it is the same one). `wanted` is the duel a shared
 * link asked for: the server serves it first when this voter can still vote on it. `candidate` is the token of an
 * admin link just opened: tried instead of the stored one, and stored only if the server says it is this board's.
 */
export function enterBoard(
  alias: string,
  available: boolean,
  wanted: [string, string] | null = null,
  candidate: string | null = null,
): void {
  if (boardState()?.alias === alias) return;
  leaveBoard();
  const owner = candidate ?? loadOwners()[alias] ?? null;
  const board = newBoard({ alias, owner, candidate, available, reopen: currentLayer() === 'finale' });
  setBoardState(board);
  resetFinale();
  if (available) connect(board, wanted);
}

/** The first state of a board opened on its end-of-vote page's entry (a reload, Back from elsewhere) shows it again. */
function reopenFinale(b: Board, v: BoardView): void {
  if (!b.reopen) return;
  b.reopen = false;
  if (currentLayer() !== 'finale' || b.finale) return;
  if (votedAll(b, v)) b.finale = true;
  else dropLayer();
}

/** Opens the board's connection, with the author's token in the hello when there is one. */
function connect(board: Board, wanted: [string, string] | null = null): void {
  const hello: ClientMessage = {
    t: 'hello',
    v: PROTOCOL_VERSION,
    voter: S.voter,
    ...(board.owner ? { owner: board.owner } : {}),
    ...(wanted ? { pair: wanted } : {}),
  };
  // Messages of a connection replaced since (a refused admin link) are ignored; the first calls come while it is built.
  const mine = (): boolean => !socket || board.socket === socket;
  let socket: BoardSocket | undefined;
  socket = new BoardSocket(
    board.alias,
    hello,
    (m) => {
      if (mine()) onMessage(board, m);
    },
    (c) => {
      if (mine()) onConnection(board, c);
    },
  );
  board.socket = socket;
}

/**
 * The server's answer to an admin link's token: kept when it is this board's; otherwise the stored token, if any,
 * is untouched and used again. Returns true when the connection starts over with it.
 */
function settleCandidate(board: Board, owner: boolean): boolean {
  const tried = board.candidate;
  if (tried === null) return false;
  board.candidate = null;
  if (owner) {
    saveOwner(board.alias, tried);
    return false;
  }
  toast(t('ownerLinkRefused'));
  board.owner = loadOwners()[board.alias] ?? null;
  if (!board.owner || board.owner === tried) return false;
  board.socket?.close();
  connect(board);
  return true;
}

/** The Retry button of a board that can't be reached: a new connection at once. */
export function boardRetry(): void {
  boardState()?.socket?.retryNow();
}

export function leaveBoard(): void {
  flushJoined();
  boardState()?.socket?.close();
  setBoardState(null);
  resetFinale();
}

// ─── Server messages ────────────────────────────────────────────────────────

function onConnection(board: Board, c: Connection): void {
  if (boardState() !== board) return;
  board.conn = c;
  // Nothing is deleted here: the author decides, from the page, to take back the local version.
  if (c === 'gone' && !board.leaving) {
    board.view = null;
    markGone(board.alias);
  }
  if (c === 'lost') board.failed = true;
  if (!board.view) {
    // Still waiting for the first state: the message changes in place, so screen readers hear it.
    const wait = $('#b-wait');
    if (wait && (c === 'connecting' || c === 'lost')) {
      wait.innerHTML = waitText(board);
      const acts = $('#b-wait-acts');
      if (acts) acts.hidden = !board.failed;
    } else renderBoard();
  } else {
    const banner = $('#b-conn');
    if (banner) banner.hidden = c !== 'lost';
  }
}

function onMessage(board: Board, m: ServerMessage): void {
  if (boardState() !== board) return;
  if (m.t === 'state') {
    if (settleCandidate(board, m.owner)) return;
    board.view = m.board;
    board.isOwner = m.owner;
    board.mine = m.mine;
    board.count = m.mine.length;
    board.pairs = m.pairs;
    board.counts = m.board.counts;
    board.pending = [];
    board.shown = board.latest = m.board.ranking;
    board.shownVotes = board.latestVotes = m.board.counts.votes;
    // The author's local ranking follows the board: its gallery card shows its status and title.
    const local = localOf(board.alias);
    if (local?.pub && (local.pub.status !== m.board.status || local.title !== m.board.title)) {
      local.pub.status = m.board.status;
      local.title = m.board.title;
      save();
    }
    if (m.owner && board.pictures === null) {
      board.pictures = false;
      void fetchConfig().then((c) => {
        board.pictures = c.images === 'review';
        if (boardState() === board && board.pictures) renderBoard();
      });
    }
    note(board);
    reopenFinale(board, m.board);
    renderBoard();
  } else if (m.t === 'pairs') {
    const head = answered(board, m.pairs, m.mine);
    note(board, head?.kind === 'vote');
    // Mostly the server confirming a skip, a vote or an undo already on screen: drawing the same duel again would
    // replay the cards' entrance, halfway through it on a slow (mobile) connection.
    if (!board.busy && $('#b-main')?.dataset.duel !== duelKey(board)) renderDuel();
    renderRanking();
    if (head?.kind === 'add') addBusy(suggesting(board));
  } else if (m.t === 'ranking') {
    board.counts = m.counts;
    board.latest = m.ranking;
    board.latestVotes = m.counts.votes;
    const before = board.shown;
    // Frozen only while something is on screen and more is visible: newly visible or hidden rankings apply now.
    if (live() || !board.shown || !m.ranking) {
      board.shown = m.ranking;
      board.shownVotes = m.counts.votes;
    }
    note(board, false, true);
    const counts = $('#b-counts') ?? $('#fin-counts');
    if (counts) counts.textContent = countsText(board.counts);
    if (board.finale && orderOf(before) !== orderOf(board.shown)) renderBoard();
    renderRanking();
    if (authoring(board)) refreshAuthorList(true);
  } else {
    const { kind, reverted } = refused(board);
    if (reverted) renderRanking();
    if (kind === 'add') addBusy(suggesting(board));
    if (m.code === 'captcha' && kind === 'vote') void humanCheck(board);
    const key = errorText(m.code, kind);
    if (key) toast(t(key));
  }
}

/** Keeps this board's card under "Your votes" current; boards managed from a local ranking have none. */
function note(b: Board, voted = false, lazy = false): void {
  if (!b.view || localOf(b.alias)) return;
  const snap = {
    alias: b.alias,
    view: b.view,
    counts: b.counts,
    order: b.latest?.order ?? null,
    mine: b.mine,
    count: b.count,
  };
  noteBoard(snap, voted, lazy);
}

// ─── Rendering ──────────────────────────────────────────────────────────────

const orderOf = (r: RankingView | null): string => r?.order.join(' ') ?? '';

/** What the duel shows of my queue and my votes, kept on the pane that shows it. */
const duelKey = (b: Board): string => [b.pairs[0]?.join('.') ?? '', b.count, b.mine.length].join(' ');

export const countsText = (c: Counts): string =>
  t('boardCounts', { votes: plural(c.votes, 'vote'), voters: plural(c.voters, 'voter'), online: c.online });

export function renderBoard(mode: FinaleMode = 'none'): void {
  const view = $('#view');
  const b = boardState();
  if (!view || !b) return;
  if (b.finale && b.view) {
    renderFinale(b, b.view, mode);
    return;
  }
  if (authoring(b)) {
    renderAuthor(b);
    return;
  }
  // Keep what someone is typing when another change re-renders the page, unless it was just added, and where the
  // focus was (the caret too).
  const draft = ($('#add-input') as HTMLInputElement | null)?.value ?? '';
  const mark = focusMark(view);
  view.innerHTML = boardHTML(b);
  const input = $('#add-input') as HTMLInputElement | null;
  if (input && draft && draft !== b.sentLabel) input.value = draft;
  b.sentLabel = null;
  if (cp.id) closeColor();
  if (b.view) {
    renderDuel();
    renderRanking();
  }
  addBusy(suggesting(b));
  refocus(mark);
}

/**
 * The add field's button while what it sent waits for its answer: disabled and busy, so that Enter pressed again,
 * or a second click, sends nothing more.
 */
export function addBusy(busy: boolean): void {
  const btn = $<HTMLButtonElement>('#add-form .add-btn');
  if (!btn) return;
  btn.disabled = busy;
  if (busy) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
}

const waitText = (b: Board): string => `<h2 class="q">${b.conn === 'lost' ? t('boardOffline') : t('connecting')}</h2>`;

/**
 * The board's first state hasn't come: connecting, or offline and trying again, with a way to try at once or to
 * leave. A board under "Your votes" shows what it was at the last visit meanwhile.
 */
function waitHTML(b: Board, back: string): string {
  const j = joinedOf(b.alias);
  const snap = j
    ? `<p class="b-counts mono">${plural(j.votes, 'vote')} · ${plural(j.voters, 'voter')} · ${t('myVotes', { n: j.count })}</p>
      <p class="note">${t('lastVisit')}</p>`
    : '';
  return `<div class="board">
    <div class="ws-head b-head">${back}${j ? `<h1 class="b-title">${esc(j.title)}</h1>` : ''}</div>
    ${snap}
    <div class="empty-duel">
      <div id="b-wait" role="status">${waitText(b)}</div>
      <p class="b-wait-acts" id="b-wait-acts" ${b.failed ? '' : 'hidden'}>
        <button class="btn primary" type="button" data-action="b-retry">${t('retry')}</button>
        <button class="btn" type="button" data-action="back">${t('yourRankings')}</button>
      </p>
    </div>
  </div>`;
}

function boardHTML(b: Board): string {
  const back = `<button class="back" type="button" data-action="back">${t('back')}</button>`;
  const v = b.view;
  if (!v) {
    if (b.conn === 'connecting' || b.conn === 'lost' || b.conn === 'open') return waitHTML(b, back);
    const gone = b.conn === 'gone';
    const local = gone ? localOf(b.alias) : undefined;
    const action = local
      ? `<button class="btn primary" type="button" data-action="b-unlink">${t('keepLocal')}</button>`
      : `<button class="btn primary" type="button" data-action="back">${t('yourRankings')}</button>`;
    return `<div class="board"><div class="ws-head">${back}</div>
      <div class="empty-duel"><h2 class="q">${gone ? t('boardGone') : t('boardUnavailable')}</h2>${action}</div></div>`;
  }
  const closed = v.status === 'closed';
  // Voters can start their own version from these items; the author has the ranking already.
  const mine = b.isOwner
    ? ''
    : `<button class="btn sm ghost" type="button" data-action="b-make-mine" title="${esc(t('makeMineHint'))}">${t('makeMine')}</button>`;
  return `<div class="board">
    <div class="ws-head b-head">
      ${back}
      <h1 class="b-title">${esc(v.title)}</h1>
      <span class="chip ${closed ? '' : 'chip-live'}">${closed ? t('closedChip') : t('pubChip')}</span>
      <span class="b-head-acts">
        <button class="btn sm primary" type="button" data-action="share-board">${t('share')}</button>
        <button class="btn sm" type="button" data-action="b-share">${t('copyLink')}</button>
        ${mine}
      </span>
    </div>
    <p class="b-counts mono" id="b-counts">${countsText(b.counts)}</p>
    <p class="note b-conn" id="b-conn" role="status" ${b.conn === 'lost' ? '' : 'hidden'}>${t('reconnecting')}</p>
    <div class="b-body">
      <section class="b-main" id="b-main"></section>
      <aside class="b-side">
        <section class="b-rank" id="b-rank"></section>
        ${v.settings.visitorsAddItems && !closed ? `<section class="b-suggest"><h2>${t('suggestTitle')}</h2>${addFormHTML(t('addPlaceholder'), t('suggestTitle'))}</section>` : ''}
        ${b.isOwner ? '' : `<p class="b-report"><button class="link" type="button" data-action="b-report">${t('report')}</button></p>`}
      </aside>
    </div>
  </div>`;
}

const emptyHTML = (title: string, body: string, action = ''): string =>
  `<div class="empty-duel"><h2 class="q">${title}</h2>${body ? `<p class="muted">${body}</p>` : ''}${action}</div>`;

/** Once every pair is voted, the way (back) to the end-of-vote page. */
const resultHTML = (b: Board, v: BoardView): string =>
  votedAll(b, v) ? `<button class="btn primary" type="button" data-action="b-finale">${t('seeResult')}</button>` : '';

function duelHTML(b: Board, v: BoardView): string {
  if (v.status === 'closed') return emptyHTML(t('voteClosed'), t('voteClosedBody'), resultHTML(b, v));
  const pair = b.pairs[0];
  const A = pair ? itemOf(pair[0]) : undefined;
  const C = pair ? itemOf(pair[1]) : undefined;
  if (!A || !C) {
    if (b.count >= totalPairs(v.items.length)) return emptyHTML(t('votedAll'), t('votedAllBody'), resultHTML(b, v));
    // The next pair is on its way from the server: said, not a bare ellipsis.
    return `<div class="empty-duel" aria-busy="true"><p class="muted" role="status">${t('loadingPair')}</p></div>`;
  }
  // No forecast and no crowd score here: the duel itself stays blind.
  return `<div class="duel">
    <div class="duel-top"><div><p class="eyebrow mono">${t('myVotes', { n: b.count })} · ${M(v.settings.method).name}</p><h2 class="q">${t('question')}</h2></div></div>
    <div class="stage enter" id="stage">
      ${cardHTML(A, 'a')}
      <div class="vs" aria-hidden="true"><span class="vs-dot">vs</span></div>
      ${cardHTML(C, 'b')}
    </div>
    ${controlsHTML('b-pick', 'b-skip')}
    <div class="duel-foot">
      <span class="duel-foot-acts"><button class="link" type="button" data-action="b-undo" ${b.mine.length ? '' : 'disabled'}>${t('undoVote')}</button><button class="link" type="button" data-action="share-duel">${t('shareDuel')}</button></span>
      <span class="muted">${t('swipeHint')}</span>
    </div>
  </div>`;
}

export function renderDuel(): void {
  const main = $('#b-main');
  const b = boardState();
  if (!main || !b?.view) return;
  const mark = focusMark(main);
  main.innerHTML = duelHTML(b, b.view);
  main.dataset.duel = duelKey(b);
  bindStage(boardPick, () => boardState()?.busy ?? true);
  if (authoring(b)) markAuthorPair();
  refocus(mark);
}

const rankHeadHTML = (): string => `<div class="b-rank-head"><h2>${t('crowdTitle')}</h2>
    <label class="live-toggle"><input type="checkbox" id="b-live" ${live() ? 'checked' : ''}> ${t('live')}</label></div>`;

/** The crowd ranking under its heading: the rows, the refresh button, the agreement, the reset link. */
function rankingHTML(b: Board, v: BoardView): string {
  const s = v.settings;
  const reset =
    s.allowChange && v.status === 'open' && b.count
      ? `<p class="b-foot"><button class="link" type="button" data-action="b-reset">${t('resetMyVotes')}</button></p>`
      : '';
  const shown = b.shown;
  if (!shown) {
    if (s.visibility !== 'after') return `<p class="note">${t('hiddenBlind')}</p>${reset}`;
    const need = revealAt(s.revealAfter, v.items.length);
    const k = Math.min(b.count, need);
    return `<p class="note">${t('hiddenAfter', { n: need, k })}</p>
      <span class="bar b-progress"><i style="width:${Math.round((100 * k) / need)}%"></i></span>${reset}`;
  }
  const newer = b.latestVotes - b.shownVotes;
  const refresh =
    !live() && b.latest !== b.shown && newer > 0
      ? `<button class="btn sm b-refresh" type="button" data-action="b-refresh">${t('refreshVotes', { n: newer })}</button>`
      : '';
  const close = neckAndNeck(shown);
  const rows = shown.order
    .map((id, i) => {
      const it = itemOf(id);
      const x = shown.stats[id];
      if (!it || !x) return '';
      // A text for screen readers: an aria-label on a plain span is ignored.
      const neck = close.has(id)
        ? `<span class="neck" role="img" title="${t('neck')}" aria-label="${t('neck')}">≈</span>`
        : '';
      return `<li><span class="pos mono">${i + 1}</span>${thumbHTML(it)}<span class="rlabel">${esc(it.label)}</span>${neck}<span class="num mono">${fmtCrowd(shown.method, x)}</span></li>`;
    })
    .join('');
  const ag = agreement(b.mine, shown);
  const agree = ag === null ? '' : `<p class="b-agree">${t('agreement', { pct: pct(Math.round(ag * 100)) })}</p>`;
  return `${refresh}<ol class="b-rows">${rows}</ol>${agree}${reset}`;
}

/**
 * Draws the crowd ranking. Its heading and the Live switch are drawn once: a live update replaces the rows only,
 * so whoever is on the switch (the way to pause the updates) keeps it.
 */
export function renderRanking(): void {
  const el = $('#b-rank');
  const b = boardState();
  if (!el || !b?.view) return;
  let body = $('#b-rank-body', el);
  if (!body) {
    el.innerHTML = `${rankHeadHTML()}<div id="b-rank-body"></div>`;
    body = $('#b-rank-body', el);
  }
  if (!body) return;
  const mark = focusMark(body);
  body.innerHTML = rankingHTML(b, b.view);
  refocus(mark);
}

// ─── Voting ─────────────────────────────────────────────────────────────────

let checking = false;

/**
 * The server holds a first vote on one of the site's own boards for a human check: the widget in a modal, its token
 * to the server, and votes wait for the answer; the voter then votes again.
 */
async function humanCheck(b: Board): Promise<void> {
  if (checking) return;
  if (!turnstileKey()) {
    toast(t('captchaFailed'));
    return;
  }
  checking = true;
  const asked = ask({
    title: t('checkTitle'),
    html: `<p>${t('checkBody')}</p><div class="pub-captcha" id="vote-captcha"></div>`,
    ok: t('checkOk'),
  });
  const widget = turnstileWidget('#vote-captcha');
  const ok = await asked;
  const token = widget.take();
  checking = false;
  if (!ok || boardState() !== b) return;
  if (!token) toast(t('checkMissing'));
  else if (!b.socket?.send({ t: 'check', token })) toast(t('notSent'));
  else castCheck(b);
}

export function boardPick(side: string | undefined): void {
  const b = boardState();
  if (!canVote(b)) return;
  const pair = b.pairs[0];
  const A = pair ? itemOf(pair[0]) : undefined;
  const C = pair ? itemOf(pair[1]) : undefined;
  if (!pair || !A || !C) return;
  const s = outcomeOf(side);
  if (!b.socket?.send({ t: 'vote', a: A.id, b: C.id, s })) {
    toast(t('notSent'));
    renderDuel();
    return;
  }
  castVote(b, { a: A.id, b: C.id, s });
  b.busy = true;
  playPick(side, A, C);
  // At least the server's minimum delay between two votes, even with reduced motion.
  setTimeout(
    () => {
      b.busy = false;
      if (boardState() !== b) return;
      // The last pair: the result gets a page of its own.
      if (b.view?.status === 'open' && b.count >= totalPairs(b.view.items.length)) {
        trackEvent('board-finished', { items: b.view.items.length });
        openFinale();
      } else renderDuel();
    },
    reduced ? 200 : 540,
  );
}

export function boardSkip(): void {
  const b = boardState();
  if (!canVote(b)) return;
  const pair = b.pairs[0];
  if (!pair) return;
  if (!b.socket?.send({ t: 'skip', a: pair[0], b: pair[1] })) {
    toast(t('notSent'));
    return;
  }
  castSkip(b);
  renderDuel();
}

/** Deletes my last vote; the server puts its pair back first in my queue. */
export function boardUndo(): void {
  const b = boardState();
  if (!canVote(b)) return;
  const last = b.mine[b.mine.length - 1];
  if (!last) return;
  if (!b.socket?.send({ t: 'undo', a: last.a, b: last.b })) {
    toast(t('notSent'));
    return;
  }
  castUndo(b, last);
  renderDuel();
  toast(t('voteUndone'));
}

export async function boardReset(): Promise<void> {
  const b = boardState();
  if (!b?.view) return;
  const ok = await ask({
    title: t('resetMyVotesTitle'),
    body: t('resetMyVotesBody', { votes: plural(b.count, 'vote') }),
    ok: t('resetMyVotes'),
    danger: true,
  });
  if (!ok || boardState() !== b) return;
  if (!b.socket?.send({ t: 'reset' })) {
    toast(t('notSent'));
    return;
  }
  castReset(b);
  renderDuel();
  renderRanking();
  toast(t('votesCleared'));
}

/** The duel's keys on a board, as on a local ranking (duel.ts). */
export function boardKeydown(e: KeyboardEvent, tg: HTMLElement): void {
  // The author votes from the Duel tab only.
  const b = boardState();
  if (!b?.view || b.finale || (b.isOwner && effTab() !== 'duel')) return;
  duelKeys(e, tg, { pick: boardPick, skip: boardSkip, undo: boardUndo });
}

// ─── End of the vote ────────────────────────────────────────────────────────

/** The end-of-vote page's view, remembered in this browser: podium first. */
export const resultView = (): ResultView => (S.prefs.resultView === 'duo' ? 'duo' : 'podium');

const finaleData = (b: Board, v: BoardView): FinaleData => ({
  title: v.title,
  status: v.status,
  countsLine: countsText(b.counts),
  items: v.items,
  method: v.settings.method,
  mine: b.mine,
  count: b.count,
  crowd: b.shown,
  owner: b.isOwner,
  view: resultView(),
});

/** In place updates wait for the end of the reveal; a view switch or an opening doesn't. */
function renderFinale(b: Board, v: BoardView, mode: FinaleMode): void {
  const view = $('#view');
  if (!view) return;
  if (mode === 'none' && finalePlaying()) {
    b.finaleDirty = true;
    return;
  }
  b.finaleDirty = false;
  if (cp.id) closeColor();
  view.innerHTML = finaleHTML(finaleData(b, v));
  mountFinale(mode, () => {
    if (boardState() === b && b.finale && b.finaleDirty) renderBoard();
  });
}

/** Shows the end-of-vote page, with its reveal, in a history entry of its own: Back closes it. */
export function openFinale(): void {
  const b = boardState();
  if (!b?.view) return;
  b.finale = true;
  pushLayer('finale');
  renderBoard('play');
  window.scrollTo?.(0, 0);
}

/** Set while the end-of-vote page's entry goes away after its own button closed it: that Back is ours. */
let closing = false;

/** Back to the board from the end-of-vote page's own button: its history entry goes too. */
export function closeFinale(): void {
  if (!boardState()?.finale) return;
  hideFinale();
  if (closing || currentLayer() !== 'finale') return;
  closing = true;
  popLayer('finale');
}

function hideFinale(): void {
  const b = boardState();
  if (!b?.finale) return;
  b.finale = false;
  resetFinale();
  renderBoard();
  window.scrollTo?.(0, 0);
}

/** Every pair voted: the end-of-vote page can show. */
const votedAll = (b: Board, v: BoardView): boolean => b.count > 0 && b.count >= totalPairs(v.items.length);

/** Back or Forward between the board and its end-of-vote page, at the same address. */
export function followLayer(): void {
  const b = boardState();
  if (closing) {
    closing = false;
    return;
  }
  if (!b?.view) return;
  const finale = currentLayer() === 'finale';
  if (finale === b.finale) return;
  if (!finale) hideFinale();
  else if (votedAll(b, b.view)) {
    b.finale = true;
    renderBoard();
  } else dropLayer();
}

/** Podium or face-à-face; remembered in this browser. */
export function setFinaleView(v: string | undefined): void {
  if (!boardState()?.finale || (v !== 'podium' && v !== 'duo') || v === resultView()) return;
  S.prefs.resultView = v;
  savePrefs(S.prefs);
  renderBoard('swap');
  $(`[data-action="b-finale-view"][data-view="${v}"]`)?.focus();
}

/** Which ranking the podium shows: the crowd's or the voter's own. */
export function setFinaleWho(w: string | undefined): void {
  if (!boardState()?.finale) return;
  setPodiumWho(w);
  renderBoard('swap');
  $(`[data-action="b-finale-who"][data-who="${w === 'me' ? 'me' : 'crowd'}"]`)?.focus();
}

// ─── Live updates and sharing ───────────────────────────────────────────────

export function boardRefresh(): void {
  const b = boardState();
  if (!b) return;
  b.shown = b.latest;
  b.shownVotes = b.latestVotes;
  renderRanking();
  if (authoring(b)) refreshAuthorList(true);
}

/** Handles the board's form fields; returns true when the change belonged to the board page. */
export function boardChange(tg: HTMLInputElement): boolean {
  if (tg.id === 'b-live') {
    S.prefs.live = tg.checked;
    savePrefs(S.prefs);
    if (tg.checked) boardRefresh();
    else renderRanking();
    return true;
  }
  return authorChange(tg);
}

// ─── Items ──────────────────────────────────────────────────────────────────

/**
 * A visitor's suggestion from the add field, over the socket; everyone then gets the new state. The author's own
 * add field is the items pane's (author.ts).
 */
export function boardSuggest(text: string): void {
  const b = boardState();
  if (!b?.view || b.isOwner) return;
  const item = typed(text);
  if (!item.label || suggesting(b)) return;
  if (!b.socket?.send({ t: 'add', item })) {
    toast(t('notSent'));
    return;
  }
  castSuggest(b, text);
  addBusy(true);
}

export async function copyBoardLink(alias: string | undefined, admin = false): Promise<void> {
  if (!alias) return;
  const token = admin ? loadOwners()[alias] : null;
  // The author's token rides in the fragment, which browsers never send to a server.
  const url = token ? `${boardURL(alias)}${ownerFragment(token)}` : boardURL(alias);
  toast((await copyText(url)) ? t(token ? 'adminCopied' : 'linkCopied') : t('copyNA'));
}

export const boardShare = (): Promise<void> => copyBoardLink(boardState()?.alias);
export const boardAdminLink = (): Promise<void> => copyBoardLink(boardState()?.alias, true);

/** What sharing the board as an image needs: the board on screen, the crowd as this viewer sees it, the duel up. */
export interface BoardShare {
  alias: string;
  view: BoardView;
  ranking: RankingView | null;
  mine: Duel[];
  counts: Counts;
  pair: [Item, Item] | null;
  isOwner: boolean;
}

export function boardShareData(): BoardShare | null {
  const b = boardState();
  if (!b?.view) return null;
  const pair = b.pairs[0];
  const A = pair ? itemOf(pair[0]) : undefined;
  const C = pair ? itemOf(pair[1]) : undefined;
  return {
    alias: b.alias,
    view: b.view,
    ranking: b.shown,
    mine: b.mine,
    counts: b.counts,
    pair: A && C && b.view.status === 'open' ? [A, C] : null,
    isOwner: b.isOwner,
  };
}

/** A ranking of this browser with the board's items, for a voter who wants their own version. */
export function boardMakeMine(): void {
  const v = boardState()?.view;
  if (v) makeOwn(v.title, v.items, 'board');
}

const REASON_KEYS: Record<ReportReason, MsgKey> = {
  spam: 'reportSpam',
  offensive: 'reportOffensive',
  personal: 'reportPersonal',
  other: 'reportOther',
};

/** Reports the board to the moderator: a reason from the list and a few words, sent with the anonymous voter id. */
export async function boardReport(): Promise<void> {
  const b = boardState();
  if (!b?.view) return;
  const options = REPORT_REASONS.map(
    (r, i) =>
      `<label class="opt"><input type="radio" name="report-reason" value="${r}" ${i === 0 ? 'checked' : ''}> ${t(REASON_KEYS[r])}</label>`,
  ).join('');
  const html = `<p class="muted">${t('reportBody')}</p>
    <fieldset class="set"><legend class="sr-only">${t('reportReason')}</legend>${options}</fieldset>
    <label class="report-note"><span class="muted">${t('reportNote')}</span>
      <textarea id="report-note" rows="3" maxlength="${LIMITS.note}"></textarea></label>`;
  const ok = await ask({ title: t('reportTitle'), html, ok: t('reportSend'), danger: true });
  if (!ok || boardState() !== b) return;
  const picked = ($('input[name="report-reason"]:checked') as HTMLInputElement | null)?.value;
  const reason = REPORT_REASONS.includes(picked as ReportReason) ? (picked as ReportReason) : 'other';
  const note = ($('#report-note') as HTMLTextAreaElement | null)?.value.trim() ?? '';
  try {
    await reportBoard(b.alias, { voter: S.voter, reason, note });
    toast(t('reported'));
  } catch (e) {
    // Reports come from the board's voters: someone who voted at least once.
    toast(t(errorKey(e, REPORT_ERRORS)));
  }
}

// ─── Author ─────────────────────────────────────────────────────────────────

/** Calls an owner route; the server then pushes the new state to every connection, this one included. */
export async function ownerCall<T>(fn: (alias: string, token: string) => Promise<T>): Promise<T | null> {
  const b = boardState();
  if (!b?.owner) return null;
  try {
    return await fn(b.alias, b.owner);
  } catch (e) {
    toast(t(errorKey(e, OWNER_ERRORS)));
    return null;
  }
}

export const boardStatus = (status: BoardStatus): Promise<unknown> =>
  ownerCall((alias, token) => setBoardStatus(alias, token, status));

/** An approved picture as the app keeps images: a JPEG data URL (the server takes JPEGs only). */
async function jpegURL(res: Response): Promise<string> {
  let bin = '';
  for (const b of new Uint8Array(await res.arrayBuffer())) bin += String.fromCharCode(b);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

/**
 * The pictures of a board's items as data URLs, by item id: the local ranking's own when it still has them (sent
 * for review or not), else the approved picture read from the server. One that can't be read is left out.
 */
async function picturesOf(items: readonly Item[], local: Ranking | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of items) {
    const own = local?.items.find((i) => i.id === it.id);
    const mine = own ? imageSrc(own) : null;
    const theirs = imageSrc(it);
    if (mine?.startsWith('data:')) out.set(it.id, mine);
    else if (theirs?.startsWith('/img/')) {
      try {
        const res = await fetch(theirs);
        if (res.ok) out.set(it.id, await jpegURL(res));
      } catch {
        /* the item stays as text */
      }
    }
  }
  return out;
}

/** Deletes the board and brings the crowd's result back as a local ranking, its pictures kept. */
export async function boardWithdraw(): Promise<void> {
  const b = boardState();
  if (!b?.owner) return;
  const ok = await ask({ title: t('withdrawTitle'), body: t('withdrawBody'), ok: t('withdraw'), danger: true });
  if (!ok || boardState() !== b) return;
  b.leaving = true;
  // The board's pictures go with it: read them first, so the copy keeps them.
  const pictures = await picturesOf(b.view?.items ?? [], localOf(b.alias));
  const copy = await ownerCall(withdrawBoard);
  if (!copy) {
    b.leaving = false;
    return;
  }
  saveOwner(b.alias, null);
  copy.items = copy.items.map(({ pic: _, ...it }) => ({
    ...it,
    img: pictures.get(it.id) ?? (it.img?.startsWith('data:') ? it.img : null),
  }));
  let target = localOf(b.alias);
  if (target) {
    target.title = copy.title;
    target.items = copy.items;
    target.history = copy.history;
    target.method = copy.method;
    target.pair = null;
    target.updated = Date.now();
    delete target.pub;
  } else {
    target = { ...copy, id: uid(), pair: null };
    S.ranks.push(target);
  }
  save();
  leaveBoard();
  open(target.id, 'results', { replace: true });
  toast(t('withdrawn'));
}

/** After a board is gone: the author's ranking becomes a plain local ranking again, as it was before publishing. */
export function boardUnlink(): void {
  const b = boardState();
  const local = b ? localOf(b.alias) : undefined;
  if (!b || !local) return;
  delete local.pub;
  saveOwner(b.alias, null);
  save();
  leaveBoard();
  open(local.id, 'duel', { replace: true });
}
