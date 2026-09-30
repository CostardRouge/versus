import { fillCSS, fillInk } from '../core/colors';
import type { ItemScore, RankingView } from '../core/protocol';
import { agreement, crowdCheck, neckAndNeck, ownRanking, totalPairs } from '../core/published';
import type { BoardStatus, Computed, Duel, Item, MethodKey } from '../core/types';
import { esc } from '../core/util';
import { pct, plural, t } from '../i18n';
import { $, $$, reduced, thumbHTML } from './dom';
import { fmtCrowd, fmtRecord } from './format';
import { mountSlopes } from './slope';

/**
 * End-of-vote page of a published board: once a voter has voted on every pair, their result on a page
 * of its own, as a podium or as their ranking facing the crowd's, switched by a discreet toggle. The
 * first reveal is animated; switching views only fades. Blind boards show the voter's own ranking and
 * keep the crowd's for the closing.
 */

export type ResultView = 'podium' | 'duo';
/** play: the full reveal; swap: a short fade (a view switch); none: in place (live updates). */
export type FinaleMode = 'play' | 'swap' | 'none';

export interface FinaleData {
  title: string;
  status: BoardStatus;
  countsLine: string;
  items: Item[];
  method: MethodKey;
  mine: Duel[];
  count: number;
  /** Null while this voter isn't entitled to the crowd ranking (blind boards until closing). */
  crowd: RankingView | null;
  owner: boolean;
  view: ResultView;
}

/** How long the reveal lasts; live updates wait for its end. */
const PLAY_MS = 4200;
/** Stands for an item name in a translated sentence, replaced by the highlighted name. */
const SLOT = '';

const podiumSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="11" width="6" height="10" rx="1"/><rect x="9" y="4" width="6" height="17" rx="1"/><rect x="15.5" y="14" width="6" height="7" rx="1"/></svg>';
const duoSvg =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 5h3M18 5h3M3 12h3M18 12h3M3 19h3M18 19h3M7 5c5 0 5 7 10 7M7 12c5 0 5-7 10-7M7 19h10"/></svg>';
const lockSvg =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** Which ranking the podium shows. */
let who: 'crowd' | 'me' = 'crowd';
let playing = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export const finalePlaying = (): boolean => playing;
export function setPodiumWho(w: string | undefined): void {
  who = w === 'me' ? 'me' : 'crowd';
}
export function resetFinale(): void {
  who = 'crowd';
  clearTimeout(timer);
  playing = false;
}

interface Row {
  it: Item;
  meta: string;
}

interface Ctx {
  d: FinaleData;
  byId: Map<string, Item>;
  own: Computed;
  pairs: number;
  /** Pairs still to vote on (items added since, on an open board). */
  left: number;
  /** Decisive votes on ranked items, and the picks the crowd order contradicts. */
  check: { total: number; against: [string, string][] } | null;
  /** Agreement with the crowd in percent, when there are enough decisive votes. */
  agree: number | null;
}

function ctxOf(d: FinaleData): Ctx {
  const pairs = totalPairs(d.items.length);
  const share = d.crowd ? agreement(d.mine, d.crowd) : null;
  return {
    d,
    byId: new Map(d.items.map((i) => [i.id, i])),
    own: ownRanking(d.items, d.mine, d.method),
    pairs,
    left: d.status === 'open' ? Math.max(0, pairs - d.count) : 0,
    check: d.crowd ? crowdCheck(d.mine, d.crowd) : null,
    agree: share === null ? null : Math.round(share * 100),
  };
}

const tileStyle = (it: Item): string =>
  it.fill ? `background:${fillCSS(it.fill)};color:${fillInk(it.fill)}` : `--h:${it.h}`;
const highlight = (it: Item): string => `<span class="fin-win" style="${tileStyle(it)}">${esc(it.label)}</span>`;
/** A translated sentence around a highlighted item name. */
const sentence = (text: string, it: Item): string => esc(text).replace(SLOT, highlight(it));
const percent = (x: number): number => (x < 0 ? 0 : Math.min(100, Math.round(x)));
const shortScore = (m: MethodKey, x: ItemScore): string =>
  m === 'win' ? pct(Math.round(x.score * 100)) : String(Math.round(x.score));

function ownRows(c: Ctx): Row[] {
  const ties = c.d.mine.some((d) => d.s === 0.5);
  return c.own.order.flatMap((it) => {
    const s = c.own.st[it.id];
    return s ? [{ it, meta: fmtRecord(s, ties) }] : [];
  });
}

