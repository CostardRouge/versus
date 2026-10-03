import { simulate } from '../core/demos.ts';
import { compute, nextPair, pushDuel } from '../core/scoring.ts';
import { APP_PATH, HOME_PATH, LEGAL_PATH } from '../core/site.ts';
import type { MethodKey } from '../core/types.ts';
import { esc, hueOf, mulberry32 } from '../core/util.ts';
import type { Lang } from '../i18n/index.ts';
import { fill, pctText } from '../i18n/text.ts';
import { PREFS_KEY, THEME_BAR_JS } from '../prefs.ts';
import { crowd, rate, standings, vote } from './crowd.ts';
import {
  CASES,
  CROWD,
  HERO,
  item,
  METHODS_DEMO,
  PASTRIES,
  PASTRY_TITLE,
  PICKS,
  SETTLING,
  type ShowItem,
  TOPICS,
  type UseCase,
} from './data.ts';
import { frameHTML, isText, mediaHTML, nDuels, rankOf, scoreHTML, thumbHTML } from './frame.ts';
import { SPRITE } from './sprite.ts';
import { type Strings, strings } from './strings.ts';

/**
 * The home page, rendered at build time in each language (build/seo-plugin.ts puts it in index.html and
 * fr/index.html): every word and the first frame of every demo are in the static HTML, for search engines
 * and for a first paint without layout shift. src/landing/main.ts then brings it to life.
 */

const other = (lang: Lang): Lang => (lang === 'en' ? 'fr' : 'en');
/** From a home page back to the site's root. */
const rootOf = (lang: Lang): string => (HOME_PATH[lang] ? '../' : './');

/** Where a page's header and footer link from: the site's root as seen from the page, and the page in each language. */
export interface PageLinks {
  root: string;
  versions: Record<Lang, string>;
}
const homeLinks = (lang: Lang): PageLinks => {
  const root = rootOf(lang);
  return { root, versions: { en: `${root}${HOME_PATH.en}`, fr: `${root}${HOME_PATH.fr}` } };
};

export interface PageData {
  S: Strings;
  /** First pair of the "try it" frame (the frame's static HTML shows it). */
  tryPair: [string, string];
  methods: { rows: Record<MethodKey, { id: string; sc: string }[]>; duels: number; sortDuels: number };
}

const METHOD_KEYS: readonly MethodKey[] = ['bt', 'elo', 'win', 'sort'];
const svg = (d: string, size = 18, width = 2): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHECK = '<path d="M20 6 9 17l-5-5"/>';
const ARROW = svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 18, 2.2).replace('<svg', '<svg class="arr"');

/**
 * Runs before the first paint, from <head>: old app links and installed apps go to the app, a language chosen
 * earlier (the app's `versus-prefs`) is honored for visitors arriving from elsewhere, and the saved theme applies.
 * First-time visitors are never redirected by their browser language: they get a suggestion instead.
 */
export function landingBoot(lang: Lang): string {
  const root = rootOf(lang);
  return `<script>
      (function () {
        var d = document.documentElement;
        d.classList.add('js');
        // Marked, so the page's script doesn't count a view on its way out (src/landing/main.ts).
        function leave(to) {
          d.dataset.leaving = '';
          location.replace(to);
        }
        // Links from before the home page: the app's routes live in the fragment (#/b/<alias>).
        if (/^#\\//.test(location.hash)) return leave('${root}${APP_PATH}' + location.hash);
        // Arriving from another page of the site (the app's link to the home page, the language switch).
        var inside = false;
        try { inside = new URL(document.referrer).origin === location.origin; } catch (e) {}
        // An app installed before the home page existed still opens here; one that follows its own link here stays.
        if (!inside && matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)').matches) {
          return leave('${root}${APP_PATH}');
        }
        var prefs = {};
        try { prefs = JSON.parse(localStorage.getItem('${PREFS_KEY}') || '{}') || {}; } catch (e) {}
        if (!inside && (prefs.lang === 'en' || prefs.lang === 'fr') && prefs.lang !== '${lang}') {
          return leave('${root}' + (prefs.lang === 'fr' ? '${HOME_PATH.fr}' : '${HOME_PATH.en}'));
        }
        var theme = prefs.theme;
        if (theme === 'light' || theme === 'dark') {
          d.dataset.theme = theme;
          ${THEME_BAR_JS}
        }
      })();
    </script>`;
}

