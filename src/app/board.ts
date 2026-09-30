import { trackEvent } from '../audience';
import { revealAt } from '../core/board';
import { colorTwin, fillCSS, isHex, normHex, sameFill } from '../core/colors';
import type { BoardView, ClientMessage, Counts, RankingView, ServerMessage } from '../core/protocol';
import { agreement, neckAndNeck, totalPairs } from '../core/published';
import { ownerFragment } from '../core/route';
import { pairKey } from '../core/scoring';
import type { BoardStatus, Duel, ErrorCode, Fill, Item, Outcome, Ranking } from '../core/types';
import { esc, uid } from '../core/util';
import { methodText as M, type MsgKey, pct, plural, t } from '../i18n';
import { closeColor, cp, openBoardColor } from './color';
import { $, announce, ask, copyText, reduced, thumbHTML, toast, trashSvg } from './dom';
import { bindStage, cardHTML } from './duel';
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
import { flushJoined, markGone, noteBoard } from './joined';
import { optionsHTML, readSettings, settingsHTML } from './publish';
import { makeOwn, open } from './rankings';
import {
  ApiError,
  addBoardItem,
  BoardSocket,
  type Connection,
  patchBoard,
  recolorBoardItem,
  removeBoardItem,
  setBoardStatus,
  withdrawBoard,
} from './remote';
import { routeURL } from './router';
import { S, save } from './state';
import { loadOwners, saveOwner, savePrefs } from './storage';

/**
 * Board page of a published ranking: duels come from the server queue, the crowd ranking updates live
 * (or waits for a refresh), and the author gets settings, close/reopen and withdraw.
 */

interface Board {
  alias: string;
  owner: string | null;
  socket: BoardSocket | null;
  conn: Connection | 'unavailable';
  view: BoardView | null;
  isOwner: boolean;
  /** My votes in order, updated optimistically. */
  mine: Duel[];
  /** My vote count as the server last reported it. */
  count: number;
  pairs: [string, string][];
  counts: Counts;
  /** Ranking on screen, and the newest one received (they differ while live updates are off). */
  shown: RankingView | null;
  shownVotes: number;
  latest: RankingView | null;
  latestVotes: number;
  /** One entry per message awaiting its "pairs" answer, with how to undo its optimistic change if refused. */
  pending: Pending[];
  /** Label of the item just sent, so the field empties once it shows up. */
  sentLabel: string | null;
  busy: boolean;
  /** Set while withdrawing, so the closing socket doesn't read as an expired board. */
  leaving: boolean;
  /** The end-of-vote page is showing instead of the board. */
  finale: boolean;
  /** Something changed during the reveal: render again once it ends. */
  finaleDirty: boolean;
}

interface Pending {
  kind: 'vote' | 'skip' | 'undo' | 'reset' | 'add';
  revert?: () => void;
}

let B: Board | null = null;

/** What to tell the user when the server refuses an action. */
function errorText(code: ErrorCode, kind: Pending['kind'] | undefined): MsgKey | null {
  if (code === 'closed') return 'voteClosed';
  if (code === 'final') return 'finalVotes';
  if (kind !== 'add') return null;
  const add: Partial<Record<ErrorCode, MsgKey>> = {
    full: 'boardFull',
    exists: 'itemExists',
    too_fast: 'addTooFast',
    forbidden: 'addNotAllowed',
  };
  return add[code] ?? 'actionFailed';
}

const ownerErrors: Partial<Record<string, MsgKey>> = {
  full: 'boardFull',
  exists: 'itemExists',
  too_few: 'needTwoItems',
  closed: 'voteClosed',
  rate_limited: 'tooManyTries',
};

/** A board's own address (b/<alias> under the app's folder), the link to share. */
export const boardURL = (alias: string): string => routeURL({ view: 'board', alias });

const live = (): boolean => S.prefs.live !== false;
const itemOf = (id: string): Item | undefined => B?.view?.items.find((i) => i.id === id);
const localOf = (alias: string): Ranking | undefined => S.ranks.find((r) => r.pub?.alias === alias);

