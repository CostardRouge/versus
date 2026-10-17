import { describe, expect, it } from 'vitest';
import {
  fromBase64url,
  milestoneOf,
  newMilestone,
  PUSH_AUDIENCE,
  parseEndpoint,
  parsePushPrefs,
  parsePushSubscription,
  parseUnsubscribe,
  pushMessage,
  pushOn,
  toBase64url,
  VOTER_MILESTONES,
  withPush,
} from '../src/core/push';
import { encrypt, sendPush, vapidAuth, vapidKeys } from '../worker/src/webpush';
import { fakeBrowser as browser, decryptPush as decrypt, fakeVapid as pair, vapidClaims } from './helpers/push';

const enc = new TextEncoder();
const dec = new TextDecoder();

// RFC 8291, Appendix A: the example of an encrypted push message, with every key and the salt it used.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  result:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** A P-256 key pair from its base64url scalar and public point. */
async function keyPair(d: string, pub: string, usage: 'ECDH' | 'ECDSA'): Promise<CryptoKeyPair> {
  const p = fromBase64url(pub);
  const x = toBase64url(p.subarray(1, 33));
  const y = toBase64url(p.subarray(33, 65));
  const alg = { name: usage, namedCurve: 'P-256' };
  const privUse: KeyUsage[] = usage === 'ECDH' ? ['deriveBits'] : ['sign'];
  const pubUse: KeyUsage[] = usage === 'ECDH' ? [] : ['verify'];
  return {
    privateKey: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x, y }, alg, true, privUse),
    publicKey: await crypto.subtle.importKey('raw', p, alg, true, pubUse),
  };
}

describe('encrypt (RFC 8291)', () => {
  it('gives the RFC’s example byte for byte', async () => {
    const keys = await keyPair(RFC.asPrivate, RFC.asPublic, 'ECDH');
    const body = await encrypt(
      enc.encode(RFC.plaintext),
      { endpoint: 'https://fcm.googleapis.com/x', p256dh: RFC.uaPublic, auth: RFC.auth },
      { keys, salt: fromBase64url(RFC.salt) },
    );
    expect(toBase64url(body)).toBe(RFC.result);
    const ua = await keyPair(RFC.uaPrivate, RFC.uaPublic, 'ECDH');
    expect(await decrypt(body, ua, RFC.auth)).toBe(RFC.plaintext);
  });

  it('encrypts each message with a new key and salt, that the browser decrypts', async () => {
    const b = await browser();
    const target = { endpoint: 'https://fcm.googleapis.com/x', p256dh: b.p256dh, auth: b.auth };
    const text = JSON.stringify({ title: 'Best café « crème »', body: '✓' });
    const one = await encrypt(enc.encode(text), target);
    const two = await encrypt(enc.encode(text), target);
    expect(toBase64url(one.slice(0, 16))).not.toBe(toBase64url(two.slice(0, 16)));
    expect(await decrypt(one, b.ua, b.auth)).toBe(text);
    expect(await decrypt(two, b.ua, b.auth)).toBe(text);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service’s origin, valid 12 hours, and reuses it', async () => {
    const k = await pair();
    const v = { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'https://versus.example/' };
    const now = Date.UTC(2026, 9, 2);
    const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', v, now);
    const { k: kk, claims } = await vapidClaims(header, k.verify);
    expect(kk).toBe(k.publicKey);
    expect(JSON.parse(dec.decode(fromBase64url(header.slice(8).split('.')[0] as string)))).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://versus.example/',
    });
    // Reused within its first 11 hours, renewed after.
    expect(await vapidAuth('https://fcm.googleapis.com/other', v, now + 3600_000)).toBe(header);
    expect(await vapidAuth('https://fcm.googleapis.com/other', v, now + 11.5 * 3600_000)).not.toBe(header);
    expect(await vapidAuth('https://web.push.apple.com/x', v, now)).not.toBe(header);
  });

  it('turns push on only with both keys, well formed', () => {
    const pub = `B${'A'.repeat(86)}`;
    const priv = 'a'.repeat(43);
    expect(vapidKeys({})).toBeNull();
    expect(vapidKeys({ VAPID_PUBLIC_KEY: pub })).toBeNull();
    expect(vapidKeys({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: 'short' })).toBeNull();
    expect(vapidKeys({ VAPID_PUBLIC_KEY: ` ${pub}\n`, VAPID_PRIVATE_KEY: priv })).toEqual({
      publicKey: pub,
      privateKey: priv,
    });
  });

  it('posts the encrypted message with its headers, and says when the subscription is gone', async () => {
    const k = await pair();
    const v = { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:a@b.c' };
    const b = await browser();
    const target = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      p256dh: b.p256dh,
      auth: b.auth,
    };
    const msg = { title: 'T', body: 'B', path: 'app/b/Ab3dEf7hJk', tag: 'closed-Ab3dEf7hJk' };
    const seen: Request[] = [];
    const real = globalThis.fetch;
    let status = 201;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return new Response(null, { status });
    }) as typeof fetch;
    try {
      expect(await sendPush(target, msg, 3600, v)).toBe('ok');
      status = 410;
      expect(await sendPush(target, msg, 3600, v)).toBe('gone');
      status = 404;
      expect(await sendPush(target, msg, 3600, v)).toBe('gone');
      status = 429;
      expect(await sendPush(target, msg, 3600, v)).toBe('failed');
    } finally {
      globalThis.fetch = real;
    }
    const req = seen[0] as Request;
    expect(req.url).toBe(target.endpoint);
    expect(req.method).toBe('POST');
    expect(req.headers.get('TTL')).toBe('3600');
    expect(req.headers.get('Topic')).toBe('closed-Ab3dEf7hJk');
    expect(req.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(req.headers.get('Authorization')).toMatch(/^vapid t=.+, k=B/);
    const body = new Uint8Array(await req.arrayBuffer());
    expect(JSON.parse(await decrypt(body, b.ua, b.auth))).toEqual(msg);
  });
});

