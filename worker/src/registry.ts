import type { BoardStatus } from '../../src/core/types';

/**
 * Board registry in D1, for the admin view: Durable Objects can't be listed with their data. Each board
 * keeps its own row up to date; activity is refreshed at most once a day per board to spare writes.
 */

export interface RegistryRow {
  alias: string;
  title: string;
  status: BoardStatus;
  items: number;
  votes: number;
  voters: number;
  created: number;
  /** Last activity, refreshed at most once a day. */
  active: number;
}

export const DAY_MS = 86_400_000;

export async function upsertBoard(db: D1Database, row: RegistryRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO boards (alias, title, status, items, votes, voters, created, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (alias) DO UPDATE SET title = excluded.title, status = excluded.status, items = excluded.items,
         votes = excluded.votes, voters = excluded.voters, active = excluded.active`,
    )
    .bind(row.alias, row.title, row.status, row.items, row.votes, row.voters, row.created, row.active)
    .run();
}

export async function deleteBoard(db: D1Database, alias: string): Promise<void> {
  await db.prepare('DELETE FROM boards WHERE alias = ?').bind(alias).run();
}

/** Most recently active boards first. */
export async function listBoards(db: D1Database, limit: number, offset: number): Promise<RegistryRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM boards ORDER BY active DESC, alias LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all<RegistryRow>();
  return results;
}

export interface RegistryTotals {
  boards: number;
  open: number;
  votes: number;
  voters: number;
}

export async function totals(db: D1Database): Promise<RegistryTotals> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS boards, COALESCE(SUM(status = 'open'), 0) AS open,
         COALESCE(SUM(votes), 0) AS votes, COALESCE(SUM(voters), 0) AS voters FROM boards`,
    )
    .first<RegistryTotals>();
  return row ?? { boards: 0, open: 0, votes: 0, voters: 0 };
}