/** Text of the h1, as a crawler reads it. */
export const h1Text = (S: Strings): string => `${S.heroRank} ${S.heroAnything} ${S.heroTail}`;

function methodsData(lang: Lang, S: Strings): PageData['methods'] {
  const r = rankOf(METHODS_DEMO.items, PASTRY_TITLE[lang], lang);
  simulate(
    r,
    METHODS_DEMO.items.map((it) => it.s),
    METHODS_DEMO.duels,
    mulberry32(METHODS_DEMO.seed),
  );
  const rows = {} as PageData['methods']['rows'];
  for (const m of ['bt', 'elo', 'win'] as const) {
    r.method = m;
    const C = compute(r);
    rows[m] = C.order.map((it) => ({ id: it.id, sc: scoreHTML(C.st[it.id], m, S) }));
  }
  // The exact sort plays its own duels, decided here by the hidden strengths.
  const s = rankOf(METHODS_DEMO.items, PASTRY_TITLE[lang], lang, 'sort');
  for (let k = 0; k < 100; k++) {
    const need = compute(s).ex?.need;
    if (!need) break;
    const [a, b] = need.map(item) as [ShowItem, ShowItem];
    pushDuel(s, a.id, b.id, a.s > b.s || (a.s === b.s && a.id < b.id) ? 1 : 0);
  }
  rows.sort = compute(s).order.map((it) => ({ id: it.id, sc: `<span class="muted">${esc(S.placed)}</span>` }));
  return { rows, duels: r.history.length, sortDuels: s.history.length };
}

/** The sticky header: brand, the home page's sections (home only), languages and the way into the app. */
export function navHTML(lang: Lang, S: Strings, links: PageLinks = homeLinks(lang), sections = true): string {
  const root = links.root;
  const langLink = (l: Lang) => {
    const name = l === 'en' ? 'English' : 'Français';
    const current = l === lang ? ' aria-current="page"' : '';
    return `<a href="${links.versions[l]}" hreflang="${l}" lang="${l}" data-lang="${l}" aria-label="${l.toUpperCase()}, ${name}"${current}>${l.toUpperCase()}</a>`;
  };
  const inPage = sections
    ? `\n      <nav class="nav-links" aria-label="${esc(S.navAria)}"><a href="#how">${esc(S.navHow)}</a><a href="#try">${esc(S.navTry)}</a><a href="#methods">${esc(S.navMethods)}</a></nav>`
    : '';
  return `<header class="nav" id="nav">
    <div class="wrap nav-in">
      <a class="brand" href="${root}${HOME_PATH[lang]}" aria-label="${esc(S.homeAria)}"><span class="brand-mark" aria-hidden="true">vs</span>Versus</a>${inPage}
      <nav class="langs" aria-label="${esc(S.langAria)}">${langLink('en')}${langLink('fr')}</nav>
      <a class="btn primary sm nav-cta" href="${root}${APP_PATH}">${esc(S.openApp)}</a>
    </div>
  </header>`;
}

/** The other language's offer, in that language: a landmark of its own, before the header. */
function langHint(lang: Lang): string {
  const to = other(lang);
  const T = strings(to);
  return `<aside class="lang-hint" id="lang-hint" lang="${to}" aria-label="${esc(T.suggestAria)}" hidden>
    <div class="wrap lang-hint-in"><p>${esc(T.suggestText)}</p><a class="btn sm" href="${rootOf(lang)}${HOME_PATH[to]}" hreflang="${to}" data-lang="${to}">${esc(T.suggestGo)}</a><button type="button" class="icon-btn" id="lang-hint-close" aria-label="${esc(T.suggestClose)}">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>
  </aside>`;
}