/**
 * Connects to a board (or keeps the current connection when it is the same one). `wanted` is the duel a shared
 * link asked for: the server serves it first when this voter can still vote on it.
 */
export function enterBoard(alias: string, available: boolean, wanted: [string, string] | null = null): void {
  if (B?.alias === alias) return;
  leaveBoard();
  const owner = loadOwners()[alias] ?? null;
  const board: Board = {
    alias,
    owner,
    socket: null,
    conn: available ? 'connecting' : 'unavailable',
    view: null,
    isOwner: false,
    mine: [],
    count: 0,
    pairs: [],
    counts: { votes: 0, voters: 0, online: 0 },
    shown: null,
    shownVotes: 0,
    latest: null,
    latestVotes: 0,
    pending: [],
    sentLabel: null,
    busy: false,
    leaving: false,
    finale: false,
    finaleDirty: false,
  };
  B = board;
  resetFinale();
  if (!available) return;
  const hello: ClientMessage = {
    t: 'hello',
    voter: S.voter,
    ...(owner ? { owner } : {}),
    ...(wanted ? { pair: wanted } : {}),
  };
  board.socket = new BoardSocket(
    alias,
    hello,
    (m) => onMessage(board, m),
    (c) => onConnection(board, c),
  );
}

export function leaveBoard(): void {
  flushJoined();
  B?.socket?.close();
  B = null;
  resetFinale();
}

// ─── Server messages ────────────────────────────────────────────────────────

function onConnection(board: Board, c: Connection): void {
  if (B !== board) return;
  board.conn = c;
  // Nothing is deleted here: the author decides, from the page, to take back the local version.
  if (c === 'gone' && !board.leaving) {
    board.view = null;
    markGone(board.alias);
  }
  if (!board.view) renderBoard();
  else {
    const banner = $('#b-conn');
    if (banner) banner.hidden = c !== 'lost';
  }
}

