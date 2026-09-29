import type { BoardObject } from './board-object';

export interface Env {
  BOARDS: DurableObjectNamespace<BoardObject>;
  /** Inactivity TTL override, in seconds (tests use a few seconds). Defaults to TTL_DAYS. */
  BOARD_TTL_SECONDS?: string;
}
