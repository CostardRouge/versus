import { VOTER_RE } from '../core/board';
import { parseJoined } from '../core/joined';
import type { Joined, Ranking } from '../core/types';
import type { Lang } from '../i18n';

/** Rankings. An item's image is a data URL, or a reference `idb:<key>` to one kept in IndexedDB (src/app/images.ts, D118). */
export const STORE_KEY = 'versus-v1';
export const PREF_KEY = 'versus-prefs';
/** Keys used by the earlier prototypes; user-made rankings are carried over once. */
const LEGACY_KEYS = ['elo-rank-v2', 'elo-rank-v1'];

export type Theme = 'system' | 'light' | 'dark';
export const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

export interface Prefs {
  lang?: Lang;
  hideDemos?: boolean;
  theme?: Theme;
  /** Live updates of crowd rankings; on unless turned off. */
  live?: boolean;
  /** How the end-of-vote page shows the result; the podium unless changed. */
  resultView?: 'podium' | 'duo';
  /** How a local ranking's Ranking tab shows it: podium, or lines comparing two methods. */
  rankView?: 'podium' | 'lines';
  /** The voter was told once where the boards they vote on are kept ("Your votes"). */
  joinedHint?: boolean;
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

/** Returns false when the write failed (quota exceeded or storage unavailable); the stored rankings are then unchanged. */
export function saveRanks(ranks: readonly Ranking[]): boolean {
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

export const VOTER_KEY = 'versus-voter';
export const OWNERS_KEY = 'versus-owners';

/** This browser's anonymous voter id, created on first use. Without storage it lasts for the page. */
export function loadVoter(make: () => string): string {
  const v = readJSON(VOTER_KEY);
  if (typeof v === 'string' && VOTER_RE.test(v)) return v;
  const id = make();
  try {
    storage()?.setItem(VOTER_KEY, JSON.stringify(id));
  } catch {
    /* a new id next time: the voter just counts as someone new */
  }
  return id;
}

/** Owner tokens of the boards published or managed from this browser, by alias. */
export function loadOwners(): Record<string, string> {
  const v = readJSON(OWNERS_KEY);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/** Every owner token at once (an import). */
export function saveOwners(owners: Record<string, string>): void {
  try {
    storage()?.setItem(OWNERS_KEY, JSON.stringify(owners));
  } catch {
    /* the admin links still work */
  }
}

/** Replaces this browser's voter id (an import into a browser that hasn't voted yet). */
export function saveVoter(id: string): void {
  try {
    storage()?.setItem(VOTER_KEY, JSON.stringify(id));
  } catch {
    /* it lasts for the page */
  }
}

export function saveOwner(alias: string, token: string | null): void {
  const owners = loadOwners();
  if (token) owners[alias] = token;
  else delete owners[alias];
  try {
    storage()?.setItem(OWNERS_KEY, JSON.stringify(owners));
  } catch {
    /* the admin link still works */
  }
}

export const JOINED_KEY = 'versus-joined';

/** The published boards this browser voted on ("Your votes"). */
export const loadJoined = (): Joined[] => parseJoined(readJSON(JOINED_KEY));

export function saveJoined(list: Joined[]): void {
  try {
    storage()?.setItem(JOINED_KEY, JSON.stringify(list));
  } catch {
    /* the cards come back on the next vote */
  }
}