function onMessage(board: Board, m: ServerMessage): void {
  if (B !== board) return;
  if (m.t === 'state') {
    board.view = m.board;
    board.isOwner = m.owner;
    board.mine = m.mine;
    board.count = m.mine.length;
    board.pairs = m.pairs;
    board.counts = m.board.counts;
    board.pending = [];
    board.shown = board.latest = m.board.ranking;
    board.shownVotes = board.latestVotes = m.board.counts.votes;
    const local = localOf(board.alias);
    if (local?.pub && local.pub.status !== m.board.status) {
      local.pub.status = m.board.status;
      save();
    }
    note(board);
    renderBoard();
  } else if (m.t === 'pairs') {
    const head = board.pending.shift();
    board.pairs = m.pairs;
    board.count = m.mine;
    note(board, head?.kind === 'vote');
    if (!board.busy) renderDuel();
    renderRanking();
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
  } else {
    const head = board.pending[0];
    if (head?.revert) {
      head.revert();
      head.revert = undefined;
      renderRanking();
    }
    if (head?.kind === 'add') board.sentLabel = null;
    const key = errorText(m.code, head?.kind);
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

const countsText = (c: Counts): string =>
  t('boardCounts', { votes: plural(c.votes, 'vote'), voters: plural(c.voters, 'voter'), online: c.online });

export function renderBoard(mode: FinaleMode = 'none'): void {
  const view = $('#view');
  const b = B;
  if (!view || !b) return;
  if (b.finale && b.view) {
    renderFinale(b, b.view, mode);
    return;
  }
  const adminOpen = $('#b-admin')?.hasAttribute('open') ?? false;
  // Keep what someone is typing when another change re-renders the page, unless it was just added.
  const draft = ($('#b-add-input') as HTMLInputElement | null)?.value ?? '';
  view.innerHTML = boardHTML(b, adminOpen);
  const input = $('#b-add-input') as HTMLInputElement | null;
  if (input && draft && draft !== b.sentLabel) input.value = draft;
  b.sentLabel = null;
  // The color editor follows its swatch through re-renders, and closes when the item can't be edited anymore.
  if (cp.id) {
    const swatch = $(`.thumb-btn[data-id="${cp.id}"]`);
    if (swatch) cp.anchor = swatch;
    else closeColor();
  }
  if (b.view) {
    renderDuel();
    renderRanking();
  }
}

function boardHTML(b: Board, adminOpen: boolean): string {
  const back = `<button class="back" type="button" data-action="back">${t('back')}</button>`;
  const v = b.view;
  if (!v) {
    const final = b.conn === 'gone' || b.conn === 'unavailable';
    const msg = b.conn === 'gone' ? t('boardGone') : b.conn === 'unavailable' ? t('boardUnavailable') : t('connecting');
    const local = b.conn === 'gone' ? localOf(b.alias) : undefined;
    const action = local
      ? `<button class="btn primary" type="button" data-action="b-unlink">${t('keepLocal')}</button>`
      : `<button class="btn primary" type="button" data-action="back">${t('yourRankings')}</button>`;
    return `<div class="board"><div class="ws-head">${back}</div>
      <div class="empty-duel"><h2 class="q">${msg}</h2>${final ? action : ''}</div></div>`;
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
        ${b.isOwner ? adminHTML(v, adminOpen) : ''}
        <section class="b-rank" id="b-rank"></section>
        ${!b.isOwner && v.settings.visitorsAddItems && !closed ? `<section class="b-suggest"><h2>${t('suggestTitle')}</h2>${addFormHTML()}</section>` : ''}
      </aside>
    </div>
  </div>`;
}

const addFormHTML = (): string =>
  `<form class="add b-add" id="b-add-form" autocomplete="off">
    <input id="b-add-input" placeholder="${t('addPlaceholder')}" aria-label="${t('suggestTitle')}" maxlength="200">
    <button class="add-btn" type="submit" aria-label="${t('add')}">+</button>
  </form>`;

/** An item's swatch: while the board is open, a color item's swatch opens the color editor. */
function itemThumbHTML(it: Item, open: boolean): string {
  if (!it.fill || !open) return thumbHTML(it);
  return `<button class="thumb thumb-btn" type="button" data-action="b-edit-color" data-id="${esc(it.id)}" style="background:${fillCSS(it.fill)}" aria-label="${esc(t('editColorAria', { label: it.label }))}" title="${t('editColor')}"></button>`;
}

function itemsHTML(v: BoardView): string {
  const open = v.status === 'open';
  const rows = v.items
    .map((it) => {
      const twin = it.fill ? colorTwin(v.items, it.id, it.fill) : undefined;
      const warn = twin ? `<small class="b-twin">${esc(t('sameColor', { label: twin.label }))}</small>` : '';
      return `<li>${itemThumbHTML(it, open)}<span class="b-item"><span class="rlabel">${esc(it.label)}</span>${warn}</span>
        <button class="icon-btn" type="button" data-action="b-remove-item" data-id="${esc(it.id)}" aria-label="${esc(t('removeAria', { label: it.label }))}">${trashSvg}</button></li>`;
    })
    .join('');
  return `<fieldset class="set"><legend>${t('boardItems')}</legend><ul class="b-items">${rows}</ul>${v.status === 'open' ? addFormHTML() : ''}</fieldset>`;
}

function adminHTML(v: BoardView, open: boolean): string {
  const closed = v.status === 'closed';
  return `<details class="b-admin" id="b-admin" ${open ? 'open' : ''}>
    <summary>${t('authorPanel')}</summary>
    <div class="b-admin-body">
      ${settingsHTML('b', v.settings)}
      ${optionsHTML('b', v.settings)}
      ${itemsHTML(v)}
      <div class="b-admin-actions">
        <button class="btn sm" type="button" data-action="${closed ? 'b-reopen' : 'b-close'}">${closed ? t('reopenVote') : t('closeVote')}</button>
        <button class="btn sm ghost" type="button" data-action="b-admin-link">${t('copyAdminLink')}</button>
        <button class="btn sm danger" type="button" data-action="b-withdraw">${t('withdraw')}</button>
      </div>
    </div>
  </details>`;
}

const emptyHTML = (title: string, body: string, action = ''): string =>
  `<div class="empty-duel"><h2 class="q">${title}</h2>${body ? `<p class="muted">${body}</p>` : ''}${action}</div>`;

/** Once every pair is voted, the way (back) to the end-of-vote page. */
const resultHTML = (b: Board, v: BoardView): string =>
  b.count && b.count >= totalPairs(v.items.length)
    ? `<button class="btn primary" type="button" data-action="b-finale">${t('seeResult')}</button>`
    : '';

function duelHTML(b: Board, v: BoardView): string {
  if (v.status === 'closed') return emptyHTML(t('voteClosed'), t('voteClosedBody'), resultHTML(b, v));
  const pair = b.pairs[0];
  const A = pair ? itemOf(pair[0]) : undefined;
  const C = pair ? itemOf(pair[1]) : undefined;
  if (!A || !C) {
    if (b.count >= totalPairs(v.items.length)) return emptyHTML(t('votedAll'), t('votedAllBody'), resultHTML(b, v));
    return `<div class="empty-duel"><p class="muted">…</p></div>`;
  }
  // No forecast and no crowd score here: the duel itself stays blind.
  return `<div class="duel">
    <div class="duel-top"><div><p class="eyebrow mono">${t('myVotes', { n: b.count })} · ${M(v.settings.method).name}</p><h2 class="q">${t('question')}</h2></div></div>
    <div class="stage enter" id="stage">
      ${cardHTML(A, 'a')}
      <div class="vs" aria-hidden="true"><span class="vs-dot">vs</span></div>
      ${cardHTML(C, 'b')}
    </div>
    <div class="controls">
      <button class="ctl ctl-a" type="button" data-action="b-pick" data-side="a"><kbd>←</kbd> ${t('aWins')}</button>
      <button class="ctl" type="button" data-action="b-pick" data-side="draw">${t('draw')} <kbd>↓</kbd></button>
      <button class="ctl" type="button" data-action="b-skip">${t('skip')} <kbd>S</kbd></button>
      <button class="ctl ctl-b" type="button" data-action="b-pick" data-side="b">${t('bWins')} <kbd>→</kbd></button>
    </div>
    <div class="duel-foot">
      <span class="duel-foot-acts"><button class="link" type="button" data-action="b-undo" ${b.mine.length ? '' : 'disabled'}>${t('undoVote')}</button><button class="link" type="button" data-action="share-duel">${t('shareDuel')}</button></span>
      <span class="muted">${t('swipeHint')}</span>
    </div>
  </div>`;
}

function renderDuel(): void {
  const main = $('#b-main');
  const b = B;
  if (!main || !b?.view) return;
  main.innerHTML = duelHTML(b, b.view);
  bindStage(boardPick, () => B?.busy ?? true);
}

function rankingHTML(b: Board, v: BoardView): string {
  const s = v.settings;
  const head = `<div class="b-rank-head"><h2>${t('crowdTitle')}</h2>
    <label class="live-toggle"><input type="checkbox" id="b-live" ${live() ? 'checked' : ''}> ${t('live')}</label></div>`;
  const reset =
    s.allowChange && v.status === 'open' && b.count
      ? `<p class="b-foot"><button class="link" type="button" data-action="b-reset">${t('resetMyVotes')}</button></p>`
      : '';
  const shown = b.shown;
  if (!shown) {
    if (s.visibility !== 'after') return `${head}<p class="note">${t('hiddenBlind')}</p>${reset}`;
    const need = revealAt(s.revealAfter, v.items.length);
    const k = Math.min(b.count, need);
    return `${head}<p class="note">${t('hiddenAfter', { n: need, k })}</p>
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
      const neck = close.has(id) ? `<span class="neck" title="${t('neck')}" aria-label="${t('neck')}">≈</span>` : '';
      return `<li><span class="pos mono">${i + 1}</span>${thumbHTML(it)}<span class="rlabel">${esc(it.label)}</span>${neck}<span class="num mono">${fmtCrowd(shown.method, x)}</span></li>`;
    })
    .join('');
  const ag = agreement(b.mine, shown);
  const agree = ag === null ? '' : `<p class="b-agree">${t('agreement', { pct: pct(Math.round(ag * 100)) })}</p>`;
  return `${head}${refresh}<ol class="b-rows">${rows}</ol>${agree}${reset}`;
}

function renderRanking(): void {
  const el = $('#b-rank');
  if (el && B?.view) el.innerHTML = rankingHTML(B, B.view);
}

// ─── Voting ─────────────────────────────────────────────────────────────────

const canVote = (b: Board | null): b is Board & { view: BoardView } => !!b?.view && !b.busy && b.view.status === 'open';

export function boardPick(side: string | undefined): void {
  const b = B;
  if (!canVote(b)) return;
  const pair = b.pairs[0];
  const A = pair ? itemOf(pair[0]) : undefined;
  const C = pair ? itemOf(pair[1]) : undefined;
  if (!pair || !A || !C) return;
  const s: Outcome = side === 'a' ? 1 : side === 'b' ? 0 : 0.5;
  if (!b.socket?.send({ t: 'vote', a: A.id, b: C.id, s })) {
    toast(t('notSent'));
    renderDuel();
    return;
  }
  const duel: Duel = { a: A.id, b: C.id, s };
  b.mine.push(duel);
  b.pending.push({
    kind: 'vote',
    revert: () => {
      b.mine = b.mine.filter((d) => d !== duel);
    },
  });
  b.pairs.shift();
  b.count++;
  b.busy = true;
  const st = $('#stage');
  if (st) {
    for (const p of ['--dx', '--pa', '--pb']) st.style.removeProperty(p);
    st.classList.remove('enter', 'dragging');
    st.classList.add('picked', `pick-${side}`);
  }
  announce(
    side === 'draw' ? t('tieBetween', { a: A.label, b: C.label }) : t('wins', { x: (side === 'a' ? A : C).label }),
  );
  // At least the server's minimum delay between two votes, even with reduced motion.
  setTimeout(
    () => {
      b.busy = false;
      if (B !== b) return;
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
  const b = B;
  if (!canVote(b)) return;
  const pair = b.pairs[0];
  if (!pair) return;
  if (!b.socket?.send({ t: 'skip', a: pair[0], b: pair[1] })) {
    toast(t('notSent'));
    return;
  }
  b.pending.push({ kind: 'skip' });
  b.pairs.shift();
  renderDuel();
}

/** Deletes my last vote; the server puts its pair back first in my queue. */
export function boardUndo(): void {
  const b = B;
  if (!canVote(b)) return;
  const last = b.mine[b.mine.length - 1];
  if (!last) return;
  if (!b.socket?.send({ t: 'undo', a: last.a, b: last.b })) {
    toast(t('notSent'));
    return;
  }
  const at = b.mine.length - 1;
  b.mine.pop();
  b.pending.push({
    kind: 'undo',
    revert: () => {
      b.mine.splice(at, 0, last);
    },
  });
  const k = pairKey(last.a, last.b);
  b.pairs = [[last.a, last.b], ...b.pairs.filter(([x, y]) => pairKey(x, y) !== k)];
  b.count = Math.max(0, b.count - 1);
  renderDuel();
  toast(t('voteUndone'));
}

export async function boardReset(): Promise<void> {
  const b = B;
  if (!b?.view) return;
  const ok = await ask({
    title: t('resetMyVotesTitle'),
    body: t('resetMyVotesBody', { votes: plural(b.count, 'vote') }),
    ok: t('resetMyVotes'),
    danger: true,
  });
  if (!ok || B !== b) return;
  if (!b.socket?.send({ t: 'reset' })) {
    toast(t('notSent'));
    return;
  }
  const prev = b.mine;
  b.mine = [];
  b.count = 0;
  b.pending.push({
    kind: 'reset',
    revert: () => {
      b.mine = prev;
    },
  });
  renderDuel();
  renderRanking();
  toast(t('votesCleared'));
}

export function boardKeydown(e: KeyboardEvent, tg: HTMLElement): void {
  if (!B?.view || B.finale) return;
  if (tg.classList.contains('card') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    boardPick(tg.dataset.side);
    return;
  }
  if (tg.matches('input, textarea, select, summary, [contenteditable]')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    boardUndo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    boardPick('a');
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    boardPick('b');
  } else if (e.key === 'ArrowDown' || e.key === '=') {
    e.preventDefault();
    boardPick('draw');
  } else if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    boardSkip();
  }
}

// ─── End of the vote ────────────────────────────────────────────────────────

const resultView = (): ResultView => (S.prefs.resultView === 'duo' ? 'duo' : 'podium');

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
    if (B === b && b.finale && b.finaleDirty) renderBoard();
  });
}

