import { trackEvent } from '../audience';
import { nextPair, target } from '../core/scoring';
import type { MethodKey } from '../core/types';
import { esc, mulberry32 } from '../core/util';
import { BoardView, flip } from './board';
import { crowd, rate, standings, vote } from './crowd';
import { CROWD, item, PICKS, SETTLING, TOPICS } from './data';
import { fmt, isText, mediaHTML, nDuels, pctOf, rankOf, thumbHTML } from './frame';
import type { PageData } from './markup';
import { calm, isPaused, loopWhenSeen, setPaused } from './motion';
import type { Strings } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

/**
 * The h1's word: "anything", then the examples in turn, letter by letter. Only the word on screen is in the
 * page (and the one leaving, for a moment), so the title reads "Rank anything two at a time" to crawlers and
 * screen readers keep the static word.
 */
export function rotator(S: Strings): void {
  const rot = $('#rot');
  if (!rot || calm()) return;
  const words = [...S.rotWords.split('|'), S.heroAnything];
  const letters = (w: string) =>
    Array.from(w, (c, k) => `<i style="--k:${k}">${c === ' ' ? '&nbsp;' : esc(c)}</i>`).join('');
  rot.insertAdjacentHTML('beforebegin', `<span class="sr-only">${esc(S.heroAnything)}</span> `);
  rot.setAttribute('aria-hidden', 'true');
  const first = $('.rw', rot);
  if (first) first.innerHTML = letters(S.heroAnything);
  loopWhenSeen(rot, async (run) => {
    let i = words.length - 1;
    // Cobalt and coral in turn, like A and B.
    for (let turn = 1; ; turn++) {
      await run.wait(2600);
      i = (i + 1) % words.length;
      const old = $('.rw.on', rot);
      rot.insertAdjacentHTML(
        'beforeend',
        `<span class="rw ${turn % 2 ? 'cb' : 'ca'}">${letters(words[i] ?? '')}</span>`,
      );
      const next = rot.lastElementChild as HTMLElement;
      void next.offsetWidth;
      old?.classList.replace('on', 'out');
      next.classList.add('on');
      setTimeout(() => old?.remove(), 900);
    }
  });
}

/** "Add": a name typed, a #hex turning into a color, a photo dropped in. */
function addVignette(S: Strings): void {
  const v = $('.v1');
  if (!v) return;
  const list = $('.v-list', v) as HTMLElement;
  const typed = $('.v-typed', v) as HTMLElement;
  const sw = $('.v-sw', v) as HTMLElement;
  const enterKey = $('.v-enter', v) as HTMLElement;
  const file = $('.v-file', v) as HTMLElement;
  const croissant = item('croissant');
  const [kouign, saffron, photo] = Array.from(list.children).map((li) => li.outerHTML);
  loopWhenSeen(v, async (run) => {
    const type = async (s: string) => {
      for (const ch of s) {
        typed.textContent += ch;
        await run.wait(55 + Math.random() * 60);
      }
    };
    const enter = async () => {
      enterKey.classList.add('on');
      await run.wait(170);
      enterKey.classList.remove('on');
    };
    for (;;) {
      list.classList.add('clear');
      await run.wait(420);
      list.innerHTML = '';
      list.classList.remove('clear');
      typed.textContent = '';
      sw.classList.remove('on');
      await run.wait(450);
      await type('Kouign-amann');
      await run.wait(300);
      await enter();
      typed.textContent = '';
      list.insertAdjacentHTML('beforeend', kouign ?? '');
      await run.wait(700);
      await type('#F2A5');
      await type('16');
      sw.classList.add('on');
      await run.wait(550);
      await enter();
      typed.textContent = '';
      sw.classList.remove('on');
      list.insertAdjacentHTML('beforeend', saffron ?? '');
      await run.wait(700);
      v.classList.add('drop');
      file.classList.remove('fly');
      void file.offsetWidth;
      file.classList.add('fly');
      await run.wait(1000);
      v.classList.remove('drop');
      list.insertAdjacentHTML('beforeend', photo ?? `<li>${thumbHTML(croissant, S.lang)}</li>`);
      await run.wait(2400);
    }
  });
}

