// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SLOT, sentence } from '../src/app/finale';

describe('end-of-vote sentences', () => {
  it('puts an item name in as it is, even one that reads like a replacement pattern', () => {
    for (const label of ["$'", '$&', '$`', '$$', 'Fish & chips']) {
      const html = sentence(`The crowd chose ${SLOT}.`, { id: 'a', label, img: null, fill: null, h: 10 });
      const el = document.createElement('p');
      el.innerHTML = html;
      expect(el.textContent).toBe(`The crowd chose ${label}.`);
    }
  });
});