/** Shows the end-of-vote page, with its reveal. */
export function openFinale(): void {
  const b = B;
  if (!b?.view) return;
  b.finale = true;
  renderBoard('play');
  window.scrollTo?.(0, 0);
}

export function closeFinale(): void {
  const b = B;
  if (!b?.finale) return;
  b.finale = false;
  resetFinale();
  renderBoard();
  window.scrollTo?.(0, 0);
}

/** Podium or face-à-face; remembered in this browser. */
export function setFinaleView(v: string | undefined): void {
  if (!B?.finale || (v !== 'podium' && v !== 'duo') || v === resultView()) return;
  S.prefs.resultView = v;
  savePrefs(S.prefs);
  renderBoard('swap');
  $(`[data-action="b-finale-view"][data-view="${v}"]`)?.focus();
}

/** Which ranking the podium shows: the crowd's or the voter's own. */
export function setFinaleWho(w: string | undefined): void {
  if (!B?.finale) return;
  setPodiumWho(w);
  renderBoard('swap');
  $(`[data-action="b-finale-who"][data-who="${w === 'me' ? 'me' : 'crowd'}"]`)?.focus();
}

// ─── Live updates and sharing ───────────────────────────────────────────────

export function boardRefresh(): void {
  if (!B) return;
  B.shown = B.latest;
  B.shownVotes = B.latestVotes;
  renderRanking();
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
  if (tg.id === 'b-add-input') return true;
  if (tg.closest('#b-admin')) {
    void ownerCall((alias, token) => patchBoard(alias, token, readSettings($('#b-admin') ?? tg, 'b')));
    return true;
  }
  return false;
}

