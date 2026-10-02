import { fromBase64url, toBase64url } from '../../src/core/push';

/** What a browser and a push service do with Web Push messages, to check the server's from the other side. */

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: ArrayBuffer, info: Uint8Array<ArrayBuffer>, n: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, n * 8);
}

/** A browser's subscription keys: its P-256 pair, the public half and the auth secret as it sends them. */
export interface FakeBrowser {
  ua: CryptoKeyPair;
  p256dh: string;
  auth: string;
}

export async function fakeBrowser(): Promise<FakeBrowser> {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
  return { ua, p256dh, auth: toBase64url(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Decrypts a message (RFC 8291) as the browser does; throws when it isn't one record of `aes128gcm` for it. */
export async function decryptPush(body: Uint8Array<ArrayBuffer>, ua: CryptoKeyPair, auth: string): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  if (rs !== 4096 || idlen !== 65) throw new Error('not a Web Push header');
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256);
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(fromBase64url(auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('not the last record');
  return new TextDecoder().decode(plain.subarray(0, end));
}

/** A server's VAPID pair as the Worker's secrets hold it, and the key that checks its signatures. */
export async function fakeVapid(): Promise<{ publicKey: string; privateKey: string; verify: CryptoKey }> {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  const publicKey = toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey)));
  return { publicKey, privateKey: jwk.d as string, verify: k.publicKey };
}

/** The claims of a VAPID `Authorization` header, once its signature checks out with `verify`. */
export async function vapidClaims(header: string, verify: CryptoKey): Promise<{ k: string; claims: unknown }> {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (!m) throw new Error(`not a VAPID header: ${header}`);
  const [, h = '', c = '', s = '', k = ''] = m;
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verify,
    fromBase64url(s),
    enc.encode(`${h}.${c}`),
  );
  if (!ok) throw new Error('bad signature');
  return { k, claims: JSON.parse(new TextDecoder().decode(fromBase64url(c))) };
}
