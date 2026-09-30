import { fillCode, fillCSS, fillInk } from '../core/colors.ts';
import { compute, expected, stability } from '../core/scoring.ts';
import type { Computed, ItemStats, MethodKey, Ranking } from '../core/types.ts';
import { esc, hueOf, sizeClass } from '../core/util.ts';
import type { Lang } from '../i18n/index.ts';
import { item, type ShowItem } from './data.ts';
import type { Strings } from './strings.ts';

/**
 * HTML of the demo frames (the app's workspace, reproduced): pure strings, so the build renders the first
 * state into the static page and the page's script renders every later state with the same functions.
 */

export const fmt = (tpl: string, vars: Record<string, string | number>): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

export const pctOf = (v: number, lang: Lang): string => (lang === 'fr' ? `${v} %` : `${v}%`);

/** "1 duel", "3 duels"; French treats 0 and 1 as singular, like the app. */
export function nDuels(n: number, S: Strings): string {
  const many = S.lang === 'fr' ? n > 1 : n !== 1;
  return fmt(many ? S.duelMany : S.duelOne, { n });
}

/** A ranking of show items, in the page's language. Hues come from the English label: same in both. */
export function rankOf(items: readonly ShowItem[], title: string, lang: Lang, method: MethodKey = 'bt'): Ranking {
  return {
    id: 'landing',
    title,
    method,
    items: items.map((it) => ({
      id: it.id,
      label: it.label[lang],
      img: null,
      fill: it.fill ?? null,
      h: hueOf(it.label.en),
    })),
    history: [],
    pair: null,
    created: 0,
    updated: 0,
  };
}

export function scoreHTML(st: ItemStats | undefined, m: MethodKey, S: Strings): string {
  if (!st?.games) return '<span class="muted">—</span>';
  if (m === 'win') return pctOf(Math.round(st.score * 100), S.lang);
  const se = m === 'bt' && st.se !== null ? `<small> ±${Math.round(st.se)}</small>` : '';
  return `${Math.round(st.score)}${se}`;
}

/** What fills a card, a tile or a thumbnail behind its label: the drawing on its backdrop, or the color. */
export function mediaHTML(it: ShowItem): string {
  if (it.pic && it.bg) {
    return `<span class="bgd" style="background:radial-gradient(120% 95% at 50% 32%,${it.bg[0]},${it.bg[1]})"></span><svg class="pic" viewBox="0 0 200 200" aria-hidden="true"><use href="#p-${it.pic}"></use></svg>`;
  }
  if (it.fill) return `<span class="bgd fill" style="background:${fillCSS(it.fill)}"></span>`;
  return '';
}

export const isText = (it: ShowItem): boolean => !it.pic && !it.fill;

export function thumbHTML(it: ShowItem, lang: Lang): string {
  if (isText(it))
    return `<span class="th t" style="--h:${hueOf(it.label.en)}" aria-hidden="true">${esc(Array.from(it.label[lang])[0] ?? '')}</span>`;
  return `<span class="th" aria-hidden="true">${mediaHTML(it)}</span>`;
}

function cardInner(it: ShowItem, side: 'a' | 'b', lang: Lang): string {
  const label = esc(it.label[lang]);
  const tag = `<span class="side-tag" aria-hidden="true">${side.toUpperCase()}</span>`;
  if (isText(it)) return `${tag}<span class="txt ${sizeClass(it.label[lang])}">${label}</span>`;
  if (it.fill) {
    return `${tag}${mediaHTML(it)}<span class="cap" style="color:${fillInk(it.fill)}">${label}<small>${fillCode(it.fill)}</small></span>`;
  }
  return `${tag}${mediaHTML(it)}<span class="shade"></span><span class="cap">${label}</span>`;
}

export function cardHTML(id: string, side: 'a' | 'b', S: Strings): string {
  const it = item(id);
  const aria = esc(fmt(S.pickAria, { side: side.toUpperCase(), label: it.label[S.lang] }));
  return `<button type="button" class="card card-${side}${isText(it) ? ' is-txt' : ''}" data-side="${side}" style="--h:${hueOf(it.label.en)}" aria-label="${aria}">${cardInner(it, side, S.lang)}</button>`;
}

/** Roster rows, best first. */
export function rowsHTML(C: Computed, S: Strings): string {
  return C.order
    .map((it, k) => {
      const show = item(it.id);
      return `<li data-id="${it.id}"><span class="pos">${k + 1}</span>${thumbHTML(show, S.lang)}<span class="lb">${esc(it.label)}</span><span class="sc">${scoreHTML(C.st[it.id], C.m, S)}</span></li>`;
    })
    .join('');
}

/** A's chance of winning the pair, in %, from the current scores (the app's forecast). */
export function forecast(C: Computed, pair: readonly [string, string]): number {
  const a = C.st[pair[0]]?.score ?? 1500;
  const b = C.st[pair[1]]?.score ?? 1500;
  return Math.round(expected(a, b) * 100);
}