/** "Choose": a key decides each pair. */
function pickVignette(S: Strings): void {
  const v = $('.v2');
  if (!v) return;
  const say = $('.v2-say', v) as HTMLElement;
  const set = (el: HTMLElement | null, id: string, side: 'a' | 'b') => {
    if (!el) return;
    const it = item(id);
    el.className = `mc mc-${side}${isText(it) ? ' is-txt' : ' media'}`;
    el.innerHTML = `<span class="tag">${side.toUpperCase()}</span>${mediaHTML(it)}${isText(it) ? '' : '<span class="shade"></span>'}<b>${esc(it.label[S.lang])}</b>`;
  };
  loopWhenSeen(v, async (run) => {
    for (let k = 1; ; k++) {
      const [a, b, res] = PICKS[k % PICKS.length] as (typeof PICKS)[number];
      const A = $('.mc-a', v);
      const B = $('.mc-b', v);
      set(A, a, 'a');
      set(B, b, 'b');
      say.textContent = '';
      await run.wait(1000);
      const key = $(`kbd[data-k="${res}"]`, v);
      key?.classList.add('on');
      if (res === 'draw') {
        A?.classList.add('lose');
        B?.classList.add('lose');
        say.textContent = S.v2Tie;
      } else {
        (res === 'a' ? A : B)?.classList.add('win');
        (res === 'a' ? B : A)?.classList.add('lose');
        say.textContent = fmt(S.v2Wins, { label: item(res === 'a' ? a : b).label[S.lang] });
      }
      await run.wait(220);
      key?.classList.remove('on');
      await run.wait(1500);
    }
  });
}

/** "Discover": the order settles while stability fills up. */
function settleVignette(S: Strings): void {
  const v = $('.v3');
  if (!v) return;
  const list = $('.v3-list', v) as HTMLElement;
  const apply = (st: (typeof SETTLING)[number]) => {
    flip(list, st.order);
    st.order.forEach((_, k) => {
      const li = list.children[k];
      const pos = li?.querySelector('.pos');
      if (pos) pos.textContent = String(k + 1);
      const bar = li?.querySelector<HTMLElement>('.bar i');
      if (bar) bar.style.width = `${st.w[k]}%`;
    });
    const bar = $('.v3-stab .bar i', v);
    if (bar) bar.style.width = `${st.s}%`;
    const txt = $('.v3-stab .mono', v);
    if (txt) txt.textContent = pctOf(st.s, S.lang);
    $('.v3-done', v)?.classList.toggle('on', st.s === 100);
  };
  loopWhenSeen(v, async (run) => {
    for (;;) {
      for (const st of SETTLING) {
        apply(st);
        await run.wait(st.s === 100 ? 2800 : 1400);
      }
    }
  });
}

export function vignettes(S: Strings): void {
  addVignette(S);
  pickVignette(S);
  settleVignette(S);
}

/** "Try it here": six topics, played for real, with a few words of encouragement. */
export function tryIt(S: Strings, data: PageData): BoardView | null {
  const frame = $('#try-frame');
  if (!frame) return null;
  let done = false;
  const view = new BoardView(frame, S, {
    interactive: true,
    onDuel(V) {
      const n = V.rank.history.length;
      if (!done && n >= target(V.rank)) {
        done = true;
        V.confetti();
        V.toast(S.toastStable);
        setTimeout(() => V.show('results'), 1200);
      } else if (n === 1) V.toast(S.toast1);
      else if (n === 6) V.toast(S.toast6);
      else if (n === target(V.rank) - 4) V.toast(S.toastNear);
    },
  });
  const tabs = $$('.sb-tab');
  let current = TOPICS[0]?.id ?? '';
  const load = (id: string, pair?: [string, string]) => {
    const topic = TOPICS.find((t) => t.id === id) ?? TOPICS[0];
    if (!topic) return;
    done = false;
    current = topic.id;
    const r = rankOf(topic.items, topic.title[S.lang], S.lang);
    view.load(r, pair ?? (nextPair(r) as [string, string]));
    frame.setAttribute('aria-label', topic.title[S.lang]);
    for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.topic === topic.id));
  };
  for (const t of tabs) {
    t.addEventListener('click', () => {
      view.engaged = true;
      load(t.dataset.topic ?? '');
    });
  }
  $('#try-reset')?.addEventListener('click', () => load(current));
  load(current, data.tryPair);
  return view;
}

