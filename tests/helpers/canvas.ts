/**
 * A 2D canvas for jsdom, which has none: every drawing call is recorded and returns nothing, text measures
 * ten pixels a character (so wrapping is deterministic), and `toBlob` hands back a small PNG-typed blob.
 */
export function installFakeCanvas(): { calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      return () => {
        calls.push(prop);
      };
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) {
    cb(new Blob([`png ${this.width}x${this.height}`], { type: 'image/png' }));
  };
  return { calls };
}
