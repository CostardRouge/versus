import { type Entry, en, type MsgKey } from '../i18n/en.ts';
import { fr } from '../i18n/fr.ts';
import type { Lang } from '../i18n/index.ts';
import { type LandingMessages, landingEn } from '../i18n/landing-en.ts';
import { landingFr } from '../i18n/landing-fr.ts';

/**
 * Every text the home page shows: its own messages (src/i18n/landing-*.ts) plus the app's for what the demo
 * reproduces (duel controls, method names), so both say the same thing. Build time only: the page embeds the
 * result as JSON for its script (src/landing/main.ts), which never bundles a dictionary.
 */

const APP_KEYS = [
  'back',
  'question',
  'aWins',
  'bWins',
  'draw',
  'skip',
  'undo',
  'undone',
  'swipeHint',
  'stability',
  'duelN',
  'forecast',
  'tabDuel',
  'tabResults',
  'finMyPodium',
  'langAria',
  'tagline',
  'aboutBy',
  'm_bt',
  'm_bt_tech',
  'm_bt_col',
  'm_bt_desc',
  'm_elo',
  'm_elo_tech',
  'm_elo_col',
  'm_elo_desc',
  'm_win',
  'm_win_tech',
  'm_win_col',
  'm_win_desc',
  'm_sort',
  'm_sort_tech',
  'm_sort_col',
  'm_sort_desc',
] as const satisfies readonly MsgKey[];

type AppKey = (typeof APP_KEYS)[number];
export type Strings = LandingMessages & Record<AppKey, string> & { lang: Lang };

const APP: Record<Lang, Record<MsgKey, Entry>> = { en, fr };
const LANDING: Record<Lang, LandingMessages> = { en: landingEn, fr: landingFr };

const text = (e: Entry): string => (typeof e === 'function' ? e({}) : e);

export function strings(lang: Lang): Strings {
  const app = Object.fromEntries(APP_KEYS.map((k) => [k, text(APP[lang][k])])) as Record<AppKey, string>;
  return { ...LANDING[lang], ...app, lang };
}
