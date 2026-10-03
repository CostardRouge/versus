import type {
  BoardSummary,
  BoardView,
  ClientMessage,
  HttpErrorCode,
  PopularBoard,
  ServerConfig,
  ServerMessage,
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

/** Close code the server uses when the board no longer exists. */
const GONE = 4004;

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

  private connect(): void {
    if (this.stopped) return;
    this.onConnection(this.tries ? 'lost' : 'connecting');
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
      if (e.code === GONE) this.gone();
      else void this.retry();
    });
  }

  private gone(): void {
    this.stopped = true;
    this.onConnection('gone');
  }

  private async retry(): Promise<void> {
    try {
      await fetchBoard(this.alias);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') return this.gone();
    }
    if (this.stopped) return;
    this.tries++;
    this.onConnection('lost');
    this.timer = setTimeout(() => this.connect(), Math.min(15_000, 500 * 2 ** this.tries));
  }

  /** The owner token the next connections say hello with (the author made a new one). */
  setOwner(owner: string): void {
    if (this.hello.t === 'hello') this.hello = { ...this.hello, owner };
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
