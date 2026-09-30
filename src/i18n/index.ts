import type { MethodKey } from '../core/types.ts';
import { en, enPlurals, type Messages, type MsgKey, type PluralKey, type Vars } from './en.ts';
import { fr, frPlurals } from './fr.ts';

export type Lang = 'en' | 'fr';
export const LANGS: readonly Lang[] = ['en', 'fr'];

const MESSAGES: Record<Lang, Messages> = { en, fr };
const PLURALS: Record<Lang, Record<PluralKey, [string, string]>> = { en: enPlurals, fr: frPlurals };

let current: Lang = 'en';

export const getLang = (): Lang => current;
export function setLang(lang: Lang): void {
  current = lang;
}
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Saved choice first, then the browser language, then English. */
export function detectLang(saved: unknown, browser: string | undefined): Lang {
  if (isLang(saved)) return saved;
  return (browser ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function t(key: MsgKey, vars: Vars = {}): string {
  const entry = MESSAGES[current][key] ?? en[key];
  if (typeof entry === 'function') return entry(vars);
  return entry.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** "1 item", "3 items"; French treats 0 and 1 as singular. */
export function plural(n: number, key: PluralKey): string {
  const [one, many] = PLURALS[current][key];
  const isMany = current === 'fr' ? n > 1 : n !== 1;
  return `${n} ${isMany ? many : one}`;
}

export const pct = (v: number): string => (current === 'fr' ? `${v} %` : `${v}%`);
export const locale = (): string => (current === 'fr' ? 'fr-FR' : 'en-GB');

export interface MethodText {
  name: string;
  tech: string;
  col: string;
  desc: string;
}
export const methodText = (k: MethodKey): MethodText => ({
  name: t(`m_${k}`),
  tech: t(`m_${k}_tech`),
  col: t(`m_${k}_col`),
  desc: t(`m_${k}_desc`),
});

export type { MsgKey, PluralKey, Vars };
