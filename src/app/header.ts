import { getLang, t } from '../i18n';
import { $, $$, doc } from './dom';
import { S } from './state';
import { isTheme, savePrefs, type Theme } from './storage';

/** Static header texts, language and theme switchers. */

export function applyStatic(): void {
  const lang = getLang();
  doc.documentElement.lang = lang;
  // Same title as the static head (build/site.ts), in the current language.
  doc.title = `Versus — ${t('tagline')}`;
  $('.brand')?.setAttribute('aria-label', t('brandAria'));
  const note = $('#top-note');
  if (note) note.textContent = t('tagline');
  const drop = $('#drop-text');
  if (drop) drop.textContent = t('dropOverlay');
  $('.lang')?.setAttribute('aria-label', t('langAria'));
  for (const b of $$('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.l === lang));
  $('.theme')?.setAttribute('aria-label', t('themeAria'));
  const labels: Record<Theme, string> = { system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') };
  for (const b of $$('.theme button')) {
    const label = labels[b.dataset.t as Theme] ?? '';
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  applyTheme();
}

/** Browser chrome colors matching the two palettes (see --bg in styles.css). */
const THEME_COLORS: Record<'light' | 'dark', string> = { light: '#ECEEF2', dark: '#0E1015' };

/** "system" leaves the choice to prefers-color-scheme; light and dark pin the palette via data-theme. */
function applyTheme(): void {
  const theme: Theme = S.prefs.theme ?? 'system';
  const root = doc.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const b of $$('.theme button')) b.setAttribute('aria-pressed', String(b.dataset.t === theme));
  for (const meta of $$<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.content = theme === 'system' ? own : THEME_COLORS[theme];
  }
}
export function changeTheme(v: string | undefined): void {
  if (!isTheme(v)) return;
  S.prefs.theme = v;
  savePrefs(S.prefs);
  applyTheme();
}