function crowdRows(c: Ctx, crowd: RankingView): Row[] {
  const close = neckAndNeck(crowd);
  return crowd.order.flatMap((id) => {
    const it = c.byId.get(id);
    const x = crowd.stats[id];
    if (!it || !x) return [];
    const neck = close.has(id) ? ` <span class="fin-neck" title="${t('neck')}">≈</span>` : '';
    return [{ it, meta: `${fmtCrowd(crowd.method, x)}${neck}` }];
  });
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

function topHTML(d: FinaleData): string {
  const closed = d.status === 'closed';
  const view = (v: ResultView, label: string, icon: string) =>
    `<button type="button" data-action="b-finale-view" data-view="${v}" aria-pressed="${d.view === v}" aria-label="${label}" title="${label}">${icon}</button>`;
  return `<div class="fin-top rv" style="--d:0s">
    <button class="back" type="button" data-action="b-finale-close">${t('finBack')}</button>
    <span class="fin-meta"><span class="fin-board">${esc(d.title)}</span><span class="chip ${closed ? '' : 'chip-live'}">${closed ? t('closedChip') : t('pubChip')}</span><span class="fin-counts mono" id="fin-counts">${d.countsLine}</span></span>
    <span class="fin-views" role="group" aria-label="${t('finViews')}">${view('podium', t('finPodium'), podiumSvg)}${view('duo', t('finDuo'), duoSvg)}</span>
  </div>`;
}

/** The progress bar of the voter's pairs; the reveal fills its last step. */
function barHTML(c: Ctx): string {
  const w = percent((100 * c.d.count) / c.pairs);
  const w0 = percent((100 * (c.d.count - 1)) / c.pairs);
  return `<span class="fin-bar" style="--w:${w}%;--w0:${w0}%"><i></i></span>`;
}

/** The voter's vote count, counting up to its last step during the reveal. */
const countHTML = (n: number): string =>
  `<span data-count="${n}" data-from="${Math.max(0, n - 1)}" data-delay="0.7" data-dur="0">${n}</span>`;

function actionsHTML(c: Ctx, delay: number): string {
  const cta = c.d.owner
    ? ''
    : `<p class="fin-cta">${t('finCta')} <button class="link" type="button" data-action="new-rank">${t('finCtaLink')}</button></p>`;
  return `<div class="fin-acts rv" style="--d:${delay}s">
    <div class="fin-btns"><button class="btn primary" type="button" data-action="b-finale-close">${c.left ? t('finVoteNew') : t('finSeeBoard')}</button><button class="btn" type="button" data-action="b-share">${t('copyLink')}</button></div>
    ${cta}
  </div>`;
}

const lockedHTML = (delay: number): string =>
  `<div class="fin-panel fin-locked rv" style="--d:${delay}s">${lockSvg}<div><b>${t('finLockedTitle')}</b><span>${t('finLockedBody')}</span></div></div>`;

/** The agreement as a number counting up during the reveal. */
function agreeHTML(agree: number, delay: number): string {
  return pct(agree).replace(
    String(agree),
    `<span data-count="${agree}" data-from="0" data-delay="${delay}">${agree}</span>`,
  );
}

function agreeLine(c: Ctx): string {
  const check = c.check;
  return check ? t('finAgreeDetail', { n: check.total - check.against.length, total: check.total }) : '';
}

function confettiHTML(): string {
  let out = '';
  for (let i = 0; i < 18; i++) {
    const angle = (Math.PI * 2 * i) / 18 + (i % 2 ? 0.2 : -0.1);
    const dist = 70 + ((i * 37) % 60);
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist - 30);
    out += `<i class="${i % 2 ? 'fin-cb' : 'fin-ca'}" style="--x:${x}px;--y:${y}px;--r:${(i * 83) % 360}deg"></i>`;
  }
  return `<span class="fin-confetti" aria-hidden="true">${out}</span>`;
}

// ─── Podium view ────────────────────────────────────────────────────────────

/** Reveal order: third, second, then the winner. */
const PLACE_DELAY = [0, 1.85, 1.35, 0.95];

