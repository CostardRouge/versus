import { makeAlias } from '../../src/core/board';

/** Random identifiers the Worker hands out (board aliases, owner tokens) and the hashes it keeps of secrets. */

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A board's public alias (10 base58 characters). */
export const newAlias = (): string => makeAlias(randomBytes);

/** An author's token (64 hex characters), stored hashed in the board. */
export const newOwnerToken = (): string => toHex(randomBytes(32));

/** SHA-256 of a string, in hex: how a board keeps its owner token, and how secrets are compared. */
export async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

/** Whether two secrets are the same, in constant time: both hashed first, so both have the same length. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  return crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b));
}
