import { revealAt } from '../core/board';
import { fillCSS } from '../core/colors';
import { DEMOS } from '../core/demos';
import { addedItems, joinedAgreement, joinedTop, newsOf, pairsOf, sortJoined } from '../core/joined';
import { compute, stability } from '../core/scoring';
import type { Item, Joined, Ranking } from '../core/types';
import { esc } from '../core/util';
import { methodText as M, pct, plural, t } from '../i18n';
import { trashSvg } from './dom';
import { ago, fmtScore } from './format';
import { S, stat } from './state';

function tileHTML(it: Item | undefined, i: number, ranked: boolean): string {
  const cls = `tile${i === 0 ? ' first' : ''}`;
  if (!it) return `<span class="${cls}"></span>`;
  const n = ranked ? `<span class="tile-n mono">${i + 1}</span>` : '';
  if (it.fill) return `<span class="${cls}" style="background:${fillCSS(it.fill)}">${n}</span>`;
  if (it.img) return `<span class="${cls}" style="background-image:url('${it.img}')">${n}</span>`;
  return `<span class="${cls} txt" style="--h:${it.h}">${n}<b>${esc(it.label)}</b></span>`;
}
function rcardHTML(r: Ranking): string {
  const C = compute(r);
  const m = C.m;
  const ranked = C.n > 0;
  const st = Math.round(stability(r, C) * 100);
  const lead = ranked ? C.order[0] : undefined;
  const id = r.id;
  const pub = r.pub;
  const alias = esc(pub?.alias);
  const actions = pub
    ? `<button class="btn sm" type="button" data-action="open-board" data-alias="${alias}">${t('openBoard')}</button>
      <button class="btn sm ghost" type="button" data-action="copy-link" data-alias="${alias}">${t('copyLink')}</button>`
    : r.demo
      ? `<button class="btn sm" type="button" data-action="open" data-id="${id}" data-tab="duel">${ranked ? t('resume') : t('tryIt')}</button>
      <button class="btn sm ghost" type="button" data-action="open" data-id="${id}" data-tab="results">${t('result')}</button>
      <button class="btn sm ghost" type="button" data-action="reset-demo" data-id="${id}">${t('reset')}</button>
      <button class="btn sm ghost" type="button" data-action="duplicate" data-id="${id}" title="${t('duplicateTitle')}">${t('duplicate')}</button>`
      : `<button class="btn sm" type="button" data-action="open" data-id="${id}" data-tab="duel">${ranked ? t('resume') : t('start')}</button>
      <button class="btn sm ghost" type="button" data-action="open" data-id="${id}" data-tab="results">${t('result')}</button>
      <button class="btn sm ghost" type="button" data-action="reset" data-id="${id}" ${r.history.length ? '' : 'disabled'}>${t('restart')}</button>
      <button class="icon-btn" type="button" data-action="delete" data-id="${id}" aria-label="${esc(t('deleteAria', { title: r.title }))}">${trashSvg}</button>`;
  const leadHTML = lead
    ? `${t('leading')} <b>${esc(lead.label)}</b>${m === 'sort' ? '' : ` <span class="mono">${fmtScore(m, stat(C, lead.id))}</span>`}`
    : t('noDuels');
  return `<article class="rcard">
    <button class="rcard-main" type="button" data-action="open" data-id="${id}" data-tab="${r.items.length >= 2 ? 'duel' : 'items'}" aria-label="${esc(t('openAria', { title: r.title }))}">
      <div class="mosaic">${[0, 1, 2].map((i) => tileHTML(C.order[i], i, ranked)).join('')}</div>
      <div class="rcard-body">
        <div class="rcard-title"><h3>${esc(r.title)}</h3>${r.demo ? `<span class="chip">${t('demoChip')}</span>` : ''}${pub ? `<span class="chip${pub.status === 'closed' ? '' : ' chip-live'}">${t(pub.status === 'closed' ? 'closedChip' : 'pubChip')}</span>` : ''}</div>
        <p class="meta mono">${plural(r.items.length, 'item')} · ${plural(C.n, 'duel')} · ${M(m).name}${r.demo ? '' : ` · ${ago(r.updated)}`}</p>
        <p class="lead">${leadHTML}</p>
        <div class="stab-line"><span>${m === 'sort' ? t('progress') : t('stability')}</span><span class="bar"><i style="width:${st}%"></i></span><span class="mono">${pct(st)}</span></div>
      </div>
    </button>
    <div class="rcard-actions">${actions}</div>
  </article>`;
}

/** The line under a card's title: what's new first, then the crowd's leader, or why it's hidden. */
function joinedLead(j: Joined, top: ReturnType<typeof joinedTop>): string {
  if (j.gone) return t('joinedGone');
  const news = newsOf(j);
  const first = top.whose === 'crowd' ? top.items[0] : undefined;
  const leader = first ? `${t('leading')} <b>${esc(first.label)}</b>` : '';
  const flag = news === 'revealed' ? t('resultsRevealed') : news === 'closed' ? t('voteClosed') : null;
  if (flag) return `<b class="new">${flag}</b>${leader ? ` · ${leader}` : ''}`;
  if (!j.order) {
    if (j.settings.visibility !== 'after') return t('hiddenBlindShort');
    const need = revealAt(j.settings.revealAfter, j.items.length);
    return t('hiddenAfter', { n: need, k: Math.min(j.count, need) });
  }
  const ag = joinedAgreement(j);
  return `${leader}${ag === null ? '' : ` · ${t('agreeShort', { pct: pct(Math.round(ag * 100)) })}`}`;
}