function hero(lang: Lang, S: Strings): string {
  const root = rootOf(lang);
  const r = rankOf(HERO.items, PASTRY_TITLE[lang], lang);
  for (const [a, b, s] of HERO.seed) pushDuel(r, a, b, s);
  const trust = [S.trust1, S.trust2, S.trust3].map((t) => `<li>${svg(CHECK, 15, 2.6)}${esc(t)}</li>`).join('');
  return `<section class="hero wrap" aria-labelledby="hero-h">
      <p class="hero-chip"><span class="brand-mark" aria-hidden="true">vs</span>${esc(S.heroChip)}</p>
      <h1 class="hero-h" id="hero-h">${esc(S.heroRank)} <br><span class="rot" id="rot"><span class="rw ca on">${esc(S.heroAnything)}</span></span> <br>${esc(S.heroTail)}</h1>
      <div class="hero-row">
        <p class="hero-sub">${S.heroSub}</p>
        <div class="hero-cta">
          <div class="row"><a class="btn primary lg" href="${root}${APP_PATH}">${esc(S.ctaStart)} ${ARROW}</a><a class="btn lg" href="#try">${esc(S.ctaTry)}</a></div>
          <ul class="trust">${trust}</ul>
        </div>
      </div>
      <div class="show">
        <div class="frame" id="hero-frame" role="region" aria-label="${esc(S.demoAria)}">${frameHTML(r, HERO.first, S, { aside: true })}</div>
        <div class="narr">
          <span class="live" id="hero-live"><i></i><span>${esc(S.demoLive)}</span></span>
          <p class="say" id="hero-say">${esc(S.demoIdle)}</p>
          <button class="link" id="hero-btn" type="button">${esc(S.demoPlay)}</button>
          <button class="pause" id="pause" type="button" aria-pressed="false" aria-label="${esc(S.pauseAnim)}" title="${esc(S.pauseAnim)}">${svg('<path d="M9 5v14M15 5v14"/>', 16, 2.4)}${svg('<path d="M7 5l12 7-12 7z"/>', 16, 2.2)}</button>
        </div>
      </div>
    </section>`;
}

function cases(lang: Lang, S: Strings): string {
  const dot = (c: UseCase, k: 0 | 1) => (c.colors ? `--c:${c.colors[k]}` : `--h:${hueOf((k ? c.b : c.a).en)}`);
  const chip = (c: UseCase, copy: boolean) =>
    `<li class="uc${copy ? ' copy' : ''}"${copy ? ' aria-hidden="true"' : ''}><span class="duo" aria-hidden="true"><i style="${dot(c, 0)}"></i><i style="${dot(c, 1)}"></i></span><b>${esc(c.title[lang])}</b><span class="vsx"><span class="xa">${esc(c.a[lang])}</span> vs <span class="xb">${esc(c.b[lang])}</span></span></li>`;
  const row = (list: readonly UseCase[], rev: boolean, dur: number) =>
    `<ul class="marq-row${rev ? ' rev' : ''}" style="--dur:${dur}s">${list.map((c) => chip(c, false)).join('')}${list.map((c) => chip(c, true)).join('')}</ul>`;
  return `<section class="cases" aria-labelledby="cases-h">
      <div class="wrap"><h2 class="cases-h" id="cases-h">${esc(S.casesTitle)}</h2></div>
      <div class="marq">${row(CASES.slice(0, 7), false, 64)}${row(CASES.slice(7), true, 72)}</div>
    </section>`;
}

