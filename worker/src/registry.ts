import {
  type AdminFilter,
  type AdminRow,
  type AdminTotals,
  isAdminFilter,
  type PopularBoard,
  popularOf,
} from '../../src/core/protocol';
import type { BoardLang } from '../../src/core/types';

/**
 * Board registry in D1, for the admin page and the public lists (Popular, the template pages, the sitemap):
 * Durable Objects can't be listed with their data. Each board keeps its own row up to date; activity is
 * refreshed at most once a day per board to spare writes. The row's shape is the admin list's (`AdminRow`,
 * src/core/protocol.ts).
 */

export type RegistryRow = AdminRow;

/** The row as SQLite stores it: flags as 0 or 1, the top labels as JSON. */
type DbRow = Omit<RegistryRow, 'hidden' | 'featured' | 'top'> & { hidden: number; featured: number; top: string };

function fromDb(r: DbRow): RegistryRow {
  let top: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.top);
    if (Array.isArray(parsed)) top = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* an unreadable top: none */
  }
  return { ...r, hidden: r.hidden === 1, featured: r.featured === 1, top };
}

export const DAY_MS = 86_400_000;

export async function upsertBoard(db: D1Database, row: RegistryRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO boards (alias, title, status, lang, items, votes, voters, reports, hidden, featured, template, recent, top, created, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (alias) DO UPDATE SET title = excluded.title, status = excluded.status, lang = excluded.lang,
         items = excluded.items, votes = excluded.votes, voters = excluded.voters, reports = excluded.reports,
         hidden = excluded.hidden, featured = excluded.featured, template = excluded.template,
         recent = excluded.recent, top = excluded.top, active = excluded.active`,
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
      row.template,
      row.recent,
      JSON.stringify(row.top.slice(0, 3)),
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

// ─── Public lists ───────────────────────────────────────────────────────────

/**
 * The Popular section of one language: boards the admin put forward and the official templates, the ones
 * with the most votes this week first, never a hidden board.
 */
export async function popularBoards(db: D1Database, lang: BoardLang, limit: number): Promise<PopularBoard[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM boards WHERE hidden = 0 AND lang = ? AND (featured = 1 OR template != '')
       ORDER BY featured DESC, recent DESC, voters DESC, alias LIMIT ?`,
    )
    .bind(lang, limit)
    .all<DbRow>();
  return results.map((r) => popularOf(fromDb(r)));
}

/** The board of a template in one language, if it was published already. */
export async function templateBoard(db: D1Database, key: string, lang: BoardLang): Promise<RegistryRow | null> {
  const row = await db
    .prepare("SELECT * FROM boards WHERE template = ? AND lang = ? AND template != ''")
    .bind(key, lang)
    .first<DbRow>();
  return row ? fromDb(row) : null;
}

/** The templates already published in one language: their keys. */
export async function templateKeys(db: D1Database, lang: BoardLang): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT template FROM boards WHERE template != '' AND lang = ?")
    .bind(lang)
    .all<{ template: string }>();
  return results.map((r) => r.template);
}

/** The template boards search engines may index: a crowd of at least `voters`, not hidden. */
export async function indexableTemplates(db: D1Database, voters: number): Promise<RegistryRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM boards WHERE template != '' AND hidden = 0 AND voters >= ? ORDER BY template, lang")
    .bind(voters)
    .all<DbRow>();
  return results.map(fromDb);
}