// ─── Items ──────────────────────────────────────────────────────────────────

/** Text, or a color for a #hex code, like the local item field. */
function newItem(raw: string): { label: string; fill: Fill | null } | null {
  const v = raw.trim();
  if (!v) return null;
  if (!isHex(v)) return { label: v, fill: null };
  return { label: normHex(v).toUpperCase(), fill: { type: 'solid', colors: [normHex(v)] } };
}

/** Adds an item: the author through the API, a visitor over the socket. Everyone then gets the new state. */
export async function boardAddItem(): Promise<void> {
  const b = B;
  const input = $('#b-add-input') as HTMLInputElement | null;
  const item = input ? newItem(input.value) : null;
  if (!b?.view || !input || !item) return;
  if (b.isOwner) {
    b.sentLabel = input.value;
    if (await ownerCall((alias, token) => addBoardItem(alias, token, item))) toast(t('itemAdded'));
    else b.sentLabel = null;
    return;
  }
  if (!b.socket?.send({ t: 'add', item })) {
    toast(t('notSent'));
    return;
  }
  b.sentLabel = input.value;
  b.pending.push({ kind: 'add' });
}

/** Removes an item after confirmation; its votes go with it. */
export async function boardRemoveItem(id: string | undefined): Promise<void> {
  const b = B;
  const it = id ? itemOf(id) : undefined;
  if (!b?.owner || !it || !id) return;
  const x = b.latest?.stats[id];
  const votes = x ? x.w + x.l + x.d : 0;
  const ok = await ask({
    title: t('removeItemTitle', { label: it.label }),
    body: t('removeItemBody', { votes: plural(votes, 'vote') }),
    ok: t('removeOk'),
    danger: true,
  });
  if (!ok || B !== b) return;
  if ((await ownerCall((alias, token) => removeBoardItem(alias, token, id))) !== null) toast(t('itemRemoved'));
}