function how(lang: Lang, S: Strings): string {
  const kouign = `<span class="th t" style="--h:${hueOf('Kouign-amann')}" aria-hidden="true">K</span>`;
  const saffron = '<span class="th" style="background:#F2A516" aria-hidden="true"></span>';
  const croissant = item('croissant');
  const [a, b, res] = PICKS[0] as (typeof PICKS)[number];
  const mini = (id: string, side: 'a' | 'b') => {
    const it = item(id);
    const cls = `mc mc-${side}${isText(it) ? ' is-txt' : ' media'}${res === side ? ' win' : ' lose'}`;
    return `<span class="${cls}" style="--h:${hueOf(it.label.en)}"><span class="tag">${side.toUpperCase()}</span>${mediaHTML(it)}${isText(it) ? '' : '<span class="shade"></span>'}<b>${esc(it.label[lang])}</b></span>`;
  };
  const last = SETTLING[SETTLING.length - 1] as (typeof SETTLING)[number];
  const settle = last.order
    .map((id, k) => {
      const it = item(id);
      return `<li data-id="${id}"><span class="pos">${k + 1}</span>${thumbHTML(it, lang)}<span class="lb">${esc(it.label[lang])}</span><span class="bar"><i style="width:${last.w[k]}%"></i></span></li>`;
    })
    .join('');
  const winner = item(res === 'b' ? b : a);
  return `<section class="sec wrap" id="how" aria-labelledby="how-h">
      <div class="sec-head">
        <p class="kicker">${esc(S.howKicker)}</p>
        <h2 class="h2" id="how-h">${esc(S.howTitle)}</h2>
        <p class="lede">${esc(S.howLede)}</p>
      </div>
      <ol class="steps">
        <li class="step">
          <div class="vig v1" aria-hidden="true">
            <div class="v-field"><span class="v-sw"></span><span class="v-typed"></span><span class="caret"></span><span class="v-enter">↵</span></div>
            <ul class="v-list"><li>${kouign}<span>Kouign-amann</span></li><li>${saffron}<span class="mono">#F2A516</span></li><li>${thumbHTML(croissant, lang)}<span>${esc(croissant.label[lang])}</span></li></ul>
            <div class="v-file">${thumbHTML(croissant, lang)}croissant.jpg</div>
          </div>
          <h3><span class="n" aria-hidden="true">1</span>${esc(S.step1Title)}</h3>
          <p>${esc(S.step1)}</p>
        </li>
        <li class="step">
          <div class="vig v2" aria-hidden="true">
            <div class="v2-stage">${mini(a, 'a')}<span class="mvs">vs</span>${mini(b, 'b')}</div>
            <div class="v2-keys"><kbd data-k="a">←</kbd><kbd data-k="draw">↓</kbd><kbd data-k="b">→</kbd></div>
            <p class="v2-say">${esc(fill(S.v2Wins, { label: winner.label[lang] }))}</p>
          </div>
          <h3><span class="n" aria-hidden="true">2</span>${esc(S.step2Title)}</h3>
          <p>${esc(S.step2)}</p>
        </li>
        <li class="step">
          <div class="vig v3" aria-hidden="true">
            <ol class="v3-list">${settle}</ol>
            <div class="v3-stab"><span>${esc(S.stability)}</span><span class="bar"><i style="width:100%"></i></span><span class="mono">${pctText(100, lang)}</span></div>
            <span class="chip v3-done on">${esc(S.v3Stable)}</span>
          </div>
          <h3><span class="n" aria-hidden="true">3</span>${esc(S.step3Title)}</h3>
          <p>${esc(S.step3)}</p>
        </li>
      </ol>
    </section>`;
}

function tryIt(lang: Lang, S: Strings): { html: string; pair: [string, string] } {
  const topic = TOPICS[0] as (typeof TOPICS)[number];
  const r = rankOf(topic.items, topic.title[lang], lang);
  const pair = nextPair(r, null, compute(r), mulberry32(3)) as [string, string];
  const tabs = TOPICS.map(
    (t, i) =>
      `<button type="button" class="sb-tab" data-topic="${t.id}" aria-pressed="${i === 0}">${thumbHTML(item(t.thumb), lang)}${esc(t.tab[lang])}</button>`,
  ).join('');
  const html = `<section class="sec wrap" id="try" aria-labelledby="try-h">
      <div class="sec-head">
        <p class="kicker">${esc(S.tryKicker)}</p>
        <h2 class="h2" id="try-h">${esc(S.tryTitle)}</h2>
        <p class="lede">${esc(S.tryLede)}</p>
      </div>
      <div class="sb-tabs" role="group" aria-label="${esc(S.topicsAria)}">${tabs}</div>
      <div class="frame" id="try-frame" role="region" aria-label="${esc(topic.title[lang])}">${frameHTML(r, pair, S, { aside: true })}</div>
      <div class="sb-foot"><span class="muted">${S.tryKeys}</span><button class="link" id="try-reset" type="button">${esc(S.tryReset)}</button></div>
    </section>`;
  return { html, pair };
}