describe('subscriptions', () => {
  const p256dh = `B${'x'.repeat(86)}`;
  const auth = 'y'.repeat(22);
  const sub = (endpoint: string, extra: object = {}) => ({
    subscription: { endpoint, expirationTime: null, keys: { p256dh, auth } },
    role: 'voter',
    lang: 'fr',
    ...extra,
  });

  it('takes the browsers’ push services only', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://web.push.apple.com/QGx',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(parseEndpoint(ok)).toBe(ok);
    }
    for (const no of [
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://push.apple.com.evil/x',
      `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
      'not a url',
      42,
    ]) {
      expect(parseEndpoint(no)).toBeNull();
    }
    expect(parseEndpoint('http://127.0.0.1:9999/p')).toBeNull();
    expect(parseEndpoint('http://127.0.0.1:9999/p', true)).toBe('http://127.0.0.1:9999/p');
    expect(parseEndpoint('http://localhost/p', true)).toBe('http://localhost/p');
    expect(parseEndpoint('http://10.0.0.1/p', true)).toBeNull();
  });

  it('reads what PushSubscription.toJSON() gives, padded or not', () => {
    const r = parsePushSubscription(sub('https://fcm.googleapis.com/fcm/send/a'));
    expect(r).toEqual({
      ok: true,
      value: { endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh, auth, role: 'voter', lang: 'fr' },
    });
    const padded = parsePushSubscription({
      subscription: { endpoint: 'https://fcm.googleapis.com/a', keys: { p256dh: `${p256dh}=`, auth: `${auth}==` } },
      role: 'owner',
      lang: 'de',
    });
    expect(padded.ok && padded.value).toMatchObject({ p256dh, auth, role: 'owner', lang: 'en' });
  });

  it('refuses anything else', () => {
    const bad = [
      null,
      {},
      sub('https://evil.example/x'),
      sub('https://fcm.googleapis.com/a', { role: 'admin' }),
      { ...sub('https://fcm.googleapis.com/a'), subscription: { endpoint: 'https://fcm.googleapis.com/a' } },
      {
        ...sub('https://fcm.googleapis.com/a'),
        subscription: { endpoint: 'https://fcm.googleapis.com/a', keys: { p256dh: `A${'x'.repeat(86)}`, auth } },
      },
      {
        ...sub('https://fcm.googleapis.com/a'),
        subscription: { endpoint: 'https://fcm.googleapis.com/a', keys: { p256dh, auth: 'short' } },
      },
    ];
    for (const x of bad) expect(parsePushSubscription(x).ok).toBe(false);
  });

  it('turns off by endpoint, for one role or both', () => {
    expect(parseUnsubscribe({ endpoint: 'https://fcm.googleapis.com/a', role: 'owner' })).toEqual({
      ok: true,
      value: { endpoint: 'https://fcm.googleapis.com/a', role: 'owner' },
    });
    expect(parseUnsubscribe({ endpoint: 'https://fcm.googleapis.com/a' })).toMatchObject({ value: { role: null } });
    expect(parseUnsubscribe({ endpoint: '' }).ok).toBe(false);
    expect(parseUnsubscribe({ endpoint: 'x'.repeat(2000) }).ok).toBe(false);
    expect(parseUnsubscribe('x').ok).toBe(false);
  });
});

describe('milestones', () => {
  it('names the highest milestone reached', () => {
    expect(milestoneOf(0)).toBe(0);
    expect(milestoneOf(4)).toBe(0);
    expect(milestoneOf(5)).toBe(5);
    expect(milestoneOf(99)).toBe(50);
    expect(milestoneOf(100)).toBe(100);
    expect(milestoneOf(1e9)).toBe(VOTER_MILESTONES[VOTER_MILESTONES.length - 1]);
  });

  it('tells each milestone once, never one passed before', () => {
    expect(newMilestone(5, 0)).toBe(5);
    expect(newMilestone(6, 5)).toBeNull();
    expect(newMilestone(10, 5)).toBe(10);
    // Voters who reset their votes leave, then come back: told already.
    expect(newMilestone(10, 10)).toBeNull();
    expect(newMilestone(9, 10)).toBeNull();
  });
});

describe('messages', () => {
  const board = { alias: 'Ab3dEf7hJk', title: 'Best pastry' };

  it('says what happened, in the subscriber’s language, and opens the board', () => {
    expect(pushMessage({ kind: 'closed' }, board, 'en')).toEqual({
      title: 'Best pastry',
      body: 'The vote is closed: see the crowd’s final ranking.',
      path: 'app/b/Ab3dEf7hJk',
      tag: 'closed-Ab3dEf7hJk',
    });
    expect(pushMessage({ kind: 'voters', voters: 25 }, board, 'fr').body).toBe(
      'Déjà 25 votants sur ton classement. Va voir où il en est.',
    );
    expect(pushMessage({ kind: 'voters', voters: 5 }, board, 'en').body).toBe(
      '5 voters on your ranking. See where it stands.',
    );
    expect(pushMessage({ kind: 'picture', label: 'Beach', ok: true }, board, 'en').body).toContain('“Beach”');
    expect(pushMessage({ kind: 'picture', label: 'Plage', ok: false }, board, 'fr').body).toBe(
      'Photo refusée : « Plage » reste en texte.',
    );
    expect(PUSH_AUDIENCE).toEqual({ closed: 'voter', voters: 'owner', picture: 'owner' });
  });

  it('round-trips base64url', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65));
    expect([...fromBase64url(toBase64url(bytes))]).toEqual([...bytes]);
    expect(toBase64url(new Uint8Array([251, 255]))).toBe('-_8');
  });
});

describe('this browser’s notifications', () => {
  const A = 'Ab3dEf7hJk';
  const B = 'Bc4eFg8iKm';

  it('reads what it stored, and nothing else', () => {
    expect(parsePushPrefs(null)).toEqual({ endpoint: '', boards: {} });
    expect(
      parsePushPrefs({
        endpoint: 'https://fcm.googleapis.com/x',
        boards: { [A]: ['voter', 'voter', 'admin'], [B]: [], 'not an alias': ['voter'], Cd5fGh9jLn: 'owner' },
      }),
    ).toEqual({ endpoint: 'https://fcm.googleapis.com/x', boards: { [A]: ['voter'] } });
  });

  it('turns a role of a board on and off', () => {
    let p = parsePushPrefs({ endpoint: 'e', boards: {} });
    p = withPush(p, A, 'voter', true);
    p = withPush(p, A, 'owner', true);
    p = withPush(p, A, 'owner', true);
    expect(p.boards[A]).toEqual(['voter', 'owner']);
    expect(pushOn(p, A, 'owner')).toBe(true);
    expect(pushOn(p, B, 'owner')).toBe(false);
    p = withPush(p, A, 'voter', false);
    expect(p.boards).toEqual({ [A]: ['owner'] });
    p = withPush(withPush(p, B, 'voter', true), A, null, false);
    expect(p).toEqual({ endpoint: 'e', boards: { [B]: ['voter'] } });
  });
});
