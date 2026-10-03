import { isHex, normHex } from './colors.ts';
import { LABEL_MAX } from './model.ts';

/**
 * Reads what is typed or pasted into the add field as item labels: one per line (real line breaks or the
 * `\n` escapes of text copied from code), bulleted, numbered and Markdown lists, a spreadsheet row (tabs),
 * or a JSON array of strings.
 */

/** Line breaks, and their escapes. */
const BREAKS = /\r\n|[\n\r\u2028\u2029\u0085]|\\r\\n|\\n/;

/**
 * A list marker opening a line: - * + and dashes before a space, a bullet glyph as word processors copy it,
 * 1. 1) (1) a), then an optional task box [ ] [x], or a task box alone. Letters only take ")": "A. Lincoln" is a name.
 */
const MARKER =
  /^\s*(?:(?:[-*+–—·]\s+|[•●○◦▪■□▫‣⁃∙►▸➢➤\uf0b7☐☑☒]\s*|o\t\s*|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+|[a-z]\)\s+)(?:\[[ x]\]\s+)?|\[[ x]\]\s+)/i;

/** Markdown inside a list item: links and images keep their text, emphasis and code lose their marks. */
function plainMarkdown(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*([*_])(.+)\1\s*$/, '$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1');
}

/** The text of a list item, or null for a line that isn't one. */
function listItem(line: string): string | null {
  const m = MARKER.exec(line);
  return m ? plainMarkdown(line.slice(m[0].length)) : null;
}

/** One line of text, invisible characters out, cut to the longest label. */
function clean(s: string): string {
  const one = s
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > LABEL_MAX ? Array.from(one).slice(0, LABEL_MAX).join('').trimEnd() : one;
}

const keep = (labels: string[]): string[] => labels.map(clean).filter(Boolean);

/** A JSON array of strings or numbers, or null. */
function jsonList(text: string): string[] | null {
  if (!/^\[[\s\S]*\]$/.test(text)) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.map(String);
  } catch {
    /* not JSON: read as text */
  }
  return null;
}

/**
 * The labels in a text. A single line is one label, taken as written. Several lines lose their list markers
 * and Markdown; when at least two lines are list items, the other lines (a title, a heading, a note) are left out.
 */
export function parseList(text: string): string[] {
  const all = text.trim();
  const json = jsonList(all);
  if (json) return keep(json);
  let lines = all.split(BREAKS);
  if (lines.length === 1) lines = all.split('\t');
  if (lines.length === 1) return keep(lines);
  const items = lines.map(listItem);
  const marked = items.filter((x) => x !== null);
  return keep(marked.length >= 2 ? marked : lines.map((l, i) => items[i] ?? l));
}

/** What makes two labels the same: case and spacing aside, a #hex code by its color. */
export function labelKey(s: string): string {
  const v = s.normalize('NFC').replace(/\s+/g, ' ').trim();
  return isHex(v) ? normHex(v) : v.toLowerCase();
}

/** The labels of a list to add: each once, without those already taken; `dupes` counts the ones left out. */
export function freshLabels(labels: string[], taken: string[]): { fresh: string[]; dupes: number } {
  const seen = new Set(taken.map(labelKey));
  const fresh = labels.filter((l) => {
    const k = labelKey(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { fresh, dupes: labels.length - fresh.length };
}