function methods(lang: Lang, S: Strings, data: PageData['methods']): string {
  const name = (m: MethodKey) => S[`m_${m}`];
  const tabs = METHOD_KEYS.map(
    (m) =>
      `<button type="button" class="m-tab" data-m="${m}" aria-pressed="${m === 'bt'}"><b>${esc(name(m))}</b><span class="tech">${esc(S[`m_${m}_tech`])}${m === 'bt' ? ` · ${esc(S.methodDefault)}` : ''}</span></button>`,
  ).join('');
  const descs = METHOD_KEYS.map(
    (m) => `<p class="m-desc" data-m="${m}"${m === 'bt' ? '' : ' hidden'}>${esc(S[`m_${m}_desc`])}</p>`,
  ).join('');
  const rows = data.rows.bt
    .map((row, k) => {
      const it = item(row.id);
      return `<li data-id="${row.id}"><span class="pos">${k + 1}</span>${thumbHTML(it, lang)}<span class="lb">${esc(it.label[lang])}</span><span class="dl"></span><span class="sc">${row.sc}</span></li>`;
    })
    .join('');
  return `<section class="sec wrap" id="methods" aria-labelledby="methods-h">
      <div class="sec-head">
        <p class="kicker">${esc(S.methodsKicker)}</p>
        <h2 class="h2" id="methods-h">${esc(S.methodsTitle)}</h2>
        <p class="lede">${esc(S.methodsLede)}</p>
      </div>
      <div class="meth">
        <div>
          <div class="m-tabs" role="group" aria-label="${esc(S.methodsAria)}">${tabs}</div>
          ${descs}
        </div>
        <div class="m-board">
          <div class="m-head"><h3>${esc(PASTRY_TITLE[lang])}</h3><span class="mono" id="m-meta">${esc(fill(S.itemsN, { n: PASTRIES.length }))} · ${nDuels(data.duels, S)}</span></div>
          <div class="m-cols" aria-hidden="true"><span>#</span><span></span><span>${esc(S.colItem)}</span><span>${esc(S.colVs)}</span><span id="m-col">${esc(S.m_bt_col)}</span></div>
          <ol class="m-list" id="m-list" aria-live="polite">${rows}</ol>
          <p class="m-foot" id="m-foot">${esc(S.mFootBt)}</p>
        </div>
      </div>
    </section>`;
}

function crowdSection(lang: Lang, S: Strings): string {
  const c = crowd(CROWD.items, mulberry32(CROWD.seed));
  for (let k = 0; k < CROWD.votes; k++) vote(c);
  const rows = standings(c)
    .map((id, k) => {
      const it = item(id);
      const r = rate(c.tally.get(id) ?? { w: 0, g: 0 });
      return `<li data-id="${id}"><span class="pos">${k + 1}</span>${thumbHTML(it, lang)}<span class="cb-name">${esc(it.label[lang])}<span class="bar"><i style="width:${(r * 100).toFixed(1)}%"></i></span></span><span class="cb-pct">${pctText(Math.round(r * 100), lang)}</span></li>`;
    })
    .join('');
  const faces = mulberry32(CROWD.seed + 1);
  const voters = Array.from({ length: 6 }, () => {
    const letter = 'ACEJLMNPRSTV'[Math.floor(faces() * 12)] ?? 'A';
    return `<span class="voter" style="--h:${Math.floor(faces() * 360)}">${letter}</span>`;
  }).join('');
  const [n, total] = CROWD.agree;
  const points = [S.crowd1, S.crowd2, S.crowd3, S.crowd4]
    .map((p) => `<li>${svg(CHECK, 18, 2.4)}${esc(p)}</li>`)
    .join('');
  return `<section class="sec wrap" id="crowd" aria-labelledby="crowd-h">
      <div class="crowd">
        <div>
          <div class="sec-head flush">
            <p class="kicker">${esc(S.crowdKicker)}</p>
            <h2 class="h2" id="crowd-h">${esc(S.crowdTitle)}</h2>
            <p class="lede">${esc(S.crowdLede)}</p>
          </div>
          <ul class="c-points">${points}</ul>
        </div>
        <div class="cboard" id="cboard" role="img" aria-label="${esc(S.crowdAria)}">
          <div class="cb-head"><p class="cb-title">${esc(S.crowdBoard)}</p><span class="livechip"><i></i>${esc(S.crowdLive)}</span></div>
          <div class="cb-meta"><span><b id="cb-votes">${c.votes}</b> ${esc(S.crowdVotes)} · <b id="cb-voters">${CROWD.voters}</b> ${esc(S.crowdVoters)}</span><span class="voters" id="voters">${voters}</span></div>
          <ol class="cb-list" id="cb-list">${rows}</ol>
          <div class="agree"><b>${esc(S.crowdYou)}</b><span>${esc(fill(S.crowdAgree, { n, total }))}</span><span class="bar"><i style="width:${Math.round((n / total) * 100)}%"></i></span></div>
        </div>
      </div>
    </section>`;
}

