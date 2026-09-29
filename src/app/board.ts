import type { BoardView, Counts, ItemScore, RankingView, ServerMessage } from '../core/protocol';
import { adminHash, agreement, boardHash, neckAndNeck, totalPairs } from '../core/published';
import { pairKey } from '../core/scoring';
import type { BoardStatus, Duel, Item, MethodKey, Outcome, Ranking } from '../core/types';
import { esc, uid } from '../core/util';
import { methodText as M, pct, plural, t } from '../i18n';
import { $, announce, ask, copyText, reduced, thumbHTML, toast } from './dom';
import { bindStage, cardHTML } from './duel';
import { changeHTML, readSettings, settingsHTML } from './publish';
import { open } from './rankings';
import { BoardSocket, type Connection, patchBoard, setBoardStatus, withdrawBoard } from './remote';
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
  /** One entry per message awaiting its "pairs" answer: how to undo its optimistic change if refused. */
  pending: ((() => void) | null)[];
  busy: boolean;
  /** Set while withdrawing, so the closing socket doesn't read as an expired board. */
  leaving: boolean;
}

let B: Board | null = null;

export const boardURL = (alias: string): string =>
  `${location.origin}${location.pathname}${location.search}${boardHash(alias)}`;

const live = (): boolean => S.prefs.live !== false;
const itemOf = (id: string): Item | undefined => B?.view?.items.find((i) => i.id === id);
const localOf = (alias: string): Ranking | undefined => S.ranks.find((r) => r.pub?.alias === alias);

/** Connects to a board (or keeps the current connection when it is the same one). */
export function enterBoard(alias: string, available: boolean): void {
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
    busy: false,
    leaving: false,
  };
  B = board;
  if (!available) return;
  const hello = owner ? { t: 'hello' as const, voter: S.voter, owner } : { t: 'hello' as const, voter: S.voter };
  board.socket = new BoardSocket(
    alias,
    hello,
    (m) => onMessage(board, m),
    (c) => onConnection(board, c),
  );
}

export function leaveBoard(): void {
  B?.socket?.close();
  B = null;
}

// ─── Server messages ────────────────────────────────────────────────────────

