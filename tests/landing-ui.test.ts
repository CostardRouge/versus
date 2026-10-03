// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { landingBody, type PageData } from '../src/landing/markup';
import { mountLanding } from '../src/landing/mount';
import { strings } from '../src/landing/strings';

const S = strings('en');
const OPTS = {
  publish: true,
  author: { name: 'Steeve Pommier', url: 'https://steevepommier.com/' },
  source: 'https://github.com/CostardRouge/versus',
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const data = (): PageData => JSON.parse($('#landing-data').textContent ?? '{}');
const count = () => $('#try-frame .f-count').textContent;

beforeAll(() => {
  vi.useFakeTimers();
  // Reduced motion: no autoplay, so the page is in its interactive state from the start.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, 'languages', { value: ['fr-FR', 'fr'], configurable: true });
  localStorage.clear();
  sessionStorage.clear();
  // Someone who already made a ranking.
  localStorage.setItem('versus-v1', JSON.stringify([{ id: 'x', demo: false }]));
  document.documentElement.lang = 'en';
  document.body.innerHTML = landingBody('en', OPTS);
  // Links would navigate away: keep the page, the page's own handlers still run.
  document.addEventListener('click', (e) => e.preventDefault(), true);
  mountLanding(document);
});

describe('home page', () => {
  it('hands the hero demo to the visitor at once under reduced motion', () => {
    expect($('#hero-say').textContent).toBe(S.sayCalm);
    expect($('#hero-btn').hidden).toBe(true);
    expect($('#pause').hidden).toBe(true);
  });

  it('plays a duel from the buttons and from a focused card, and undoes it', async () => {
    expect(count()).toBe('0 duels');
    $('#try-frame [data-act="a"]').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(count()).toBe('1 duel');
    $('#try-frame .card-b').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(count()).toBe('2 duels');
    expect($('#try-frame .f-toast').textContent).toBe(S.toast1);
    $('#try-frame [data-act="undo"]').click();
    expect(count()).toBe('1 duel');
  });

  it('shows the podium on the Ranking tab', () => {
    $('#try-frame [data-tab="results"]').click();
    expect($('#try-frame .pane.res').classList.contains('off')).toBe(false);
    expect(document.querySelectorAll('#try-frame .pod')).toHaveLength(3);
    $('#try-frame [data-tab="duel"]').click();
  });

  it('switches topics', () => {
    $('.sb-tab[data-topic="colors"]').click();
    expect($('#try-frame .f-title').textContent).toBe('Accent color');
    expect($('.sb-tab[data-topic="colors"]').getAttribute('aria-pressed')).toBe('true');
    expect(count()).toBe('0 duels');
  });

  it('reorders the same duels by method', () => {
    $('.m-tab[data-m="sort"]').click();
    const order = Array.from(document.querySelectorAll<HTMLElement>('#m-list li')).map((li) => li.dataset.id);
    expect(order).toEqual(data().methods.rows.sort.map((r) => r.id));
    expect($('.m-desc[data-m="sort"]').hidden).toBe(false);
    expect($('.m-desc[data-m="bt"]').hidden).toBe(true);
    expect($('#m-foot').textContent).toContain(String(data().methods.sortDuels));
    expect($('#m-col').textContent).toBe(S.m_sort_col);
  });

  it('answers the closing question', () => {
    $('.half.hb').click();
    expect($('#final').classList.contains('vb')).toBe(true);
    expect($('#final-res').textContent).toContain(S.finalMore);
    expect($('.half.hb').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers the browser language without redirecting, until dismissed', () => {
    expect($('#lang-hint').hidden).toBe(false);
    $('#lang-hint-close').click();
    expect($('#lang-hint').hidden).toBe(true);
    expect(sessionStorage.getItem('versus-lang-hint')).toBe('1');
  });

  it('remembers a chosen language for the app, which a link to the app never overrides', () => {
    $('.langs a[data-lang="fr"]').click();
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').lang).toBe('fr');
    $('.nav-cta').click();
    expect(JSON.parse(localStorage.getItem('versus-prefs') ?? '{}').lang).toBe('fr');
  });

  it('offers a returning visitor their rankings', () => {
    expect($('.nav-cta').textContent).toBe(S.myRankings);
  });

  it('pauses every animation from one button', () => {
    $('#pause').click();
    expect(document.documentElement.classList.contains('paused')).toBe(true);
    expect($('#pause').getAttribute('aria-pressed')).toBe('true');
    // A toggle keeps its name: only its pressed state says the animations are paused.
    expect($('#pause').getAttribute('aria-label')).toBe(S.pauseAnim);
    $('#pause').click();
    expect(document.documentElement.classList.contains('paused')).toBe(false);
  });
});