function podiumHTML(c: Ctx): string {
  const { d } = c;
  const crowd = d.crowd;
  const mode = crowd ? who : 'me';
  const rows = crowd && mode === 'crowd' ? crowdRows(c, crowd) : ownRows(c);
  const podium = rows
    .slice(0, 3)
    .map((r, i) => {
      const n = i + 1;
      return `<li class="fin-pd fin-pd-${n}" style="--d:${PLACE_DELAY[n]}s">
        <div class="fin-tile" style="${tileStyle(r.it)}"><span class="fin-tile-name">${esc(r.it.label)}</span>${n === 1 ? confettiHTML() : ''}</div>
        <div class="fin-pd-meta mono">${r.meta}</div>
        <div class="fin-step" aria-hidden="true"><span>${n}</span></div>
      </li>`;
    })
    .join('');
  const rest = rows
    .slice(3)
    .map(
      (r, i) =>
        `<li><span class="pos mono">${i + 4}</span>${thumbHTML(r.it)}<span class="fin-nm">${esc(r.it.label)}</span><span class="fin-sc mono">${r.meta}</span></li>`,
    )
    .join('');
  const switcher = crowd
    ? `<div class="fin-who" role="group" aria-label="${t('finPodiumOf')}">
        <button type="button" data-action="b-finale-who" data-who="crowd" aria-pressed="${mode === 'crowd'}">${t('finCrowd')}</button>
        <button type="button" data-action="b-finale-who" data-who="me" aria-pressed="${mode === 'me'}">${t('finMe')}</button>
      </div>`
    : '';
  const sub = d.status === 'closed' ? t('finThanksClosed') : crowd ? t('finThanks') : t('finThanksHidden');
  const agree =
    crowd && c.agree !== null
      ? `<div class="fin-panel fin-agree rv" style="--d:2.5s">
          <svg class="fin-ring" viewBox="0 0 80 80" aria-hidden="true"><circle class="fin-ring-bg" cx="40" cy="40" r="34"/><circle class="fin-ring-fg" cx="40" cy="40" r="34" pathLength="100" style="--p:${c.agree}"/></svg>
          <div><b>${agreeHTML(c.agree, 2.6)}</b><span>${t('finAgree')}</span><small>${agreeLine(c)}</small></div>
        </div>`
      : '';
  return `<header class="fin-hero">
      <div class="fin-count rv" style="--d:0.1s">
        <span class="fin-num">${countHTML(d.count)}<small>/${c.pairs}</small></span>
        ${barHTML(c)}
        <span class="fin-cap">${t('finPairsVoted')}</span>
      </div>
      <div class="rv" style="--d:0.3s">
        <h1 class="fin-h">${c.left ? t('finNewTitle', { pairs: plural(c.left, 'pair') }) : t('votedAll')}</h1>
        <p class="fin-sub">${sub}</p>
      </div>
    </header>
    <div class="fin-grid">
      <section class="fin-pod-card" aria-labelledby="fin-pod-h">
        <div class="fin-pod-head rv" style="--d:0.6s"><h2 id="fin-pod-h">${mode === 'crowd' ? t('finCrowdPodium') : t('finMyPodium')}</h2>${switcher}</div>
        <ol class="fin-pod">${podium}</ol>
      </section>
      <aside class="fin-side">
        ${crowd ? agree : lockedHTML(2.5)}
        ${rest ? `<div class="fin-panel rv" style="--d:2.75s"><p class="fin-lbl">${t('finRest')}</p><ol class="fin-rest">${rest}</ol></div>` : ''}
        ${actionsHTML(c, 2.95)}
      </aside>
    </div>`;
}

// ─── Face-à-face view ───────────────────────────────────────────────────────

