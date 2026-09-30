import { trackEvent } from '../audience';
import {
  type Backup,
  backupName,
  type ImportError,
  makeBackup,
  makeShare,
  mergeBackup,
  parseBackup,
  shareName,
} from '../core/backup';
import { uid } from '../core/util';
import { type MsgKey, plural, t } from '../i18n';
import { $, doc, toast } from './dom';
import { goBack, render } from './rankings';
import { localData, S } from './state';
import { saveJoined, saveOwners, saveRanks, saveVoter } from './storage';

/**
 * Export and import (docs/pwa.md). Export makes a file: through the share sheet on phones (Save to Files,
 * AirDrop, a message), as a download elsewhere. Import reads a file picked or dropped and adds what it holds to
 * this browser without replacing anything (src/core/backup.ts).
 */

const coarse = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** Hands the file over: through the share sheet, as a download, or not at all (the sheet was closed). */
async function deliver(name: string, data: Backup): Promise<'shared' | 'downloaded' | null> {
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  // On phones a download is easy to lose, and the iOS home-screen app can't show one: the share sheet has Save to Files.
  if (coarse() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      // Refused for another reason (no user gesture left, a policy): fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** Every ranking and vote of this browser, to keep or to open in another browser. */
export async function exportAll(): Promise<void> {
  const now = Date.now();
  const data = makeBackup(localData(), now);
  const name = backupName(now);
  const done = await deliver(name, data);
  if (!done) return;
  trackEvent('rankings-exported', { what: 'all', rankings: data.rankings.length, votes: data.joined.length });
  // Owner tokens give control of the published boards: say so whenever the file holds some.
  if (Object.keys(data.owners).length) toast(t('exportedKeys'));
  else if (done === 'downloaded') toast(t('exported', { file: name }));
}

/** One ranking, as a copy to send. */
export async function exportOne(id: string | undefined): Promise<void> {
  const r = S.ranks.find((x) => x.id === id);
  if (!r) return;
  const name = shareName(r.title);
  const done = await deliver(name, makeShare(r, Date.now()));
  if (!done) return;
  trackEvent('rankings-exported', { what: 'one', rankings: 1, votes: 0 });
  if (done === 'downloaded') toast(t('exported', { file: name }));
}

export const pickImport = (): void => $<HTMLInputElement>('#import-input')?.click();

export const isBackupFile = (f: File): boolean => f.type === 'application/json' || /\.json$/i.test(f.name);

const ERRORS: Record<ImportError, MsgKey> = {
  'not-versus': 'importNotVersus',
  newer: 'importNewer',
  empty: 'importEmpty',
};

export async function importFile(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    toast(t('importNotVersus'));
    return;
  }
  const parsed = parseBackup(text, Date.now());
  if (!parsed.ok) {
    toast(t(ERRORS[parsed.error]));
    return;
  }
  for (const r of parsed.value.rankings) if (!r.title) r.title = t('untitled');
  const m = mergeBackup(localData(), parsed.value, { newId: uid, copyTitle: (x) => `${x} ${t('copySuffix')}` });
  if (!m.added && !m.votes) {
    toast(t('importNothingNew'));
    return;
  }
  // Rankings first: when they don't fit, nothing changes.
  if (!saveRanks(m.local.ranks)) {
    toast(t('importTooBig'));
    return;
  }
  S.ranks = m.local.ranks;
  S.joined = m.local.joined;
  saveJoined(S.joined);
  saveOwners(m.local.owners);
  if (m.local.voter !== S.voter) {
    S.voter = m.local.voter;
    saveVoter(S.voter);
  }
  trackEvent('rankings-imported', { rankings: m.added, same: m.same, votes: m.votes });
  if (S.route.view === 'gallery') render();
  else goBack();
  const parts = [
    ...(m.added ? [plural(m.added, 'ranking')] : []),
    ...(m.votes ? [t('importedVotes', { n: m.votes })] : []),
    ...(m.same ? [t('importedSame', { n: m.same })] : []),
  ];
  toast(t('imported', { what: parts.join(', ') }));
}
