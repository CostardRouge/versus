import {
  type BoardSummary,
  type BoardView,
  CLOSE_GONE,
  type ClientMessage,
  type HttpErrorCode,
  type PopularBoard,
  type ServerConfig,
  type ServerMessage,
} from '../core/protocol';
import type { PublishRequest } from '../core/published';
import { duelQuery } from '../core/share';
import type { BoardSettings, BoardStatus, Fill, Item, Ranking, ReportReason } from '../core/types';

/**
 * Network client for published boards. The API lives under /api: on the same origin in dev (the Vite
 * server proxies it to `npm run worker:dev`) and in the Worker build (VITE_API_URL=/ in .env.worker),
 * or elsewhere with an absolute VITE_API_URL. A build without it (GitHub Pages) hides publishing.
 */

const configured = import.meta.env.VITE_API_URL as string | undefined;
const API: string | null = configured !== undefined ? configured.replace(/\/+$/, '') : import.meta.env.DEV ? '' : null;

export const online = (): boolean => API !== null;

/** How long a request may take before it counts as a network failure (a hung connection must not hang the app). */
export const TIMEOUT_MS = 15_000;

/** Why a call failed: the server's code, or `network` when it couldn't be reached (or didn't say why). */
export type ApiCode = HttpErrorCode | 'network';

export class ApiError extends Error {
  constructor(readonly code: ApiCode) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string, root = '/api/boards'): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API ?? ''}${root}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('network');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: HttpErrorCode }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? 'network');
  return data as T;
}

export const publishBoard = (req: PublishRequest & { turnstile?: string }) =>
  call<{ alias: string; owner: string }>('POST', '', req);
export const fetchBoard = (alias: string) => call<BoardView>('GET', `/${alias}`);
/** The board's settings, and its title. */
export const patchBoard = (alias: string, token: string, patch: Partial<BoardSettings> & { title?: string }) =>
  call<BoardSettings>('PATCH', `/${alias}`, patch, token);
export const setBoardStatus = (alias: string, token: string, status: BoardStatus) =>
  call<BoardStatus>('POST', `/${alias}/${status === 'closed' ? 'close' : 'reopen'}`, undefined, token);
/** An item the author adds; `pic: 'pending'` announces a picture, sent next with `putItemImage`. */
export interface NewBoardItem {
  label: string;
  fill: Fill | null;
  pic?: 'pending';
}
export const addBoardItem = (alias: string, token: string, item: NewBoardItem) =>
  call<Item>('POST', `/${alias}/items`, item, token);
/** Several items in one request (a pasted list, images); resolves with those added, taken labels left out. */
export const addBoardItems = (alias: string, token: string, items: NewBoardItem[]) =>
  call<Item[]>('POST', `/${alias}/items`, { items }, token);
/** Removes an item and the votes that involve it; resolves with how many votes went. */
export const removeBoardItem = (alias: string, token: string, id: string) =>
  call<number>('DELETE', `/${alias}/items/${encodeURIComponent(id)}`, undefined, token);
/** Renames an item or gives a color item a new fill; its votes go with `reset`. Resolves with how many went. */
export const editBoardItem = (
  alias: string,
  token: string,
  id: string,
  edit: { label?: string; fill?: Fill; reset: boolean },
) => call<number>('PATCH', `/${alias}/items/${encodeURIComponent(id)}`, edit, token);
/** Deletes the board; the server hands back the author's local copy. */
export const withdrawBoard = (alias: string, token: string) => call<Ranking>('DELETE', `/${alias}`, undefined, token);
/** A new owner token for the board; the old one stops working. */
export const rotateOwner = (alias: string, token: string) =>
  call<{ owner: string }>('POST', `/${alias}/owner`, undefined, token);
/** Boards as this voter may see them, for "Your votes"; null for a board that no longer exists. */
export const fetchSummaries = (voter: string, aliases: string[]) =>
  call<Record<string, BoardSummary | null>>('POST', '', { voter, aliases }, undefined, '/api/summaries');
/** The Popular section of one language: featured boards and the official templates, the liveliest first. */
export async function fetchPopular(lang: string): Promise<PopularBoard[]> {
  const data = await call<{ boards?: unknown }>('GET', `?lang=${lang}`, undefined, undefined, '/api/popular');
  return Array.isArray(data?.boards) ? (data.boards as PopularBoard[]) : [];
}
/** Reports a board to the moderator: a reason and a few words, with this browser's anonymous voter id. */
export const reportBoard = (alias: string, report: { voter: string; reason: ReportReason; note: string }) =>
  call<true>('POST', `/${alias}/report`, report);