function duoHTML(c: Ctx): string {
  const { d } = c;
  const crowd = d.crowd;
  const own = ownRows(c);
  const n = own.length;
  const step = Math.min(0.09, 0.6 / Math.max(1, n));
  const crowdStart = 0.9 + n * step;
  const linesAt = crowdStart + n * step + 0.1;
  const at = (base: number, i: number) => `--d:${(base + (n - 1 - i) * step).toFixed(2)}s`;
  const mine = own
    .map(
      (r, i) =>
        `<li data-id="${esc(r.it.id)}" style="${at(0.8, i)}"><span class="fin-sc mono">${r.meta}</span><span class="fin-nm">${esc(r.it.label)}</span>${thumbHTML(r.it)}<span class="pos mono">${i + 1}</span></li>`,
    )
    .join('');
  const close = crowd ? neckAndNeck(crowd) : new Set<string>();
  const theirs = crowd
    ? crowd.order
        .map((id, i) => {
          const it = c.byId.get(id);
          const x = crowd.stats[id];
          if (!it || !x) return '';
          return `<li data-id="${esc(id)}" style="${at(crowdStart, i)}"><span class="pos mono">${i + 1}</span>${thumbHTML(it)}<span class="fin-nm">${esc(it.label)}</span><span class="fin-sc mono">${shortScore(crowd.method, x)}${close.has(id) ? ' ≈' : ''}</span></li>`;
        })
        .join('')
    : own
        .map(
          (_, i) =>
            `<li class="fin-ph" style="${at(crowdStart, i)}"><span class="pos mono">${i + 1}</span><span class="fin-ph-bar"></span></li>`,
        )
        .join('');
  const myWinner = own[0]?.it;
  const crowdWinner = crowd ? c.byId.get(crowd.order[0] ?? '') : undefined;
  let title = '';
  let sub = t('finLockedBody');
  if (crowdWinner) {
    title = sentence(t('finCrowdChose', { x: SLOT }), crowdWinner);
    const same = myWinner?.id === crowdWinner.id;
    const check = c.check;
    const vars = {
      x: myWinner?.label ?? '',
      n: check ? check.total - check.against.length : 0,
      total: check?.total ?? 0,
    };
    sub = c.agree === null ? t(same ? 'finYouTooOnly' : 'finYouOnly', vars) : t(same ? 'finYouToo' : 'finYou', vars);
  } else if (myWinner) title = sentence(t('finMyWinner', { x: SLOT }), myWinner);
  const status = c.left ? t('finLeft', { pairs: plural(c.left, 'pair') }) : t('finAllVoted');
  let side = `${lockedHTML(2.3)}${actionsHTML(c, 2.5)}`;
  if (crowd) {
    const against = c.check?.against ?? [];
    const pick = ([x, y]: [string, string]) => {
      const X = c.byId.get(x);
      const Y = c.byId.get(y);
      return X && Y
        ? `<li>${thumbHTML(X)}<b>${esc(X.label)}</b><span class="fin-over">${t('finOver')}</span>${thumbHTML(Y)}<span>${esc(Y.label)}</span></li>`
        : '';
    };
    const list = against.length
      ? `<ul class="fin-against">${against.slice(0, 4).map(pick).join('')}</ul>${against.length > 4 ? `<p class="fin-more">${t('finMore', { n: against.length - 4 })}</p>` : ''}`
      : `<p class="fin-more">${t('finNoAgainst')}</p>`;
    const big =
      c.agree !== null
        ? `<div class="fin-panel fin-agree-big rv" style="--d:${linesAt.toFixed(2)}s"><b>${agreeHTML(c.agree, linesAt + 0.2)}</b><span>${t('finAgree')}</span><small>${agreeLine(c)}</small></div>`
        : '';
    side = `${big}<div class="fin-panel rv" style="--d:${(linesAt + 0.25).toFixed(2)}s"><p class="fin-lbl">${t('finAgainst')}</p>${list}</div>${actionsHTML(c, linesAt + 0.45)}`;
  }
  return `<header class="rv" style="--d:0.1s">
      <p class="fin-eyebrow">${barHTML(c)}<span class="mono">${t('finPairs', { n: countHTML(d.count), total: c.pairs })} · ${status}</span></p>
      <h1 class="fin-h">${title}</h1>
      <p class="fin-sub">${esc(sub)}</p>
    </header>
    <div class="fin-grid fin-grid-duo">
      <section class="fin-duo" data-slope aria-label="${t('finDuoAria')}">
        <div class="fin-cols">
          <div class="fin-mine" data-slope-l><p class="fin-duo-h">${t('finMe')} <i class="fin-dot-a"></i></p><ol>${mine}</ol></div>
          <div class="fin-mid" aria-hidden="true"><svg class="fin-lines" data-slope-svg data-delay="${linesAt.toFixed(2)}"></svg></div>
          <div class="fin-theirs" data-slope-r><p class="fin-duo-h"><i class="fin-dot-b"></i>${t('finCrowd')}${crowd ? '' : ` <span class="fin-later">· ${t('finAtClosing')}</span>`}</p><ol>${theirs}</ol></div>
        </div>
        <p class="fin-duo-foot">${crowd ? t('finHover') : t('finOwnFrom', { votes: plural(d.mine.length, 'vote') })}</p>
      </section>
      <aside class="fin-side">${side}</aside>
    </div>`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function finaleHTML(d: FinaleData): string {
  const c = ctxOf(d);
  return `<div class="fin" id="fin">${topHTML(d)}<div class="fin-body">${d.view === 'duo' ? duoHTML(c) : podiumHTML(c)}</div></div>`;
}

function countUp(el: HTMLElement): void {
  const to = Number(el.dataset.count);
  const from = Number(el.dataset.from ?? 0);
  const delay = Number(el.dataset.delay ?? 0) * 1000;
  const dur = Number(el.dataset.dur ?? 1.1) * 1000;
  el.textContent = String(from);
  const t0 = performance.now() + delay;
  const tick = (now: number) => {
    if (!el.isConnected) return;
    const k = dur ? Math.min(1, Math.max(0, (now - t0) / dur)) : now >= t0 ? 1 : 0;
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** After finaleHTML is in the page: runs the reveal (or a fade), draws the lines, binds the hover. */
export function mountFinale(mode: FinaleMode, onSettled: () => void): void {
  const fin = $('#fin');
  if (!fin) return;
  clearTimeout(timer);
  playing = false;
  if (mode === 'swap') fin.classList.add('swap');
  if (mode === 'play' && !reduced) {
    fin.classList.add('play');
    playing = true;
    if (typeof requestAnimationFrame === 'function') for (const el of $$('[data-count]', fin)) countUp(el);
    timer = setTimeout(() => {
      playing = false;
      fin.classList.remove('play');
      onSettled();
    }, PLAY_MS);
  }
  mountSlopes(fin);
}
