import { trackEvent } from '../audience';
import { type Shared, sharedLabels, sharedTitle } from '../core/list';
import { esc } from '../core/util';
import { locale, plural, t } from '../i18n';
import { importFile, isBackupFile } from './backup';
import { $, ask, narrow, toast } from './dom';
import { addFiles, addLabelList } from './items';
import { newRank, open } from './rankings';
import { S } from './state';

/**
 * What another app shared to Versus (the manifest's share_target, docs/pwa.md). The service worker sets it aside
 * in a cache, `versus-inbox` (src/sw/sw.ts); the app picks it up once, at startup. A Versus file is imported;
 * photos or text become items, in a new ranking or in one the user picks.
 */

const INBOX = 'versus-inbox';

export interface Inbox extends Shared {
  files: File[];
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Reads and empties the inbox. Null when there is nothing (no share, no Cache API). */
export async function takeShared(): Promise<Inbox | null> {
  try {
    if (typeof caches === 'undefined' || !(await caches.has(INBOX))) return null;
    const cache = await caches.open(INBOX);
    const metaKey = (await cache.keys()).find((k) => new URL(k.url).pathname.endsWith('/inbox/meta'));
    const meta: unknown = metaKey ? await (await cache.match(metaKey))?.json() : null;
    const out: Inbox = { title: '', text: '', url: '', files: [] };
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      out.title = str(m.title);
      out.text = str(m.text);
      out.url = str(m.url);
      for (const f of Array.isArray(m.files) ? m.files : []) {
        const res = typeof f?.key === 'string' ? await cache.match(f.key) : undefined;
        if (!res) continue;
        const blob = await res.blob();
        out.files.push(new File([blob], str(f.name) || 'file', { type: str(f.type) || blob.type }));
      }
    }
    await caches.delete(INBOX);
    return out;
  } catch {
    return null;
  }
}

/** Where to add what was shared: null for a new ranking, an id for one of this browser's, undefined if cancelled. */
async function pickTarget(what: string): Promise<string | null | undefined> {
  // Published rankings change through their board, and demos are the same for everyone: neither takes items here.
  const mine = S.ranks
    .filter((r) => !r.demo && !r.pub)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 8);
  if (!mine.length) return null;
  const options = [
    `<label class="opt"><input type="radio" name="share-to" value="" checked> <b>${t('shareNew')}</b></label>`,
    ...mine.map(
      (r) =>
        `<label class="opt"><input type="radio" name="share-to" value="${esc(r.id)}"> ${esc(r.title)} <span class="muted mono">${plural(r.items.length, 'item')}</span></label>`,
    ),
  ].join('');
  const ok = await ask({
    title: t('shareTitle'),
    html: `<p class="muted">${t('shareInto', { what })}</p><fieldset class="set">${options}</fieldset>`,
    ok: t('shareAdd'),
  });
  if (!ok) return undefined;
  return $<HTMLInputElement>('input[name="share-to"]:checked')?.value || null;
}

/** Picks up a share, if there is one: run once the app is up. */
export async function receiveShare(): Promise<void> {
  const s = await takeShared();
  if (!s) return;
  const backup = s.files.find(isBackupFile);
  if (backup) {
    trackEvent('share-received', { what: 'file', items: 0 });
    await importFile(backup);
    return;
  }
  const images = s.files.filter((f) => f.type.startsWith('image/'));
  const labels = images.length ? [] : sharedLabels(s);
  const n = images.length || labels.length;
  if (!n) {
    toast(t('shareNothing'));
    return;
  }
  const target = await pickTarget(images.length ? plural(n, 'image') : plural(n, 'item'));
  if (target === undefined) return;
  const date = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  let r = target ? S.ranks.find((x) => x.id === target) : undefined;
  if (r) open(r.id, narrow.matches ? 'items' : 'duel');
  else r = newRank(images.length ? t('imagesRankTitle', { date }) : (sharedTitle(s) ?? t('sharedRankTitle', { date })));
  trackEvent('share-received', { what: images.length ? 'images' : 'text', items: n });
  if (images.length) await addFiles(r, images);
  else addLabelList(r, labels);
}
