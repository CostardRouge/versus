import { DurableObject } from 'cloudflare:workers';
import {
  ACTION_INTERVAL_MS,
  addItems,
  addReport,
  admitNewVoter,
  awaitsPicture,
  boardMeta,
  canSeeRanking,
  clearReports,
  createBoard,
  crowd,
  DEFAULT_MODERATION,
  decidePicture,
  editItem,
  type ImagePolicy,
  isRecord,
  itemId,
  keepsVoter,
  LIMITS,
  lastActivity,
  localCopy,
  moderate,
  NEW_VOTERS_WINDOW_MS,
  type NewItem,
  needsCheck,
  type Origin,
  openSession,
  type PublishInput,
  parseItemEdit,
  parseModeration,
  parseNewItem,
  parseReport,
  pendingPictures,
  picturePath,
  recentVotes,
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
  type AdminBoardView,
  adminBoardView,
  type BoardSummary,
  boardSummary,
  boardView,
  countsOf,
  myDuels,
  parseClientMessage,
  protocolSupported,
  rankingView,
  type ServerMessage,
  type Unfurl,
  unfurlOf,
} from '../../src/core/protocol';
import { pairKey } from '../../src/core/scoring';
import { type CardSender, cardKey, previewRanked } from '../../src/core/share';
import type {
  BoardMeta,
  BoardSettings,
  BoardStatus,
  Computed,
  Item,
  Moderation,
  Outcome,
  Ranking,
  Report,
  ReportReason,
  Result,
  Session,
  SharedBoard,
  Vote,
} from '../../src/core/types';
import { deleteCards } from './cards';
import type { Env } from './env';
import { errorText, log } from './log';
import { deletePicture, deletePrefix } from './pictures';
import { DAY_MS, deleteBoard, type RegistryRow, upsertBoard } from './registry';
import { verifyTurnstile } from './turnstile';

/** Minimum delay between two ranking broadcasts, and maximum age of the cached crowd ranking. */
const BROADCAST_MS = 1000;
/** Close code sent when the board no longer exists (withdrawn or expired). */
const GONE = 4004;
/** Up to this many voters, each new voter refreshes the registry row (then once a day). */
const FRESH_VOTERS = 100;
/** A connection's address tag when the platform gives no address (local tools, tests without the header). */
const NO_ADDRESS = 'local';
/** Addresses remembered for their new voters before old ones are swept out. */
const ADDRESSES_SWEPT_AT = 1000;

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

