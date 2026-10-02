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
