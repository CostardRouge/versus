/**
 * Makes the key pair the Worker signs notifications with (VAPID, RFC 8292): `npm run vapid`, then set both values
 * as the Worker's secrets (docs/online-architecture.md#notifications). Prints them only: nothing is written, and
 * the private key never goes into the repository.
 *
 * Make a pair once and keep it: browsers subscribe with the public key, so a new pair leaves every subscription
 * made with the old one silent until its browser subscribes again (the app does so when the bell is used).
 */

import { Buffer } from 'node:buffer';

const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])) as CryptoKeyPair;
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = Buffer.from(raw).toString('base64url');

console.log(`VAPID_PUBLIC_KEY  ${publicKey}`);
console.log(`VAPID_PRIVATE_KEY ${jwk.d}`);
console.log(`
Set both as secrets of the Worker, in the dashboard (Workers & Pages → versus → Settings → Variables and Secrets,
type Secret) or with:
  npx wrangler secret put VAPID_PUBLIC_KEY -c worker/wrangler.jsonc
  npx wrangler secret put VAPID_PRIVATE_KEY -c worker/wrangler.jsonc
Keep the private key to yourself: anyone holding it can send notifications as Versus.`);
