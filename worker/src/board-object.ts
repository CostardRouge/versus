import { DurableObject } from 'cloudflare:workers';
import {
  addItem,
  boardMeta,
  canSeeRanking,
  createBoard,
  crowd,
  itemId,
  lastActivity,
  localCopy,
  openSession,
  type PublishInput,
  parseNewItem,
  recolorItem,
  refill,
  removeItem,
  restoreBoard,
  sessionAdd,
  sessionReset,
  sessionSkip,
  sessionUndo,
  sessionVote,
  setStatus,
  TOKEN_RE,
  TTL_DAYS,
  updateSettings,
  voteCount,
} from '../../src/core/board';
import {
  type BoardSummary,
  boardSummary,
  boardView,
  countsOf,
  myDuels,
  parseClientMessage,
  rankingView,
  type ServerMessage,
} from '../../src/core/protocol';
import { pairKey } from '../../src/core/scoring';
import type {
  BoardMeta,
  BoardSettings,
  BoardStatus,
  Computed,
  Item,
  Outcome,
  Ranking,
  Result,
  Session,
  SharedBoard,
  Vote,
} from '../../src/core/types';
import type { Env } from './env';
import { DAY_MS, deleteBoard, upsertBoard } from './registry';

/** Minimum delay between two ranking broadcasts, and maximum age of the cached crowd ranking. */
const BROADCAST_MS = 1000;
/** Close code sent when the board no longer exists (withdrawn or expired). */
const GONE = 4004;

