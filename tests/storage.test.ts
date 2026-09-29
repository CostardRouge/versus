import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLegacyRanks, loadPrefs, loadRanks, PREF_KEY, STORE_KEY, savePrefs, saveRanks } from '../src/app/storage';
import { mkItem, mkRank } from '../src/core/model';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage', () => {
  it('saves and loads rankings', () => {
    const r = mkRank('Test');
    r.items.push(mkItem('A'));
    expect(saveRanks([r])).toBe(true);
    expect(loadRanks()).toEqual([r]);
  });

  it('returns null when nothing or garbage is stored', () => {
    expect(loadRanks()).toBeNull();
    localStorage.setItem(STORE_KEY, '{not json');
    expect(loadRanks()).toBeNull();
  });

  it('reports a failed write instead of throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(saveRanks([mkRank('Big')])).toBe(false);
  });

  it('carries over user rankings from the prototype, not its examples', () => {
    const mine = { ...mkRank('Mine'), method: undefined, items: [{ id: 'x', label: 'X', img: null, h: 1 }] };
    const example = { ...mkRank('Example'), example: true };
    localStorage.setItem('elo-rank-v1', JSON.stringify([mine, example]));
    const migrated = loadLegacyRanks();
    expect(migrated.map((r) => r.title)).toEqual(['Mine']);
    expect(migrated[0]?.method).toBe('bt');
    expect(migrated[0]?.items[0]?.fill).toBeNull();
  });

  it('keeps preferences separately', () => {
    expect(loadPrefs()).toEqual({});
    savePrefs({ lang: 'fr', hideDemos: true });
    expect(JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}')).toEqual({ lang: 'fr', hideDemos: true });
    expect(loadPrefs()).toEqual({ lang: 'fr', hideDemos: true });
  });
});
