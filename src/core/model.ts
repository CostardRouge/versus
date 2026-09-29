import type { Fill, Item, MethodKey, Ranking } from './types';
import { hueOf, uid } from './util';

export function mkItem(label: string, img: string | null = null, fill: Fill | null = null): Item {
  return { id: uid(), label, img, fill, h: hueOf(label) };
}

export function mkRank(title: string, method: MethodKey = 'bt'): Ranking {
  const now = Date.now();
  return { id: uid(), title, method, items: [], history: [], pair: null, created: now, updated: now };
}

export const getItem = (r: Ranking, id: string): Item | undefined => r.items.find((i) => i.id === id);