function onConnection(board: Board, c: Connection): void {
  if (B !== board) return;
  board.conn = c;
  // Nothing is deleted here: the author decides, from the page, to take back the local version.
  if (c === 'gone' && !board.leaving) board.view = null;
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
    renderBoard();
  } else if (m.t === 'pairs') {
    board.pending.shift();
    board.pairs = m.pairs;
    board.count = m.mine;
    if (!board.busy) renderDuel();
    renderRanking();
  } else if (m.t === 'ranking') {
    board.counts = m.counts;
    board.latest = m.ranking;
    board.latestVotes = m.counts.votes;
    // Frozen only while something is on screen and more is visible: newly visible or hidden rankings apply now.
    if (live() || !board.shown || !m.ranking) {
      board.shown = m.ranking;
      board.shownVotes = m.counts.votes;
    }
    const counts = $('#b-counts');
    if (counts) counts.textContent = countsText(board.counts);
    renderRanking();
  } else {
    const revert = board.pending[0];
    if (revert) {
      revert();
      board.pending[0] = null;
      renderRanking();
    }
    if (m.code === 'closed') toast(t('voteClosed'));
    else if (m.code === 'final') toast(t('finalVotes'));
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

const countsText = (c: Counts): string =>
  t('boardCounts', { votes: plural(c.votes, 'vote'), voters: plural(c.voters, 'voter'), online: c.online });

function fmt(m: MethodKey, x: ItemScore): string {
  if (m === 'win') return pct(Math.round(x.score * 100));
  const se = m === 'bt' && x.se !== null ? `<small>±${Math.round(x.se)}</small>` : '';
  return `${Math.round(x.score)}${se}`;
}

export function renderBoard(): void {
  const view = $('#view');
  if (!view || !B) return;
  const adminOpen = $('#b-admin')?.hasAttribute('open') ?? false;
  view.innerHTML = boardHTML(B, adminOpen);
  if (B.view) {
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
  return `<div class="board">
    <div class="ws-head b-head">
      ${back}
      <h1 class="b-title">${esc(v.title)}</h1>
      <span class="chip ${closed ? '' : 'chip-live'}">${closed ? t('closedChip') : t('pubChip')}</span>
      <button class="btn sm" type="button" data-action="b-share">${t('copyLink')}</button>
    </div>
    <p class="b-counts mono" id="b-counts">${countsText(b.counts)}</p>
    <p class="note b-conn" id="b-conn" role="status" ${b.conn === 'lost' ? '' : 'hidden'}>${t('reconnecting')}</p>
    <div class="b-body">
      <section class="b-main" id="b-main"></section>
      <aside class="b-side">
        ${b.isOwner ? adminHTML(v, adminOpen) : ''}
        <section class="b-rank" id="b-rank"></section>
      </aside>
    </div>
  </div>`;
}

function adminHTML(v: BoardView, open: boolean): string {
  const closed = v.status === 'closed';
  return `<details class="b-admin" id="b-admin" ${open ? 'open' : ''}>
    <summary>${t('authorPanel')}</summary>
    <div class="b-admin-body">
      ${settingsHTML('b', v.settings)}
      ${changeHTML('b', v.settings)}
      <div class="b-admin-actions">
        <button class="btn sm" type="button" data-action="${closed ? 'b-reopen' : 'b-close'}">${closed ? t('reopenVote') : t('closeVote')}</button>
        <button class="btn sm ghost" type="button" data-action="b-admin-link">${t('copyAdminLink')}</button>
        <button class="btn sm danger" type="button" data-action="b-withdraw">${t('withdraw')}</button>
      </div>
    </div>
  </details>`;
}

const emptyHTML = (title: string, body: string): string =>
  `<div class="empty-duel"><h2 class="q">${title}</h2>${body ? `<p class="muted">${body}</p>` : ''}</div>`;

function duelHTML(b: Board, v: BoardView): string {
  if (v.status === 'closed') return emptyHTML(t('voteClosed'), t('voteClosedBody'));
  const pair = b.pairs[0];
  const A = pair ? itemOf(pair[0]) : undefined;
  const C = pair ? itemOf(pair[1]) : undefined;
  if (!A || !C) {
    if (b.count >= totalPairs(v.items.length)) return emptyHTML(t('votedAll'), t('votedAllBody'));
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
      <button class="link" type="button" data-action="b-undo" ${b.mine.length ? '' : 'disabled'}>${t('undoVote')}</button>
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
    const k = Math.min(b.count, s.revealAfter);
    return `${head}<p class="note">${t('hiddenAfter', { n: s.revealAfter, k })}</p>
      <span class="bar b-progress"><i style="width:${Math.round((100 * k) / s.revealAfter)}%"></i></span>${reset}`;
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
      return `<li><span class="pos mono">${i + 1}</span>${thumbHTML(it)}<span class="rlabel">${esc(it.label)}</span>${neck}<span class="num mono">${fmt(shown.method, x)}</span></li>`;
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
  b.pending.push(() => {
    b.mine = b.mine.filter((d) => d !== duel);
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
      if (B === b) renderDuel();
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
  b.pending.push(null);
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
  b.pending.push(() => {
    b.mine.splice(at, 0, last);
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
  b.pending.push(() => {
    b.mine = prev;
  });
  renderDuel();
  renderRanking();
  toast(t('votesCleared'));
}

export function boardKeydown(e: KeyboardEvent, tg: HTMLElement): void {
  if (!B?.view) return;
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
  if (tg.closest('#b-admin')) {
    void ownerCall((alias, token) => patchBoard(alias, token, readSettings($('#b-admin') ?? tg, 'b')));
    return true;
  }
  return false;
}

export async function copyBoardLink(alias: string | undefined, admin = false): Promise<void> {
  if (!alias) return;
  const token = admin ? loadOwners()[alias] : null;
  const url = token ? `${boardURL(alias).replace(boardHash(alias), adminHash(alias, token))}` : boardURL(alias);
  toast((await copyText(url)) ? t(token ? 'adminCopied' : 'linkCopied') : t('copyNA'));
}

export const boardShare = (): Promise<void> => copyBoardLink(B?.alias);
export const boardAdminLink = (): Promise<void> => copyBoardLink(B?.alias, true);

// ─── Author ─────────────────────────────────────────────────────────────────

/** Calls an owner route; the server then pushes the new state to every connection, this one included. */
async function ownerCall<T>(fn: (alias: string, token: string) => Promise<T>): Promise<T | null> {
  const b = B;
  if (!b?.owner) return null;
  try {
    return await fn(b.alias, b.owner);
  } catch {
    toast(t('actionFailed'));
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
  history.replaceState(null, '', location.pathname + location.search);
  open(target.id, 'results');
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
  history.replaceState(null, '', location.pathname + location.search);
  open(local.id, 'duel');
}
