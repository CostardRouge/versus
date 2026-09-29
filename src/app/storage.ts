import type { Ranking } from '../core/types';
import type { Lang } from '../i18n';

export const STORE_KEY = 'versus-v1';
export const PREF_KEY = 'versus-prefs';
/** Keys used by the earlier prototypes; user-made rankings are carried over once. */
const LEGACY_KEYS = ['elo-rank-v2', 'elo-rank-v1'];

export interface Prefs {
  lang?: Lang;
  hideDemos?: boolean;
}

/** localStorage can be missing or throw (private mode, blocked storage), so every access is guarded. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJSON(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadRanks(): Ranking[] | null {
  const v = readJSON(STORE_KEY);
  return Array.isArray(v) ? (v as Ranking[]) : null;
}

export function loadLegacyRanks(): Ranking[] {
  for (const key of LEGACY_KEYS) {
    const old = readJSON(key);
    if (Array.isArray(old)) {
      return (old as Array<Ranking & { example?: boolean }>)
        .filter((r) => !r.example && !r.demo)
        .map((r) => ({
          ...r,
          method: r.method ?? 'bt',
          pair: null,
          items: r.items.map((i) => ({ ...i, fill: i.fill ?? null })),
        }));
    }
  }
  return [];
}

/** Returns false when the write failed (quota exceeded or storage unavailable). */
export function saveRanks(ranks: Ranking[]): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(STORE_KEY, JSON.stringify(ranks));
    return true;
  } catch {
    return false;
  }
}

export function loadPrefs(): Prefs {
  const v = readJSON(PREF_KEY);
  return v && typeof v === 'object' ? (v as Prefs) : {};
}

export function savePrefs(p: Prefs): void {
  try {
    storage()?.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* preferences are a convenience; ignore */
  }
}