const FEATURE_ICONS = [
  '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/><path d="M3 3l18 18"/>',
  '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
];

function features(S: Strings): string {
  const items = ([1, 2, 3, 4, 5, 6] as const)
    .map(
      (k, i) =>
        `<li class="feat"><span class="ic">${svg(FEATURE_ICONS[i] ?? '', 22)}</span><h3>${esc(S[`f${k}Title`])}</h3><p>${S[`f${k}`]}</p></li>`,
    )
    .join('');
  return `<section class="sec wrap" aria-labelledby="feats-h">
      <div class="sec-head">
        <p class="kicker">${esc(S.featsKicker)}</p>
        <h2 class="h2" id="feats-h">${esc(S.featsTitle)}</h2>
      </div>
      <ul class="feats">${items}</ul>
    </section>`;
}

function finale(lang: Lang, S: Strings): string {
  const choc = item('choc');
  const pac = item('pac');
  return `<section class="sec wrap final-sec" aria-labelledby="final-h">
      <h2 class="h2" id="final-h">${esc(S.finalTitle)}</h2>
      <div class="final" id="final">
        <button type="button" class="half ha" data-v="a"><span class="tag" aria-hidden="true">A</span><span class="big">${esc(choc.label[lang])}</span></button>
        <span class="vsd" aria-hidden="true">vs</span>
        <button type="button" class="half hb" data-v="b"><span class="tag" aria-hidden="true">B</span><span class="big">${esc(pac.label[lang])}</span></button>
      </div>
      <div class="final-res" id="final-res" aria-live="polite"><p class="fr-t hint">${esc(S.finalHint)}</p></div>
    </section>`;
}

/** The footer: the app, the source, the author, the legal notice and the languages. */
export function footerHTML(
  lang: Lang,
  S: Strings,
  author: { name: string; url: string },
  source: string,
  links: PageLinks = homeLinks(lang),
): string {
  const root = links.root;
  const lang2 = (l: Lang) =>
    `<a href="${links.versions[l]}" hreflang="${l}" lang="${l}" data-lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${l === 'en' ? 'English' : 'Français'}</a>`;
  return `<footer class="foot">
    <div class="wrap foot-in">
      <p class="foot-brand"><span class="brand"><span class="brand-mark" aria-hidden="true">vs</span>Versus</span><span>${esc(S.tagline)}</span></p>
      <p class="foot-links"><a href="${root}${APP_PATH}">${esc(S.footApp)}</a><a href="${source}">${esc(S.footSource)}</a><span>${esc(S.aboutBy)} <a href="${author.url}">${esc(author.name)}</a></span><a href="${root}${LEGAL_PATH[lang]}">${esc(S.footLegal)}</a></p>
      <nav class="foot-langs" aria-label="${esc(S.footLangAria)}">${lang2('en')}${lang2('fr')}</nav>
    </div>
  </footer>`;
}

export interface LandingOpts {
  /** The build has the published boards API (the Worker build): show the crowd section. */
  publish: boolean;
  author: { name: string; url: string };
  source: string;
}

/** Everything inside <body> but the module script: sprite, header, sections, footer and the page's data. */
export function landingBody(lang: Lang, opts: LandingOpts): string {
  const S = strings(lang);
  const methodData = methodsData(lang, S);
  const tried = tryIt(lang, S);
  const data: PageData = { S, tryPair: tried.pair, methods: methodData };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<a class="skip" href="#main">${esc(S.skipLink)}</a>
    ${SPRITE}
    ${langHint(lang)}
    ${navHTML(lang, S)}
    <main id="main" tabindex="-1">
    ${hero(lang, S)}
    ${cases(lang, S)}
    ${how(lang, S)}
    ${tried.html}
    ${methods(lang, S, methodData)}
    ${opts.publish ? crowdSection(lang, S) : ''}
    ${features(S)}
    ${finale(lang, S)}
    </main>
    ${footerHTML(lang, S, opts.author, opts.source)}
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <script type="application/json" id="landing-data">${json}</script>`;
}