/** Same duels, four methods: the order animates from one to the other. */
export function methods(S: Strings, data: PageData): void {
  const list = $('#m-list');
  if (!list) return;
  const ref = new Map(data.methods.rows.bt.map((r, k) => [r.id, k]));
  const show = (m: MethodKey) => {
    const rows = data.methods.rows[m];
    flip(
      list,
      rows.map((r) => r.id),
    );
    rows.forEach((row, k) => {
      const li = list.children[k];
      if (!li) return;
      const d = (ref.get(row.id) ?? k) - k;
      const pos = li.querySelector('.pos');
      if (pos) pos.textContent = String(k + 1);
      const sc = li.querySelector('.sc');
      if (sc) sc.innerHTML = row.sc;
      const dl = li.querySelector('.dl');
      if (dl) {
        dl.className = `dl ${m === 'bt' ? '' : d > 0 ? 'up' : d < 0 ? 'down' : 'eq'}`;
        dl.textContent = m === 'bt' ? '' : d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '=';
        if (m === 'bt') dl.removeAttribute('title');
        else dl.setAttribute('title', d > 0 ? fmt(S.upBy, { n: d }) : d < 0 ? fmt(S.downBy, { n: -d }) : S.sameRank);
      }
    });
    const col = $('#m-col');
    if (col) col.textContent = S[`m_${m}_col`];
    const meta = $('#m-meta');
    const items = fmt(S.itemsN, { n: rows.length });
    if (meta)
      meta.textContent = `${items} · ${m === 'sort' ? fmt(S.sortDuels, { n: data.methods.sortDuels }) : nDuels(data.methods.duels, S)}`;
    const foot = $('#m-foot');
    if (foot)
      foot.textContent =
        m === 'bt' ? S.mFootBt : m === 'sort' ? fmt(S.mFootSort, { n: data.methods.sortDuels, items }) : S.mFootOther;
    for (const b of $$('.m-tab')) b.setAttribute('aria-pressed', String(b.dataset.m === m));
    for (const p of $$('.m-desc')) p.hidden = p.dataset.m !== m;
  };
  for (const b of $$('.m-tab')) b.addEventListener('click', () => show((b.dataset.m ?? 'bt') as MethodKey));
}

/** The published board example keeps voting while it's on screen. */
export function crowdBoard(S: Strings): void {
  const board = $('#cboard');
  const list = $('#cb-list');
  if (!board || !list) return;
  const c = crowd(CROWD.items, mulberry32(CROWD.seed));
  for (let k = 0; k < CROWD.votes; k++) vote(c);
  let voters = CROWD.voters;
  const faces = mulberry32(CROWD.seed + 2);
  const votersEl = $('#voters');
  loopWhenSeen(board, async (run) => {
    for (;;) {
      await run.wait(650 + faces() * 700);
      const hit = vote(c);
      if (faces() < 0.3 && votersEl) {
        voters++;
        const letter = 'ACEJLMNPRSTV'[Math.floor(faces() * 12)] ?? 'A';
        votersEl.insertAdjacentHTML(
          'afterbegin',
          `<span class="voter new" style="--h:${Math.floor(faces() * 360)}">${letter}</span>`,
        );
        if (votersEl.children.length > 7) votersEl.lastElementChild?.remove();
      }
      const ids = standings(c);
      flip(list, ids);
      ids.forEach((id, k) => {
        const li = list.children[k];
        const r = rate(c.tally.get(id) ?? { w: 0, g: 0 });
        const pos = li?.querySelector('.pos');
        if (pos) pos.textContent = String(k + 1);
        const bar = li?.querySelector<HTMLElement>('.bar i');
        if (bar) bar.style.width = `${(r * 100).toFixed(1)}%`;
        const pct = li?.querySelector('.cb-pct');
        if (pct) pct.textContent = pctOf(Math.round(r * 100), S.lang);
      });
      const nv = $('#cb-votes');
      if (nv) nv.textContent = String(c.votes);
      const nr = $('#cb-voters');
      if (nr) nr.textContent = String(voters);
      const li = hit ? list.querySelector<HTMLElement>(`[data-id="${hit}"]`) : null;
      if (li) {
        li.classList.remove('hit');
        void li.offsetWidth;
        li.classList.add('hit');
        li.insertAdjacentHTML('beforeend', '<span class="plus1" aria-hidden="true">+1</span>');
        setTimeout(() => li.querySelector('.plus1')?.remove(), 900);
      }
    }
  });
}