export const stabilityPct = (r: Ranking, C: Computed): number => Math.round(stability(r, C) * 100);

export const eyebrow = (r: Ranking, S: Strings): string => `${fmt(S.duelN, { n: r.history.length + 1 })} · ${S.m_bt}`;

export interface FrameOpts {
  /** The roster rail beside the stage (hidden on narrow frames by a container query). */
  aside: boolean;
}

/** The whole frame in a given state: top bar, roster, duel stage, and the empty results pane. */
export function frameHTML(r: Ranking, pair: readonly [string, string], S: Strings, opts: FrameOpts): string {
  const C = compute(r);
  const st = stabilityPct(r, C);
  const pa = forecast(C, pair);
  const n = r.history.length;
  return `<div class="f-top"><span class="f-back" aria-hidden="true">${esc(S.back)}</span><p class="f-title">${esc(r.title)}</p><span class="chip f-chip">${esc(S.m_bt)}</span><div class="tabs" role="group" aria-label="${esc(r.title)}"><button type="button" data-tab="duel" aria-pressed="true">${esc(S.tabDuel)}</button><button type="button" data-tab="results" aria-pressed="false">${esc(S.tabResults)}</button></div></div>
<div class="f-body">${
    opts.aside
      ? `<div class="f-aside"><p class="f-aside-h"><span>${esc(S.rosterTitle)}</span><span class="f-count">${nDuels(n, S)}</span></p><ol class="rl">${rowsHTML(C, S)}</ol></div>`
      : ''
  }<div class="f-main"><div class="pane duel"><div class="duel-top"><div><p class="eyebrow f-eyebrow">${esc(eyebrow(r, S))}</p><p class="q">${esc(S.question)}</p></div><div class="stab"><span>${esc(S.stability)}</span><span class="bar"><i style="width:${st}%"></i></span><span class="f-stab">${pctOf(st, S.lang)}</span></div></div>
<div class="stage">${cardHTML(pair[0], 'a', S)}<div class="vs" aria-hidden="true"><span class="p pa">${pa}</span><span class="vs-dot">vs</span><span class="p pb">${100 - pa}</span><span class="vs-lbl">${S.forecast}</span></div>${cardHTML(pair[1], 'b', S)}<span class="float fa" aria-hidden="true"></span><span class="float fb" aria-hidden="true"></span><span class="kcap" aria-hidden="true"></span></div>
<div class="controls"><button type="button" class="ctl ctl-a" data-act="a"><kbd>←</kbd> ${esc(S.aWins)}</button><button type="button" class="ctl" data-act="draw">${esc(S.draw)} <kbd>↓</kbd></button><button type="button" class="ctl" data-act="skip">${esc(S.skip)} <kbd>S</kbd></button><button type="button" class="ctl ctl-b" data-act="b">${esc(S.bWins)} <kbd>→</kbd></button></div>
<div class="duel-foot"><button type="button" class="link" data-act="undo">${esc(S.undo)}</button><span class="muted">${esc(S.swipeHint)}</span></div></div><div class="pane res off" inert></div></div></div>
<div class="f-toast" role="status" aria-live="polite"></div>`;
}

/** The results pane: podium and the rest of the order. */
export function podiumHTML(r: Ranking, C: Computed, S: Strings, reveal: boolean): string {
  const st = stabilityPct(r, C);
  const media = (id: string) => {
    const it = item(id);
    return isText(it) ? `<span class="pod-txt">${esc(it.label[S.lang])}</span>` : mediaHTML(it);
  };
  const pods = C.order
    .slice(0, 3)
    .map((it, k) => {
      const show = item(it.id);
      return `<li class="pod pod-${k + 1}" style="--d:${2 - k}"><div class="pod-media${isText(show) ? ' is-txt' : ''}" style="--h:${hueOf(show.label.en)}">${media(it.id)}</div><div class="pod-info"><span class="pod-place">${k + 1}</span><span class="pod-name"><b>${esc(it.label)}</b><span class="mono muted">${scoreHTML(C.st[it.id], C.m, S)}</span></span></div></li>`;
    })
    .join('');
  const rest = C.order
    .slice(3)
    .map((it, k) => `<span><b class="mono">${k + 4}</b>${esc(it.label)}</span>`)
    .join('');
  return `<div class="res"><div class="duel-top"><div><p class="eyebrow">${nDuels(r.history.length, S)} · ${esc(S.m_bt)}</p><p class="q">${esc(S.finMyPodium)}</p></div><div class="stab"><span>${esc(S.stability)}</span><span class="bar"><i style="width:${st}%"></i></span><span>${pctOf(st, S.lang)}</span></div></div><ol class="podium${reveal ? ' reveal' : ''}">${pods}</ol><p class="res-rest">${rest}</p></div>`;
}
