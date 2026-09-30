/** A PNG's first bytes: the signature and the IHDR chunk with the given size; the rest doesn't matter to the server. */
export function fakePng(width: number, height: number, padTo = 0): Uint8Array {
  const out = new Uint8Array(Math.max(33, padTo));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}