/** The closing question: whichever side, an answer and the way to the app. */
export function finale(S: Strings, appHref: string, burst: (host: HTMLElement) => void): void {
  const fin = $('#final');
  const res = $('#final-res');
  if (!fin || !res) return;
  const words = (html: string) =>
    html
      .split(' ')
      .map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`)
      .join(' ');
  fin.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-v]');
    if (!b) return;
    const v = b.dataset.v === 'b' ? 'b' : 'a';
    trackEvent('chocolatine', { side: v === 'a' ? 'chocolatine' : 'pain-au-chocolat' });
    fin.classList.remove('va', 'vb');
    void fin.offsetWidth;
    fin.classList.add(`v${v}`);
    for (const h of $$('.half', fin)) h.setAttribute('aria-pressed', String(h === b));
    burst(fin);
    res.innerHTML = `<p class="fr-t">${words(`${v === 'a' ? S.finalA : S.finalB} ${esc(S.finalMore)}`)}</p><a class="btn primary lg" href="${appHref}">${esc(S.openApp)} <svg class="arr" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>`;
  });
}

/**
 * Languages: a click on a language remembers it (the app's `versus-prefs`, so the app opens in it too), a
 * link to the app from this page carries the page's language when none was chosen yet, and a visitor whose
 * browser prefers the other language is offered it, never redirected.
 */
export function languages(S: Strings): void {
  const prefs = (): Record<string, unknown> => {
    try {
      const v = JSON.parse(localStorage.getItem('versus-prefs') ?? '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  };
  const save = (lang: string, force: boolean) => {
    try {
      const p = prefs();
      if (!force && (p.lang === 'en' || p.lang === 'fr')) return;
      localStorage.setItem('versus-prefs', JSON.stringify({ ...p, lang }));
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  };
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!a) return;
    if (a.dataset.lang) save(a.dataset.lang, true);
    else if (/(^|\/)app\/$/.test(a.getAttribute('href') ?? '')) save(S.lang, false);
  });
  const hint = $('#lang-hint');
  if (!hint) return;
  const chosen = prefs().lang;
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem('versus-lang-hint') === '1';
  } catch {
    /* no session storage: the hint may show again */
  }
  const wanted = (navigator.languages?.length ? navigator.languages : [navigator.language])
    .map((l) => (l ?? '').slice(0, 2).toLowerCase())
    .find((l) => l === 'en' || l === 'fr');
  if (chosen || dismissed || !wanted || wanted === S.lang) return;
  hint.hidden = false;
  $('#lang-hint-close')?.addEventListener('click', () => {
    hint.hidden = true;
    try {
      sessionStorage.setItem('versus-lang-hint', '1');
    } catch {
      /* ignore */
    }
  });
}

/** Links from before the home page carry the app's routes in the fragment (#/b/<alias>): they belong to the app. */
function oldLinks(): void {
  const go = () => {
    if (/^#\//.test(location.hash))
      location.replace(`${document.querySelector('.nav-cta')?.getAttribute('href') ?? 'app/'}${location.hash}`);
  };
  window.addEventListener('hashchange', go);
}

/** Someone who already made a ranking is offered theirs rather than the app in general. */
function returning(S: Strings): void {
  let mine = false;
  try {
    const ranks = JSON.parse(localStorage.getItem('versus-v1') ?? '[]');
    mine = Array.isArray(ranks) && ranks.some((r) => r && typeof r === 'object' && !r.demo);
  } catch {
    /* unreadable storage: the generic label stays */
  }
  const cta = $('.nav-cta');
  if (mine && cta) cta.textContent = S.myRankings;
}

/**
 * One button pauses every animation of the page (WCAG 2.2.2): a toggle whose name stays "Pause animations", only
 * its pressed state changing. The header gets a line once scrolled.
 */
export function chrome(S: Strings): void {
  returning(S);
  oldLinks();
  const pause = $('#pause');
  pause?.addEventListener('click', () => {
    setPaused(!isPaused());
    pause.setAttribute('aria-pressed', String(isPaused()));
  });
  if (calm() && pause) pause.hidden = true;
  const nav = $('#nav');
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

const KEYS: Record<string, 'a' | 'b' | 'draw' | 'skip'> = {
  ArrowLeft: 'a',
  ArrowRight: 'b',
  ArrowDown: 'draw',
  s: 'skip',
  S: 'skip',
};

/** Arrow keys and S play the frame in sight that the visitor has touched. */
export function keyboard(views: readonly BoardView[]): void {
  const active = () => {
    let best: BoardView | null = null;
    let seen = 0.3;
    for (const V of views) {
      if (!V.o.interactive || !V.engaged) continue;
      const r = V.root.getBoundingClientRect();
      const h = Math.min(r.height, window.innerHeight) || 1;
      const vis = Math.max(0, Math.min(window.innerHeight, r.bottom) - Math.max(0, r.top)) / h;
      if (vis > seen) {
        seen = vis;
        best = V;
      }
    }
    return best;
  };
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as Element | null;
    if (el?.closest('input, textarea, select, [contenteditable]')) return;
    const act = KEYS[e.key];
    if (!act) return;
    const V = active();
    if (!V) return;
    e.preventDefault();
    if (V.tab !== 'duel') return V.show('duel');
    if (act === 'skip') V.skip();
    else void V.pick(act);
  });
}
