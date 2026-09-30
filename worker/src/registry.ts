import { type AdminFilter, type AdminRow, type AdminTotals, isAdminFilter } from '../../src/core/protocol';

/**
 * Board registry in D1, for the admin page: Durable Objects can't be listed with their data. Each board
 * keeps its own row up to date; activity is refreshed at most once a day per board to spare writes.
 * The row's shape is the admin list's (`AdminRow`, src/core/protocol.ts).
 */

export type RegistryRow = AdminRow;

/** The row as SQLite stores it: flags as 0 or 1. */
type DbRow = Omit<RegistryRow, 'hidden' | 'featured'> & { hidden: number; featured: number };

const fromDb = (r: DbRow): RegistryRow => ({ ...r, hidden: r.hidden === 1, featured: r.featured === 1 });

export const DAY_MS = 86_400_000;

export async function upsertBoard(db: D1Database, row: RegistryRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO boards (alias, title, status, lang, items, votes, voters, reports, hidden, featured, created, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (alias) DO UPDATE SET title = excluded.title, status = excluded.status, lang = excluded.lang,
         items = excluded.items, votes = excluded.votes, voters = excluded.voters, reports = excluded.reports,
         hidden = excluded.hidden, featured = excluded.featured, active = excluded.active`,
    )
    .bind(
      row.alias,
      row.title,
      row.status,
      row.lang,
      row.items,
      row.votes,
      row.voters,
      row.reports,
      row.hidden ? 1 : 0,
      row.featured ? 1 : 0,
      row.created,
      row.active,
    )
    .run();
}

export async function deleteBoard(db: D1Database, alias: string): Promise<void> {
  await db.prepare('DELETE FROM boards WHERE alias = ?').bind(alias).run();
}

export { isAdminFilter as isFilter };

const WHERE: Record<AdminFilter, string> = {
  all: '1',
  reported: 'reports > 0',
  featured: 'featured = 1',
  hidden: 'hidden = 1',
  open: "status = 'open'",
  closed: "status = 'closed'",
};

export interface ListQuery {
  limit: number;
  offset: number;
  filter: AdminFilter;
  /** Part of the title, matched without case. */
  q: string;
}

/** Most recently active boards first; reported boards by their report count first. */
export async function listBoards(db: D1Database, query: ListQuery): Promise<RegistryRow[]> {
  const order = query.filter === 'reported' ? 'reports DESC, active DESC' : 'active DESC';
  const q = query.q.trim().toLowerCase();
  const { results } = await db
    .prepare(
      `SELECT * FROM boards WHERE ${WHERE[query.filter]} AND (? = '' OR instr(lower(title), ?) > 0)
       ORDER BY ${order}, alias LIMIT ? OFFSET ?`,
    )
    .bind(q, q, query.limit, query.offset)
    .all<DbRow>();
  return results.map(fromDb);
}

export type RegistryTotals = AdminTotals;

export async function totals(db: D1Database): Promise<RegistryTotals> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS boards, COALESCE(SUM(status = 'open'), 0) AS open,
         COALESCE(SUM(votes), 0) AS votes, COALESCE(SUM(voters), 0) AS voters,
         COALESCE(SUM(reports > 0), 0) AS reported, COALESCE(SUM(featured), 0) AS featured,
         COALESCE(SUM(hidden), 0) AS hidden FROM boards`,
    )
    .first<RegistryTotals>();
  return row ?? { boards: 0, open: 0, votes: 0, voters: 0, reported: 0, featured: 0, hidden: 0 };
}
