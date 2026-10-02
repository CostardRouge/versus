import {
  fromBase64url,
  PRIVATE_KEY_RE,
  PUBLIC_KEY_RE,
  type PushMessage,
  type PushTarget,
  toBase64url,
} from '../../src/core/push';

/**
 * Web Push from the Worker, with WebCrypto only (docs/published-boards.md#notifications): the message is encrypted
 * for the browser (RFC 8291, `aes128gcm`, RFC 8188) and the request signed with the server's VAPID key (RFC 8292),
 * then posted to the browser's push service (RFC 8030), which can't read it.
 */

/** The server's key pair (the Worker's secrets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY) and its contact. */
export interface Vapid {
  publicKey: string;
  privateKey: string;
  /** An `https:` or `mailto:` address push services can reach the sender at: the site's. */
  subject: string;
}

/** The pair when both are set and well formed; push is off otherwise. */
export function vapidKeys(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}): { publicKey: string; privateKey: string } | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  return PUBLIC_KEY_RE.test(publicKey) && PRIVATE_KEY_RE.test(privateKey) ? { publicKey, privateKey } : null;
}

const enc = new TextEncoder();
/** Records are at most this long (RFC 8188): one record holds a whole message. */
const RECORD_SIZE = 4096;

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

async function hkdf(salt: BufferSource, ikm: ArrayBuffer, info: BufferSource, bytes: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8);
}

/** The sender's one-time key pair, and the salt: random unless given (the RFC's example, in the tests). */
export interface Ephemeral {
  keys: CryptoKeyPair;
  salt: Uint8Array<ArrayBuffer>;
}

async function ephemeral(): Promise<Ephemeral> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return { keys, salt: crypto.getRandomValues(new Uint8Array(16)) };
}

/**
 * The message encrypted for one browser (RFC 8291): a shared secret from a one-time key pair and the browser's
 * key, mixed with the browser's auth secret, gives the content key and nonce of a single `aes128gcm` record.
 */
export async function encrypt(
  plaintext: Uint8Array,
  target: PushTarget,
  given?: Ephemeral,
): Promise<Uint8Array<ArrayBuffer>> {
  const { keys, salt } = given ?? (await ephemeral());
  const uaPublic = fromBase64url(target.p256dh);
  const auth = fromBase64url(target.auth);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // `public` is the standard name (the Workers types call it `$public`).
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const shared = await crypto.subtle.deriveBits(ecdh, keys.privateKey, 256);
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The only record is the last one: its padding delimiter is 2.
  const record = concat(plaintext, new Uint8Array([2]));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.byteLength;
  return concat(header, asPublic, sealed);
}

let signer: { privateKey: string; key: CryptoKey } | null = null;
const tokens = new Map<string, { jwt: string; exp: number }>();

async function signingKey(v: Vapid): Promise<CryptoKey> {
  if (signer?.privateKey !== v.privateKey) {
    const pub = fromBase64url(v.publicKey);
    const jwk: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      d: v.privateKey,
      x: toBase64url(pub.subarray(1, 33)),
      y: toBase64url(pub.subarray(33, 65)),
    };
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    signer = { privateKey: v.privateKey, key };
    tokens.clear();
  }
  return signer.key;
}

const json64 = (x: unknown): string => toBase64url(enc.encode(JSON.stringify(x)));

/**
 * The `Authorization` header for a push service (RFC 8292): a JWT signed with ES256 naming the service's origin,
 * valid 12 hours, kept for reuse until its last hour.
 */
export async function vapidAuth(endpoint: string, v: Vapid, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const key = await signingKey(v);
  const cached = tokens.get(aud);
  const s = Math.floor(now / 1000);
  let jwt = cached && cached.exp - s > 3600 ? cached.jwt : '';
  if (!jwt) {
    const exp = s + 12 * 3600;
    const body = `${json64({ typ: 'JWT', alg: 'ES256' })}.${json64({ aud, exp, sub: v.subject })}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(body));
    jwt = `${body}.${toBase64url(new Uint8Array(sig))}`;
    tokens.set(aud, { jwt, exp });
  }
  return `vapid t=${jwt}, k=${v.publicKey}`;
}

/** How a send went: delivered to the push service, the subscription is gone (forget it), or it failed. */
export type Sent = 'ok' | 'gone' | 'failed';

/** Encrypts and posts one message. `ttl` in seconds; `topic` replaces a message of the same topic still waiting. */
export async function sendPush(target: PushTarget, msg: PushMessage, ttl: number, v: Vapid): Promise<Sent> {
  const body = await encrypt(enc.encode(JSON.stringify(msg)), target);
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(target.endpoint, v),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Topic: msg.tag.replace(/[^\w-]/g, '').slice(0, 32),
      Urgency: 'normal',
    },
    body,
  });
  // The body is never needed; read it so the connection is released.
  await res.body?.cancel();
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'ok' : 'failed';
}