let configCache: Promise<ServerConfig> | null = null;

/**
 * What the server allows: pictures for review, or not (`off`, also when it can't be reached). A yes is kept for the
 * session; a no is asked again next time (the browser keeps the answer five minutes), so pictures turned on show up
 * without a reload.
 */
export function fetchConfig(): Promise<ServerConfig> {
  configCache ??= call<ServerConfig | null>('GET', '', undefined, undefined, '/api/config').then(
    (c): ServerConfig => {
      if (c?.images === 'review') return { images: 'review' };
      configCache = null;
      return { images: 'off' };
    },
    (): ServerConfig => {
      configCache = null;
      return { images: 'off' };
    },
  );
  return configCache;
}

/** Sends bytes the server keeps as a file (a card, a picture); resolves with the answer's JSON. */
async function upload<T>(path: string, body: Blob, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': body.type };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API ?? ''}${path}`, { method: 'PUT', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ApiError('network');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: HttpErrorCode }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? 'network');
  return data as T;
}

/**
 * The card a board's link (or one duel's link) unfurls with: a PNG the app drew, sent with the author's token when
 * this browser holds it (the board's own card needs it). Resolves with its address.
 */
export async function putCard(
  alias: string,
  png: Blob,
  pair: readonly [string, string] | null,
  token?: string,
): Promise<string> {
  const data = await upload<{ url?: string }>(
    `/api/boards/${alias}/card${pair ? duelQuery(pair[0], pair[1]) : ''}`,
    png,
    token,
  );
  if (!data.url) throw new ApiError('network');
  return data.url;
}

/** An item's picture, announced when the item was published or added, sent for review (the author's token). */
export const putItemImage = (alias: string, token: string, id: string, jpeg: Blob): Promise<unknown> =>
  upload(`/api/boards/${alias}/items/${encodeURIComponent(id)}/image`, jpeg, token);

export type Connection = 'connecting' | 'open' | 'lost' | 'gone';

/** How long a failed connection waits for the API to say whether the board still exists before saying it's lost. */
const LOST_AFTER_MS = 1000;

/**
 * One board's WebSocket. Says hello on every connection, reconnects with a growing delay, and reports
 * "gone" when the board was withdrawn or expired (a refused upgrade gives no reason, so it asks the API).
 */
export class BoardSocket {
  private ws: WebSocket | null = null;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly alias: string,
    private hello: ClientMessage,
    private readonly onMessage: (m: ServerMessage) => void,
    private readonly onConnection: (c: Connection) => void,
  ) {
    this.connect();
  }

  private connect(state: Connection = this.tries ? 'lost' : 'connecting'): void {
    if (this.stopped) return;
    this.onConnection(state);
    const url = new URL(`${API ?? ''}/api/boards/${this.alias}`, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url.href);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.tries = 0;
      ws.send(JSON.stringify(this.hello));
      this.onConnection('open');
    });
    ws.addEventListener('message', (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    });
    ws.addEventListener('close', (e) => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      if (e.code === CLOSE_GONE) this.gone();
      else void this.retry();
    });
  }

  private gone(): void {
    this.stopped = true;
    this.onConnection('gone');
  }

  private async retry(): Promise<void> {
    // A page still waiting for its first state says so soon, even when the API hangs as well.
    const early = setTimeout(() => {
      if (!this.stopped && !this.ws) this.onConnection('lost');
    }, LOST_AFTER_MS);
    try {
      await fetchBoard(this.alias);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') {
        clearTimeout(early);
        return this.gone();
      }
    }
    clearTimeout(early);
    // Stopped, or already trying again (retryNow).
    if (this.stopped || this.ws) return;
    this.tries++;
    this.onConnection('lost');
    this.timer = setTimeout(() => this.connect(), Math.min(15_000, 500 * 2 ** this.tries));
  }

  /** Tries again at once instead of waiting for the next attempt; nothing while a connection is being made. */
  retryNow(): void {
    if (this.stopped || this.ws) return;
    clearTimeout(this.timer);
    this.connect('connecting');
  }

  /**
   * The author made a new owner token: the open connection says hello again with it (the server took the author's
   * rights from every connection opened with the old one), and so do the next ones.
   */
  setOwner(owner: string): void {
    if (this.hello.t !== 'hello') return;
    this.hello = { ...this.hello, owner };
    this.send(this.hello);
  }

  /** False when not connected: the caller keeps its state and tells the user. */
  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }
}
