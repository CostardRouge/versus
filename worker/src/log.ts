import { isRecord } from '../../src/core/board';

/**
 * The Worker's own log lines (Workers Logs, `wrangler tail`): one JSON object per line, an event and a few facts,
 * so that what failed quietly (a registry write, an R2 delete, Turnstile) and what the admin did can be found
 * and counted. Never a token, a voter id or an address: an alias, a count, an error message at most.
 */

export type LogFields = Record<string, string | number | boolean>;

/** One log line: the event first, then its facts (which can't rename it). */
export const logLine = (event: string, fields: LogFields = {}): string =>
  JSON.stringify(Object.assign({ event }, fields, { event }));

export function log(event: string, fields: LogFields = {}): void {
  console.log(logLine(event, fields));
}

/** What an error says, short: the `error` field of a line. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Where a blocked resource came from: an origin (never a full address) or the browser's keyword (inline, eval). */
const blockedFrom = (u: string): string => {
  try {
    const url = new URL(u);
    return url.origin === 'null' ? url.protocol : url.origin;
  } catch {
    return u.slice(0, 40);
  }
};

/**
 * A content security policy report (`report-uri`, docs/seo.md) as a log line's facts: the directive, what was
 * blocked and the page's path (no query). Null when the body isn't one.
 */
export function cspFields(body: unknown): LogFields | null {
  const report = isRecord(body) ? body['csp-report'] : null;
  if (!isRecord(report)) return null;
  const text = (key: string): string => (typeof report[key] === 'string' ? (report[key] as string) : '');
  let page = '';
  try {
    page = new URL(text('document-uri')).pathname;
  } catch {}
  return {
    directive: (text('effective-directive') || text('violated-directive').split(' ')[0] || '').slice(0, 40),
    blocked: blockedFrom(text('blocked-uri')),
    page: page.slice(0, 100),
    disposition: text('disposition').slice(0, 10),
  };
}