/** Opens the color editor on a color item of the board (a second click on its swatch closes it). */
export function boardEditColor(id: string | undefined, anchor: HTMLElement): void {
  const b = B;
  const it = id ? itemOf(id) : undefined;
  if (!b?.owner || !b.view || !it?.fill) return;
  if (cp.id === it.id) {
    closeColor();
    return;
  }
  openBoardColor(it, b.view.items, anchor, (fill) => void boardRecolor(it.id, fill));
}

/**
 * Gives an item a new color for everyone. Its votes were cast on the old color, so they go (after a
 * confirmation when there are some) and the item starts again from zero.
 */
async function boardRecolor(id: string, fill: Fill): Promise<void> {
  const b = B;
  const it = itemOf(id);
  if (!b?.owner || !it?.fill || sameFill(it.fill, fill)) return;
  const x = b.latest?.stats[id];
  const votes = x ? x.w + x.l + x.d : 0;
  if (votes) {
    const ok = await ask({
      title: t('recolorTitle', { label: it.label }),
      body: t('recolorBody', { votes: plural(votes, 'vote'), label: it.label }),
      ok: t('recolorOk'),
      danger: true,
    });
    if (!ok || B !== b) return;
  }
  const n = await ownerCall((alias, token) => recolorBoardItem(alias, token, id, fill));
  if (n !== null) toast(n ? t('recoloredReset', { label: it.label }) : t('recolored'));
}

