import type { ItemScore } from '../core/protocol';
import type { ItemStats, MethodKey } from '../core/types';
import { fmtDelta } from '../core/util';
import { pct, t } from '../i18n';

export function fmtScore(m: MethodKey, s: ItemStats): string {
  if (m === 'win') return pct(Math.round(s.score * 100));
  if (m === 'sort') return s.placed ? t('placed') : t('toPlace');
  return String(Math.round(s.score));
}
/** A crowd score, with its margin (as HTML) for Balanced. */
export function fmtCrowd(m: MethodKey, x: ItemScore): string {
  if (m === 'win') return pct(Math.round(x.score * 100));
  const se = m === 'bt' && x.se !== null ? `<small>±${Math.round(x.se)}</small>` : '';
  return `${Math.round(x.score)}${se}`;
}
export const fmtRecord = (s: ItemStats, withTies: boolean): string =>
  `${s.w}${t('recW')} ${s.l}${t('recL')}${withTies ? ` ${s.d}${t('recD')}` : ''}`;

export function deltaInfo(
  m: MethodKey,
  before: ItemStats,
  after: ItemStats,
  res: number,
): { text: string; cls: string } {
  if (m === 'sort') return res > 0 ? { text: '↑', cls: 'up' } : { text: '↓', cls: 'down' };
  const d = m === 'win' ? Math.round((after.score - before.score) * 100) : Math.round(after.score - before.score);
  return { text: fmtDelta(d) + (m === 'win' ? ' pt' : ''), cls: d > 0 ? 'up' : d < 0 ? 'down' : 'eq' };
}
export function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('agoNow');
  if (m < 60) return t('agoMin', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('agoH', { n: h });
  return t('agoD', { n: Math.round(h / 24) });
}