/** A published board this browser voted on: the voter's progress, the crowd as they may see it, and what's new. */
function jcardHTML(j: Joined): string {
  const news = newsOf(j);
  const top = joinedTop(j);
  const { done, total } = pairsOf(j);
  const alias = esc(j.alias);
  const chip = j.gone
    ? `<span class="chip">${t('goneChip')}</span>`
    : `<span class="chip${j.status === 'closed' ? '' : ' chip-live'}">${t(j.status === 'closed' ? 'closedChip' : 'openChip')}</span>`;
  const meta = j.gone
    ? `${plural(j.items.length, 'item')} · ${t('seenAgo', { ago: ago(j.seen.at) })}`
    : `${plural(j.items.length, 'item')} · ${plural(j.votes, 'vote')} · ${plural(j.voters, 'voter')}`;
  const added = addedItems(j);
  const note = added
    ? `<p class="rcard-note">${t('joinedNewItems', { items: plural(added, 'item'), n: added, pairs: plural(total - done, 'pair') })}</p>`
    : '';
  const cap = top.whose === 'mine' ? `<span class="mosaic-cap">${t('yourTop')}</span>` : '';
  const body = `<div class="mosaic">${[0, 1, 2].map((i) => tileHTML(top.items[i], i, top.whose !== 'none')).join('')}${cap}</div>
      <div class="rcard-body">
        <div class="rcard-title"><h3>${news ? '<span class="fresh-dot" aria-hidden="true"></span>' : ''}${esc(j.title)}</h3>${chip}</div>
        <p class="meta mono">${meta}</p>
        <p class="lead">${joinedLead(j, top)}</p>
        <div class="stab-line"><span>${t('yourPairs')}</span><span class="bar"><i style="width:${total ? Math.round((100 * done) / total) : 0}%"></i></span><span class="mono">${done}/${total}</span></div>
      </div>`;
  const forget = `<button class="link forget" type="button" data-action="forget" data-alias="${alias}" aria-label="${esc(t('forgetAria', { title: j.title }))}">${t('forget')}</button>`;
  const main = j.gone
    ? `<div class="rcard-main">${body}</div>`
    : `<button class="rcard-main" type="button" data-action="open-board" data-alias="${alias}" aria-label="${esc(t('openAria', { title: j.title }))}">${body}</button>`;
  const actions = j.gone
    ? `<button class="btn sm" type="button" data-action="joined-copy" data-alias="${alias}" title="${t('keepCopyTitle')}">${t('keepCopy')}</button>`
    : `<button class="btn sm" type="button" data-action="open-board" data-alias="${alias}">${done < total && j.status === 'open' ? t('continueVote') : t('openBoard')}</button>
      <button class="btn sm ghost" type="button" data-action="copy-link" data-alias="${alias}">${t('copyLink')}</button>`;
  return `<article class="rcard${news ? ' fresh' : ''}${j.gone ? ' gone' : ''}">
    ${main}
    ${note}
    <div class="rcard-actions">${actions}${forget}</div>
  </article>`;
}

export function galleryHTML(): string {
  const mine = S.ranks.filter((r) => !r.demo).sort((a, b) => b.updated - a.updated);
  const joined = sortJoined(S.joined);
  const demos = DEMOS.map((d) => S.ranks.find((r) => r.id === d.id)).filter((r): r is Ranking => !!r);
  const hide = !!S.prefs.hideDemos;
  const votesGrid = `<div class="g-grid">${joined.map(jcardHTML).join('')}</div>`;
  // Someone who came through a shared link and made nothing yet sees their votes first.
  const top =
    !mine.length && joined.length
      ? `<div class="g-head"><div><h1>${t('yourVotes')}</h1><p>${t('yourVotesIntro')}</p></div></div>
    ${votesGrid}
    <div class="g-invite">
      <div><h2>${t('yourRankings')}</h2><p class="muted">${t('inviteBody')}</p></div>
      <button class="btn primary" type="button" data-action="new-rank">${t('newRankingBtn')}</button>
    </div>`
      : `<div class="g-head">
      <div><h1>${t('yourRankings')}</h1><p>${t('galleryIntro')}</p></div>
      <button class="btn primary" type="button" data-action="new-rank">${t('newRankingBtn')}</button>
    </div>
    <div class="g-grid">${mine.map(rcardHTML).join('')}
      <button class="new-card" type="button" data-action="new-rank"><span class="plus" aria-hidden="true">+</span><b>${t('newRanking')}</b><span class="muted">${t('newCardHint')}</span></button>
    </div>
    ${
      joined.length
        ? `<div class="sec-head votes-head">
      <div><h2>${t('yourVotes')} <span class="count mono">${joined.length}</span></h2><p class="muted">${t('yourVotesIntro')}</p></div>
    </div>
    ${votesGrid}`
        : ''
    }`;
  return `<section class="gallery">
    ${top}
    <div class="sec-head demo-head">
      <div><h2>${t('demos')}</h2><p class="muted">${t('demosIntro')}</p></div>
      <button class="link" type="button" data-action="toggle-demos">${hide ? t('showDemos') : t('hideDemos')}</button>
    </div>
    ${hide ? '' : `<div class="g-grid">${demos.map(rcardHTML).join('')}</div>`}
  </section>`;
}
