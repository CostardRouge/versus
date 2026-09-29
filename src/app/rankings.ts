import { buildDemo, DEMOS, relabelDemos } from '../core/demos';
import { mkRank } from '../core/model';
import { methodOf } from '../core/scoring';
import type { Ranking } from '../core/types';
import { uid } from '../core/util';
import { getLang, isLang, plural, setLang as setI18nLang, t } from '../i18n';
import { cp } from './color';
import { $, ask, narrow, toast } from './dom';
import { galleryHTML } from './gallery';
import { applyStatic } from './header';
import { renderList } from './items';
import { cur, S, save } from './state';
import { savePrefs } from './storage';
import { setTab, wsHTML } from './workspace';

/** Top-level view switch (gallery or workspace) and actions on whole rankings. */

export function render(): void {
  const pop = $('#cpop');
  if (pop && !pop.hidden) {
    pop.hidden = true;
    cp.id = null;
  }
  const view = $('#view');
  if (!view) return;
  if (S.route.view === 'rank') {
    const r = cur();
    if (!r) {
      S.route = { view: 'gallery', tab: 'duel' };
      render();
      return;
    }
    view.innerHTML = wsHTML(r);
    renderList(r, false);
    setTab(S.route.tab);
  } else view.innerHTML = galleryHTML();
}
export function open(id: string | undefined, tab: string | undefined): void {
  if (!id) return;
  S.route = { view: 'rank', id, tab: tab === 'results' || tab === 'items' ? tab : 'duel' };
  render();
  window.scrollTo?.(0, 0);
}
export function newRank(title?: string): Ranking {
  const r = mkRank(title ?? t('newRanking'));
  S.ranks.push(r);
  save();
  open(r.id, narrow.matches ? 'items' : 'duel');
  if (!title) {
    const input = $<HTMLInputElement>('#rank-title');
    input?.focus();
    input?.select();
  }
  return r;
}
export async function resetRank(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  if (r.demo) return resetDemo(id);
  const ok = await ask({
    title: t('resetTitle'),
    body: t('resetBody', { duels: plural(r.history.length, 'duel'), title: r.title }),
    ok: t('restart'),
    danger: true,
  });
  if (!ok) return;
  r.history = [];
  r.pair = null;
  r.updated = Date.now();
  save();
  render();
  toast(t('resetDone'));
}
export async function resetDemo(id: string | undefined): Promise<void> {
  const d = DEMOS.find((x) => x.id === id);
  if (!d) return;
  const ok = await ask({ title: t('resetDemoTitle'), body: t('resetDemoBody'), ok: t('reset') });
  if (!ok) return;
  const i = S.ranks.findIndex((r) => r.id === id);
  const fresh = buildDemo(d, getLang());
  if (i >= 0) S.ranks[i] = fresh;
  else S.ranks.push(fresh);
  save();
  render();
  toast(t('demoReset'));
}
export function duplicateRank(id: string | undefined): void {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const c = mkRank(`${r.title} ${t('copySuffix')}`, methodOf(r));
  c.items = r.items.map((it) => ({ ...structuredClone(it), id: uid() }));
  S.ranks.push(c);
  save();
  open(c.id, 'duel');
  toast(t('copyCreated'));
}
export function toggleDemos(): void {
  S.prefs.hideDemos = !S.prefs.hideDemos;
  savePrefs(S.prefs);
  render();
}
export function changeLang(l: string | undefined): void {
  const from = getLang();
  if (!isLang(l) || l === from) return;
  relabelDemos(S.ranks, from, l);
  setI18nLang(l);
  S.prefs.lang = l;
  savePrefs(S.prefs);
  save();
  applyStatic();
  render();
}
export async function deleteRank(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const ok = await ask({
    title: t('deleteTitle'),
    body: t('deleteBody', { title: r.title, items: plural(r.items.length, 'item') }),
    ok: t('deleteOk'),
    danger: true,
  });
  if (!ok) return;
  S.ranks = S.ranks.filter((x) => x.id !== id);
  save();
  if (S.route.id === id) S.route = { view: 'gallery', tab: 'duel' };
  render();
  toast(t('deleted'));
}

export function goBack(): void {
  if (S.route.view === 'gallery') return;
  S.route = { view: 'gallery', tab: 'duel' };
  render();
  window.scrollTo?.(0, 0);
}
