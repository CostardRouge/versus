import type { BoardView, ClientMessage, ServerMessage } from '../core/protocol';
import type { PublishRequest } from '../core/published';
import type { BoardSettings, BoardStatus, ErrorCode, Fill, Item, Ranking } from '../core/types';

/**
 * Network client for published boards. The API lives under /api: on the same origin in dev (the Vite
 * server proxies it to `npm run worker:dev`) and in the Worker build (VITE_API_URL=/ in .env.worker),
 * or elsewhere with an absolute VITE_API_URL. A build without it (GitHub Pages) hides publishing.
 */

const configured = import.meta.env.VITE_API_URL as string | undefined;
const API: string | null = configured !== undefined ? configured.replace(/\/+$/, '') : import.meta.env.DEV ? '' : null;

export const online = (): boolean => API !== null;

export class ApiError extends Error {
  constructor(readonly code: ErrorCode | 'network') {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API ?? ''}/api/boards${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: ErrorCode }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? 'network');
  return data as T;
}

export const publishBoard = (req: PublishRequest & { turnstile?: string }) =>
  call<{ alias: string; owner: string }>('POST', '', req);
export const fetchBoard = (alias: string) => call<BoardView>('GET', `/${alias}`);
export const patchBoard = (alias: string, token: string, patch: Partial<BoardSettings>) =>
  call<BoardSettings>('PATCH', `/${alias}`, patch, token);
export const setBoardStatus = (alias: string, token: string, status: BoardStatus) =>
  call<BoardStatus>('POST', `/${alias}/${status === 'closed' ? 'close' : 'reopen'}`, undefined, token);
export const addBoardItem = (alias: string, token: string, item: { label: string; fill: Fill | null }) =>
  call<Item>('POST', `/${alias}/items`, item, token);
/** Removes an item and the votes that involve it; resolves with how many votes went. */
export const removeBoardItem = (alias: string, token: string, id: string) =>
  call<number>('DELETE', `/${alias}/items/${encodeURIComponent(id)}`, undefined, token);
/** Deletes the board; the server hands back the author's local copy. */
export const withdrawBoard = (alias: string, token: string) => call<Ranking>('DELETE', `/${alias}`, undefined, token);

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
    private readonly hello: ClientMessage,
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
