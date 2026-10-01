import { makeAlias } from '../../src/core/board';

/** Random identifiers the Worker hands out: board aliases and owner tokens. */

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A board's public alias (10 base58 characters). */
export const newAlias = (): string => makeAlias(randomBytes);

/** An author's token (64 hex characters), stored hashed in the board. */
export const newOwnerToken = (): string => toHex(randomBytes(32));