export async function copyBoardLink(alias: string | undefined, admin = false): Promise<void> {
  if (!alias) return;
  const token = admin ? loadOwners()[alias] : null;
  // The author's token rides in the fragment, which browsers never send to a server.
  const url = token ? `${boardURL(alias)}${ownerFragment(token)}` : boardURL(alias);
  toast((await copyText(url)) ? t(token ? 'adminCopied' : 'linkCopied') : t('copyNA'));
}

export const boardShare = (): Promise<void> => copyBoardLink(B?.alias);
export const boardAdminLink = (): Promise<void> => copyBoardLink(B?.alias, true);

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
  const b = B;
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
  const v = B?.view;
  if (v) makeOwn(v.title, v.items, 'board');
}

// ─── Author ─────────────────────────────────────────────────────────────────

/** Calls an owner route; the server then pushes the new state to every connection, this one included. */
async function ownerCall<T>(fn: (alias: string, token: string) => Promise<T>): Promise<T | null> {
  const b = B;
  if (!b?.owner) return null;
  try {
    return await fn(b.alias, b.owner);
  } catch (e) {
    toast(t((e instanceof ApiError && ownerErrors[e.code]) || 'actionFailed'));
    return null;
  }
}

export const boardStatus = (status: BoardStatus): Promise<unknown> =>
  ownerCall((alias, token) => setBoardStatus(alias, token, status));

/** Deletes the board and brings the crowd's result back as a local ranking. */
export async function boardWithdraw(): Promise<void> {
  const b = B;
  if (!b?.owner) return;
  const ok = await ask({ title: t('withdrawTitle'), body: t('withdrawBody'), ok: t('withdraw'), danger: true });
  if (!ok || B !== b) return;
  b.leaving = true;
  const copy = await ownerCall(withdrawBoard);
  if (!copy) {
    b.leaving = false;
    return;
  }
  saveOwner(b.alias, null);
  let target = localOf(b.alias);
  if (target) {
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
  const b = B;
  const local = b ? localOf(b.alias) : undefined;
  if (!b || !local) return;
  delete local.pub;
  saveOwner(b.alias, null);
  save();
  leaveBoard();
  open(local.id, 'duel', { replace: true });
}