// Visitors' reports, one per voter (docs/published-boards.md#moderation). Its own statement: boards stored
// before it exists get the table when they wake.
const REPORTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  voter TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  t INTEGER NOT NULL
) WITHOUT ROWID;`;

interface StoredMeta extends BoardMeta {
  alias: string;
  ownerHash: string;
}

type VoteRow = { voter: string; a: string; b: string; s: number; t: number; seq: number };
type ReportRow = { voter: string; reason: ReportReason; note: string; t: number };

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
  /** Voters at the last registry write: a new voter on a young board writes again (the public lists watch them). */
  private registryVoters = -1;
  private seq = 0;
  private cache: { C: Computed; at: number } | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastBroadcast = 0;
  /**
   * First votes on this board by address tag (`addressTag`), for `admitNewVoter`. In memory only, never stored:
   * the board forgets them when it sleeps, which only ever lets more in.
   */
  private newVoters = new Map<string, number[]>();

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
    this.sql.exec(REPORTS_SCHEMA);
    const reports: Report[] = this.sql
      .exec<ReportRow>('SELECT voter, reason, note, t FROM reports ORDER BY t')
      .toArray();
    this.ownerHash = ownerHash;
    // Boards stored before the registry existed have no alias: they simply stay out of it.
    this.alias = alias ?? '';
    // Boards stored before link previews have no language, before moderation no flags, before templates no
    // origin: the defaults.
    this.board = restoreBoard(
      {
        ...m,
        lang: m.lang ?? 'en',
        mod: m.mod ?? { ...DEFAULT_MODERATION },
        official: m.official ?? false,
        template: m.template ?? '',
      },
      JSON.parse(items.v) as Item[],
      votes,
      reports,
    );
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

  /**
   * Keeps the D1 registry row current: always for structural changes, at most once a day for votes, plus each
   * new voter while the board has fewer than FRESH_VOTERS (the Popular section and the template pages' index
   * threshold watch the first voters).
   */
  private touchRegistry(board: SharedBoard, force: boolean): void {
    const db = this.env.REGISTRY;
    if (!db || !this.alias) return;
    const now = Date.now();
    const day = Math.floor(now / DAY_MS);
    const voters = board.voters.size;
    const fresh = voters !== this.registryVoters && voters <= FRESH_VOTERS;
    if (!force && !fresh && day === this.registryDay) return;
    this.registryDay = day;
    this.registryVoters = voters;
    const row = this.registryRow(board, now);
    // The registry only serves the admin page and the public lists: a failed write must never fail a vote.
    this.later('registry_write_failed', upsertBoard(db, row));
  }

  /** Work that must not hold or fail the request (the registry, R2 clean-ups): a failure is logged, then forgotten. */
  private later(event: string, work: Promise<unknown>): void {
    const alias = this.alias;
    this.ctx.waitUntil(work.catch((e: unknown) => log(event, { alias, error: errorText(e) })));
  }

  /** The board's row in the registry, as of now. */
  private registryRow(board: SharedBoard, now: number): RegistryRow {
    const labels = new Map(board.items.map((it) => [it.id, it.label]));
    return {
      alias: this.alias,
      title: board.title,
      status: board.status,
      lang: board.lang,
      items: board.items.length,
      votes: board.votes.size,
      voters: board.voters.size,
      reports: board.reports.size,
      pictures: pendingPictures(board),
      hidden: board.mod.hidden,
      featured: board.mod.featured,
      template: board.template,
      recent: recentVotes(board, now),
      top: this.crowd(board)
        .order.slice(0, 3)
        .map((it) => labels.get(it.id) ?? it.label),
      created: board.created,
      active: now,
    };
  }

  private ttlMs(): number {
    const s = Number(this.env.BOARD_TTL_SECONDS);
    return (Number.isFinite(s) && s > 0 ? s : TTL_DAYS * 86_400) * 1000;
  }

  /** Whether authors may announce pictures for review (the IMAGES_UPLOAD variable). Visitors never may. */
  private imagePolicy(): ImagePolicy {
    return this.env.IMAGES_UPLOAD === 'review' ? 'review' : 'off';
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

  /**
   * Publishes the board. `origin` marks the site's own boards (official templates): they never expire, and
   * their registry row is written at once, so the page that asked for them finds it.
   */
  async publish(
    input: PublishInput,
    ownerToken: string,
    alias: string,
    origin: Origin = { official: false, template: '' },
  ): Promise<'ok' | 'exists'> {
    const ownerHash = await sha256(ownerToken);
    if (this.board) return 'exists';
    const now = Date.now();
    const board = createBoard(input, now, origin);
    this.board = board;
    this.alias = alias;
    this.ownerHash = ownerHash;
    this.cache = null;
    this.sql.exec(SCHEMA);
    this.sql.exec(REPORTS_SCHEMA);
    this.ctx.storage.transactionSync(() => {
      this.saveMeta(board);
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('items', ?)", JSON.stringify(board.items));
      for (const v of board.votes.values()) this.saveVote(v);
    });
    if (!board.official) await this.ctx.storage.setAlarm(now + this.ttlMs());
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

  /** What the board's link preview says: title, items, counts and language, never the ranking. */
  unfurl(): Unfurl | null {
    return this.board ? unfurlOf(this.board) : null;
  }

  /**
   * Who the bearer of `token` is on this board, its author or a visitor, and whether the board is one of the site's
   * own (the Worker decides what they may store with it, `cardUpload`). Null when the board is gone.
   */
  async access(token: string): Promise<{ by: CardSender; official: boolean } | null> {
    const owner = await this.isOwner(token);
    const board = this.board;
    return board ? { by: owner ? 'owner' : 'visitor', official: board.official } : null;
  }

  /** The author's settings, and the title when the patch carries one (the registry's lists show it). */
  async updateSettings(token: string, patch: unknown): Promise<Result<BoardSettings>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const title = board.value.title;
    const shown = previewRanked(board.value.settings, board.value.status);
    updateSettings(board.value, patch, Date.now());
    this.saveMeta(board.value);
    this.dirty = true;
    this.cache = null;
    this.pushState(board.value);
    if (board.value.title !== title) this.touchRegistry(board.value, true);
    this.previewChanged(board.value, shown);
    return { ok: true, value: board.value.settings };
  }

  async setStatus(token: string, status: BoardStatus): Promise<Result<BoardStatus>> {
    const board = await this.ownedBoard(token);
    return board.ok ? this.applyStatus(board.value, status) : board;
  }

  /**
   * Adds items as the author (any time the board is open, no delay): one item, or `{ items: [...] }` for a list,
   * answered with the items added (a taken label or a full board leaves the rest out).
   */
  async addItem(token: string, raw: unknown): Promise<Result<Item | Item[]>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const list = isRecord(raw) && Array.isArray(raw.items) ? raw.items : null;
    if (list && (!list.length || list.length > LIMITS.items)) return { ok: false, error: 'bad_request' };
    const inputs: NewItem[] = [];
    for (const x of list ?? [raw]) {
      const input = parseNewItem(x, this.imagePolicy());
      if (!input.ok) return input;
      inputs.push(input.value);
    }
    const r = addItems(board.value, inputs, () => this.newItemId(board.value), Date.now());
    if (!r.ok) return r;
    if (r.value.length) this.itemsChanged(board.value, []);
    if (list) return r;
    const [item] = r.value;
    return item ? { ok: true, value: item } : { ok: false, error: 'bad_request' };
  }

  /** Removes an item and its votes; returns how many votes went with it. */
  async removeItem(token: string, id: string): Promise<Result<number>> {
    const board = await this.ownedBoard(token);
    return board.ok ? this.applyRemove(board.value, id) : board;
  }

  /**
   * Renames an item or gives a color item a new fill (D116); its votes stay, or go with `reset`. Returns how many
   * votes went.
   */
  async editItem(token: string, id: string, raw: unknown): Promise<Result<number>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const edit = parseItemEdit(raw);
    if (!edit.ok) return edit;
    const before = board.value.items.find((i) => i.id === id);
    const r = editItem(board.value, id, edit.value, Date.now());
    if (!r.ok) return r;
    if (r.value.item !== before) this.itemsChanged(board.value, r.value.removed);
    return { ok: true, value: r.value.removed.length };
  }

  /**
   * Gives the board a new owner token (the old one leaked, a device was lost): the old token stops working at once;
   * connections already opened as the author keep their session.
   */
  async rotateOwner(token: string, next: string): Promise<Result<true>> {
    if (!TOKEN_RE.test(next)) return { ok: false, error: 'bad_request' };
    const nextHash = await sha256(next);
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    this.ownerHash = nextHash;
    this.saveMeta(board.value);
    return { ok: true, value: true };
  }

  /** Deletes the board and returns the author's local copy with the crowd's result. */
  async withdraw(token: string): Promise<Result<Ranking>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    const copy = localCopy(board.value, Date.now());
    await this.destroy('withdrawn');
    return { ok: true, value: copy };
  }

  /** A visitor reports the board (one report per voter, the newest kept); the admin page sees the count. */
  report(raw: unknown): Result<true> {
    const board = this.board;
    if (!board) return { ok: false, error: 'not_found' };
    const input = parseReport(raw);
    if (!input.ok) return input;
    const r = addReport(board, input.value, Date.now());
    if (!r.ok) return r;
    const { voter, reason, note, t } = r.value;
    this.sql.exec(
      `INSERT INTO reports (voter, reason, note, t) VALUES (?, ?, ?, ?)
       ON CONFLICT (voter) DO UPDATE SET reason = excluded.reason, note = excluded.note, t = excluded.t`,
      voter,
      reason,
      note,
      t,
    );
    this.touchRegistry(board, true);
    return { ok: true, value: true };
  }

  // ─── Admin (the Worker checks the admin token before calling these) ──────

  /** Everything, ranking included, whatever the visibility, with the flags and the reports. */
  adminView(): AdminBoardView | null {
    const board = this.board;
    return board ? adminBoardView(board, this.crowd(board), this.ctx.getWebSockets().length, this.alias) : null;
  }

  adminStatus(status: BoardStatus): Result<BoardStatus> {
    return this.board ? this.applyStatus(this.board, status) : { ok: false, error: 'not_found' };
  }

  adminRemoveItem(id: string): Result<number> {
    return this.board ? this.applyRemove(this.board, id) : { ok: false, error: 'not_found' };
  }

  /** Hides or features the board (docs/published-boards.md#moderation); voters see no difference. */
  adminModerate(patch: unknown): Result<Moderation> {
    const board = this.board;
    if (!board) return { ok: false, error: 'not_found' };
    const mod = moderate(board, parseModeration(patch));
    this.saveMeta(board);
    this.touchRegistry(board, true);
    return { ok: true, value: mod };
  }

  /** The reports were reviewed: they go, and the board leaves the "reported" list. */
  adminClearReports(): Result<number> {
    const board = this.board;
    if (!board) return { ok: false, error: 'not_found' };
    const n = clearReports(board).length;
    this.sql.exec('DELETE FROM reports');
    this.touchRegistry(board, true);
    return { ok: true, value: n };
  }

  // ─── Pictures (docs/published-boards.md#images) ──────────────────────────

  /** Whether the author may send this item's picture now: theirs, announced at publication, still waiting. */
  async pictureSlot(token: string, id: string): Promise<Result<true>> {
    const board = await this.ownedBoard(token);
    if (!board.ok) return board;
    return awaitsPicture(board.value, id) ? { ok: true, value: true } : { ok: false, error: 'not_found' };
  }

  /** The admin's decision on an item's picture; approved, the item shows it from its public address. */
  adminPicture(id: string, decision: 'ok' | 'refused'): Result<Item> {
    const board = this.board;
    if (!board) return { ok: false, error: 'not_found' };
    const r = decidePicture(board, id, decision, picturePath(this.alias, id));
    if (!r.ok) return r;
    this.itemsChanged(board, []);
    return r;
  }

  /** Takedown: deletes the board without a copy for anyone. */
  async adminDelete(): Promise<Result<true>> {
    if (!this.board) return { ok: false, error: 'not_found' };
    await this.destroy('removed');
    return { ok: true, value: true };
  }

  private applyStatus(board: SharedBoard, status: BoardStatus): Result<BoardStatus> {
    const shown = previewRanked(board.settings, board.status);
    setStatus(board, status, Date.now());
    this.saveMeta(board);
    this.pushState(board);
    this.touchRegistry(board, true);
    this.previewChanged(board, shown);
    return { ok: true, value: status };
  }

  /**
   * After settings or status changes: when the ranking no longer shows to everyone (results hidden again, a vote
   * reopened), the board's card goes, since it may show it; its links get the site's card until the author shares.
   */
  private previewChanged(board: SharedBoard, shown: boolean): void {
    const images = this.env.IMAGES;
    if (!shown || previewRanked(board.settings, board.status) || !images || !this.alias) return;
    this.later('cards_delete_failed', images.delete(cardKey(this.alias)));
  }

  private applyRemove(board: SharedBoard, id: string): Result<number> {
    const r = removeItem(board, id, Date.now());
    if (!r.ok) return r;
    this.itemsChanged(board, r.value);
    // Its picture, if any, goes with it.
    const images = this.env.IMAGES;
    if (images && this.alias) this.later('picture_delete_failed', deletePicture(images, this.alias, id));
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
    log('board_deleted', { alias: this.alias, reason });
    const db = this.env.REGISTRY;
    if (db && this.alias) this.later('registry_delete_failed', deleteBoard(db, this.alias));
    // The cards its links unfurled with go too.
    const images = this.env.IMAGES;
    if (images && this.alias) {
      this.later('cards_delete_failed', deleteCards(images, this.alias));
      this.later('pictures_delete_failed', deletePrefix(images, `img/${this.alias}/`));
    }
    this.board = null;
    this.cache = null;
    this.ownerHash = '';
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  override async alarm(): Promise<void> {
    const board = this.board;
    // The site's own boards never expire.
    if (!board || board.official) return;
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
    // The address rides with the socket as a tag, so it survives hibernation; hashed with the board's alias.
    this.ctx.acceptWebSocket(server, [await this.addressTag(request.headers.get('CF-Connecting-IP'))]);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A connection's address as a short hash, salted with the alias: enough to count, not to read back. */
  private async addressTag(ip: string | null): Promise<string> {
    return ip ? (await sha256(`${this.alias}:${ip}`)).slice(0, 16) : NO_ADDRESS;
  }

  /** Remembers a first vote from an address; addresses with nothing recent go once there are many. */
  private noteNewVoter(tag: string, times: number[], now: number): void {
    this.newVoters.set(tag, times);
    if (this.newVoters.size < ADDRESSES_SWEPT_AT) return;
    for (const [k, v] of this.newVoters) if (now - (v.at(-1) ?? 0) >= NEW_VOTERS_WINDOW_MS) this.newVoters.delete(k);
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = typeof raw === 'string' ? parseClientMessage(raw) : null;
    if (!msg) return send(ws, { t: 'error', code: 'bad_request' });
    let board = this.board;
    if (!board) return ws.close(GONE, 'not_found');

    if (msg.t === 'hello') {
      if (!protocolSupported(msg.v)) return send(ws, { t: 'error', code: 'upgrade' });
      const owner = msg.owner !== undefined && (await this.isOwner(msg.owner));
      board = this.board;
      if (!board) return ws.close(GONE, 'not_found');
      const prev = ws.deserializeAttachment() as Session | null;
      if (!keepsVoter(prev, msg.voter)) return send(ws, { t: 'error', code: 'forbidden' });
      const session = openSession(board, msg.voter, owner, this.crowd(board), Math.random, prev, msg.pair ?? null);
      ws.serializeAttachment(session);
      return send(ws, this.stateFor(board, session));
    }

    const session = ws.deserializeAttachment() as Session | null;
    if (!session) return send(ws, { t: 'error', code: 'hello_first' });
    const now = Date.now();

    if (msg.t === 'check') return this.check(ws, board, session, msg.token, now);

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
      // A voter's first vote on the board counts against their address.
      const tag = voteCount(board, session.voter) ? null : (this.ctx.getTags(ws)[0] ?? NO_ADDRESS);
      const admitted = tag === null ? null : admitNewVoter(this.newVoters.get(tag) ?? [], now);
      if (needsCheck(board, session, !!this.env.TURNSTILE_SECRET)) r = { ok: false, error: 'captcha' };
      else if (tag !== null && !admitted) r = { ok: false, error: 'rate_limited' };
      else {
        const res = sessionVote(board, session, msg.a, msg.b, msg.s, now, C, Math.random);
        if (res.ok) this.saveVote(res.value.vote);
        if (res.ok && tag !== null && admitted) this.noteNewVoter(tag, admitted, now);
        r = res;
      }
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

  /**
   * A human check's token, sent after a `captcha` refusal: Turnstile says yes, and the connection may cast its first
   * vote. Answered with the queue, after an error when refused. Turnstile is asked only when the vote would need
   * the check, and at most once per ACTION_INTERVAL_MS per connection.
   */
  private async check(ws: WebSocket, board: SharedBoard, session: Session, token: string, now: number): Promise<void> {
    const secret = this.env.TURNSTILE_SECRET;
    if (secret && needsCheck(board, session, true)) {
      if (now - session.lastActionAt < ACTION_INTERVAL_MS) send(ws, { t: 'error', code: 'too_fast' });
      else {
        session.lastActionAt = now;
        ws.serializeAttachment(session);
        const human = await verifyTurnstile(token, null, secret);
        // Read again after the wait: the connection may have said hello meanwhile.
        const current = ws.deserializeAttachment() as Session | null;
        if (!human) send(ws, { t: 'error', code: 'captcha' });
        else if (current) {
          current.human = true;
          ws.serializeAttachment(current);
        }
      }
    }
    const live = this.board;
    if (!live) return ws.close(GONE, 'not_found');
    const current = (ws.deserializeAttachment() as Session | null) ?? session;
    send(ws, { t: 'pairs', pairs: current.queue, mine: voteCount(live, current.voter) });
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