// One row per voter and pair: a vote is a single upsert, so one row write (no extra index).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS votes (
  voter TEXT NOT NULL,
  pair TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  s REAL NOT NULL,
  t INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (voter, pair)
) WITHOUT ROWID;`;

interface StoredMeta extends BoardMeta {
  alias: string;
  ownerHash: string;
}

type VoteRow = { voter: string; a: string; b: string; s: number; t: number; seq: number };

async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function send(ws: WebSocket, msg: ServerMessage | string): void {
  try {
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  } catch {
    // The socket is already closing.
  }
}

/**
 * One published board. Holds its items, votes and settings in SQLite, keeps voters connected with
 * hibernatable WebSockets, assigns pairs, enforces visibility and deletes itself after the TTL.
 */
export class BoardObject extends DurableObject<Env> {
  private board: SharedBoard | null = null;
  private alias = '';
  private ownerHash = '';
  /** Day of the last registry write (in memory: after a wake, the first activity writes again). */
  private registryDay = -1;
  private seq = 0;
  private cache: { C: Computed; at: number } | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastBroadcast = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Runs again after hibernation: SQLite reads are synchronous, so no concurrency gap.
    this.load();
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private load(): void {
    // Only publishing creates tables: probing a random alias must not leave storage behind.
    if (!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length) return;
    const meta = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'board'").toArray()[0];
    const items = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'items'").toArray()[0];
    if (!meta || !items) return;
    const { ownerHash, alias, ...m } = JSON.parse(meta.v) as StoredMeta;
    const votes: Vote[] = [];
    for (const row of this.sql.exec<VoteRow>('SELECT voter, a, b, s, t, seq FROM votes ORDER BY seq')) {
      votes.push({ voter: row.voter, a: row.a, b: row.b, s: row.s as Outcome, t: row.t });
      this.seq = row.seq + 1;
    }
    this.ownerHash = ownerHash;
    // Boards stored before the registry existed have no alias: they simply stay out of it.
    this.alias = alias ?? '';
    this.board = restoreBoard(m, JSON.parse(items.v) as Item[], votes);
  }

  private saveMeta(board: SharedBoard): void {
    const v = JSON.stringify({
      ...boardMeta(board),
      alias: this.alias,
      ownerHash: this.ownerHash,
    } satisfies StoredMeta);
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('board', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", v);
  }

  private saveVote(v: Vote): void {
    this.sql.exec(
      `INSERT INTO votes (voter, pair, a, b, s, t, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (voter, pair) DO UPDATE SET a = excluded.a, b = excluded.b, s = excluded.s, t = excluded.t, seq = excluded.seq`,
      v.voter,
      pairKey(v.a, v.b),
      v.a,
      v.b,
      v.s,
      v.t,
      this.seq++,
    );
  }

  private deleteVotes(votes: Vote[]): void {
    for (const v of votes) this.sql.exec('DELETE FROM votes WHERE voter = ? AND pair = ?', v.voter, pairKey(v.a, v.b));
  }

  private saveItems(board: SharedBoard): void {
    this.sql.exec("UPDATE meta SET v = ? WHERE k = 'items'", JSON.stringify(board.items));
  }

  /** Keeps the D1 registry row current: always for structural changes, at most once a day for votes. */
  private touchRegistry(board: SharedBoard, force: boolean): void {
    const db = this.env.REGISTRY;
    if (!db || !this.alias) return;
    const now = Date.now();
    const day = Math.floor(now / DAY_MS);
    if (!force && day === this.registryDay) return;
    this.registryDay = day;
    const row = {
      alias: this.alias,
      title: board.title,
      status: board.status,
      items: board.items.length,
      votes: board.votes.size,
      voters: board.voters.size,
      created: board.created,
      active: now,
    };
    // The registry only serves the admin view: a failed write must never fail a vote.
    this.ctx.waitUntil(upsertBoard(db, row).catch(() => {}));
  }

  private ttlMs(): number {
    const s = Number(this.env.BOARD_TTL_SECONDS);
    return (Number.isFinite(s) && s > 0 ? s : TTL_DAYS * 86_400) * 1000;
  }

  /** Crowd ranking, recomputed at most once per BROADCAST_MS while votes keep coming. */
  private crowd(board: SharedBoard, fresh = false): Computed {
    const now = Date.now();
    if (!this.cache || (this.dirty && (fresh || now - this.cache.at >= BROADCAST_MS))) {
      this.cache = { C: crowd(board), at: now };
      this.dirty = false;
    }
    return this.cache.C;
  }

  private async isOwner(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !TOKEN_RE.test(token) || !this.ownerHash) return false;
    const enc = new TextEncoder();
    const a = enc.encode(await sha256(token));
    const b = enc.encode(this.ownerHash);
    return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
  }

  // ─── RPC from the Worker ──────────────────────────────────────────────────

  async publish(input: PublishInput, ownerToken: string, alias: string): Promise<'ok' | 'exists'> {
    const ownerHash = await sha256(ownerToken);
    if (this.board) return 'exists';
    const now = Date.now();
    const board = createBoard(input, now);
    this.board = board;
    this.alias = alias;
    this.ownerHash = ownerHash;
    this.cache = null;
    this.sql.exec(SCHEMA);
    this.ctx.storage.transactionSync(() => {
      this.saveMeta(board);
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('items', ?)", JSON.stringify(board.items));
      for (const v of board.votes.values()) this.saveVote(v);
    });
    await this.ctx.storage.setAlarm(now + this.ttlMs());
    this.touchRegistry(board, true);
    return 'ok';
  }

  /** Public view for a visitor without a connection (link previews, first paint). */
  view(): ReturnType<typeof boardView> | null {
    const board = this.board;
    if (!board) return null;
    return boardView(board, this.crowd(board), this.ctx.getWebSockets().length, canSeeRanking(board, null, false));
  }

  /** A card under a voter's "Your votes": the board as this voter may see it, and their vote count. */
  summary(voter: string): BoardSummary | null {
    const board = this.board;
    return board ? boardSummary(board, this.crowd(board), voter) : null;
  }

  async updateSettings(token: string, patch: unknown): Promise<Result<BoardSettings>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    updateSettings(board.value, patch, Date.now());
    this.saveMeta(board.value);
    this.dirty = true;
    this.cache = null;
    this.pushState(board.value);
    return { ok: true, value: board.value.settings };
  }

  async setStatus(token: string, status: BoardStatus): Promise<Result<BoardStatus>> {
    const board = await this.ownedBoard(token);
    return board.ok ? this.applyStatus(board.value, status) : board;
  }

  /** Adds an item as the author (any time the board is open, no delay). */
  async addItem(token: string, raw: unknown): Promise<Result<Item>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const input = parseNewItem(raw);
    if (!input.ok) return input;
    const r = addItem(board.value, input.value, this.newItemId(board.value), Date.now());
    if (r.ok) this.itemsChanged(board.value, []);
    return r;
  }

  /** Removes an item and its votes; returns how many votes went with it. */
  async removeItem(token: string, id: string): Promise<Result<number>> {
    const board = await this.ownedBoard(token);
    return board.ok ? this.applyRemove(board.value, id) : board;
  }

  /** Gives a color item a new fill; its votes are dropped. Returns how many votes went with them. */
  async recolorItem(token: string, id: string, fill: unknown): Promise<Result<number>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const r = recolorItem(board.value, id, fill, Date.now());
    if (!r.ok) return r;
    this.itemsChanged(board.value, r.value.removed);
    return { ok: true, value: r.value.removed.length };
  }

  /** Deletes the board and returns the author's local copy with the crowd's result. */
  async withdraw(token: string): Promise<Result<Ranking>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const copy = localCopy(board.value, Date.now());
    await this.destroy('withdrawn');
    return { ok: true, value: copy };
  }

  // ─── Admin (the Worker checks the admin token before calling these) ──────

  /** Everything, ranking included, whatever the visibility. */
  adminView(): ReturnType<typeof boardView> | null {
    const board = this.board;
    return board ? boardView(board, this.crowd(board), this.ctx.getWebSockets().length, true) : null;
  }

  adminStatus(status: BoardStatus): Result<BoardStatus> {
    return this.board ? this.applyStatus(this.board, status) : { ok: false, error: 'not_found' };
  }

  adminRemoveItem(id: string): Result<number> {
    return this.board ? this.applyRemove(this.board, id) : { ok: false, error: 'not_found' };
  }

  /** Takedown: deletes the board without a copy for anyone. */
  async adminDelete(): Promise<Result<true>> {
    if (!this.board) return { ok: false, error: 'not_found' };
    await this.destroy('removed');
    return { ok: true, value: true };
  }

  private applyStatus(board: SharedBoard, status: BoardStatus): Result<BoardStatus> {
    setStatus(board, status, Date.now());
    this.saveMeta(board);
    this.pushState(board);
    this.touchRegistry(board, true);
    return { ok: true, value: status };
  }

  private applyRemove(board: SharedBoard, id: string): Result<number> {
    const r = removeItem(board, id, Date.now());
    if (!r.ok) return r;
    this.itemsChanged(board, r.value);
    return { ok: true, value: r.value.length };
  }

  private newItemId(board: SharedBoard): string {
    for (;;) {
      const id = itemId(crypto.getRandomValues(new Uint8Array(12)));
      if (!board.items.some((i) => i.id === id)) return id;
    }
  }

  /** After items were added, changed or removed: persist, then refresh every connection (queues and state). */
  private itemsChanged(board: SharedBoard, removed: Vote[]): void {
    this.ctx.storage.transactionSync(() => {
      this.saveItems(board);
      this.saveMeta(board);
      this.deleteVotes(removed);
    });
    this.dirty = true;
    this.cache = null;
    this.pushState(board);
    this.touchRegistry(board, true);
  }

  private async ownedBoard(token: string): Promise<Result<SharedBoard>> {
    if (!this.board) return { ok: false, error: 'not_found' };
    const owner = await this.isOwner(token);
    // Re-read after the await: the board may have been withdrawn meanwhile.
    if (!this.board) return { ok: false, error: 'not_found' };
    return owner ? { ok: true, value: this.board } : { ok: false, error: 'forbidden' };
  }

  private async destroy(reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(GONE, reason);
      } catch {
        // Already closed.
      }
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const db = this.env.REGISTRY;
    if (db && this.alias) this.ctx.waitUntil(deleteBoard(db, this.alias).catch(() => {}));
    this.board = null;
    this.cache = null;
    this.ownerHash = '';
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  override async alarm(): Promise<void> {
    const board = this.board;
    if (!board) return;
    const due = lastActivity(board) + this.ttlMs();
    if (Date.now() >= due) await this.destroy('expired');
    else await this.ctx.storage.setAlarm(due);
  }

  // ─── WebSockets ───────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (!this.board) return Response.json({ error: 'not_found' }, { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'bad_request' }, { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = typeof raw === 'string' ? parseClientMessage(raw) : null;
    if (!msg) return send(ws, { t: 'error', code: 'bad_request' });
    let board = this.board;
    if (!board) return ws.close(GONE, 'not_found');

    if (msg.t === 'hello') {
      const owner = msg.owner !== undefined && (await this.isOwner(msg.owner));
      board = this.board;
      if (!board) return ws.close(GONE, 'not_found');
      const prev = ws.deserializeAttachment() as Session | null;
      const session = openSession(board, msg.voter, owner, this.crowd(board), Math.random, prev?.lastActionAt);
      ws.serializeAttachment(session);
      return send(ws, this.stateFor(board, session));
    }

    const session = ws.deserializeAttachment() as Session | null;
    if (!session) return send(ws, { t: 'error', code: 'hello_first' });
    const now = Date.now();

    if (msg.t === 'add') {
      const input = parseNewItem(msg.item);
      const res = input.ok ? sessionAdd(board, session, input.value, this.newItemId(board), now) : input;
      if (!res.ok) {
        send(ws, { t: 'error', code: res.error });
        return send(ws, { t: 'pairs', pairs: session.queue, mine: voteCount(board, session.voter) });
      }
      // Everyone, this connection included, gets the new state (and a queue that can use the new item).
      ws.serializeAttachment(session);
      return this.itemsChanged(board, []);
    }

    const C = this.crowd(board);
    let r: Result<unknown>;
    if (msg.t === 'vote') {
      const res = sessionVote(board, session, msg.a, msg.b, msg.s, now, C, Math.random);
      if (res.ok) this.saveVote(res.value.vote);
      r = res;
    } else if (msg.t === 'skip') {
      r = sessionSkip(board, session, msg.a, msg.b, now, C, Math.random);
    } else if (msg.t === 'undo') {
      const res = sessionUndo(board, session, msg.a, msg.b, now);
      if (res.ok) this.deleteVotes([res.value]);
      r = res;
    } else {
      const res = sessionReset(board, session, C, Math.random);
      if (res.ok) this.deleteVotes(res.value);
      r = res;
    }
    if (!r.ok) send(ws, { t: 'error', code: r.error });
    else ws.serializeAttachment(session);
    // Always resend the queue, so a client that got out of sync recovers.
    send(ws, { t: 'pairs', pairs: session.queue, mine: voteCount(board, session.voter) });
    if (r.ok && msg.t !== 'skip') this.changed();
  }

  override async webSocketClose(): Promise<void> {
    // The runtime answers the close handshake; only the online count changes.
    if (this.board) this.scheduleBroadcast();
  }

  private stateFor(board: SharedBoard, session: Session): ServerMessage {
    const visible = canSeeRanking(board, session.voter, session.owner);
    return {
      t: 'state',
      board: boardView(board, this.crowd(board), this.ctx.getWebSockets().length, visible),
      owner: session.owner,
      mine: myDuels(board, session.voter),
      pairs: session.queue,
    };
  }

  /** After settings or status changes: refresh every connection's queue and full state. */
  private pushState(board: SharedBoard): void {
    const C = this.crowd(board, true);
    for (const ws of this.ctx.getWebSockets()) {
      const session = ws.deserializeAttachment() as Session | null;
      if (!session) continue;
      refill(board, session, C, Math.random);
      ws.serializeAttachment(session);
      send(ws, this.stateFor(board, session));
    }
  }

  private changed(): void {
    this.dirty = true;
    this.scheduleBroadcast();
    if (this.board) this.touchRegistry(this.board, false);
  }

  private scheduleBroadcast(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastBroadcast + BROADCAST_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.broadcast();
    }, wait);
  }

  /** Sends counts to everyone, and the ranking only to those entitled to see it. */
  private broadcast(): void {
    const board = this.board;
    if (!board) return;
    this.lastBroadcast = Date.now();
    const sockets = this.ctx.getWebSockets();
    const counts = countsOf(board, sockets.length);
    const full = JSON.stringify({ t: 'ranking', counts, ranking: rankingView(this.crowd(board, true)) });
    const bare = JSON.stringify({ t: 'ranking', counts, ranking: null });
    for (const ws of sockets) {
      const session = ws.deserializeAttachment() as Session | null;
      if (session) send(ws, canSeeRanking(board, session.voter, session.owner) ? full : bare);
    }
  }
}
