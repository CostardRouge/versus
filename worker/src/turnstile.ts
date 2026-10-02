import { errorText, log } from './log';

/** Cloudflare Turnstile check for publications (https://developers.cloudflare.com/turnstile/). */

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** True when Turnstile accepts the token. Any failure (network included) counts as a refusal. */
export async function verifyTurnstile(
  token: unknown,
  ip: string | null,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetcher(SITEVERIFY, { method: 'POST', body: form });
    const data = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (data.success === true) return true;
    // A refusal (a bot, an expired or reused token) is not an outage: the two get lines of their own.
    const codes = data['error-codes'];
    log('turnstile_refused', { codes: Array.isArray(codes) ? codes.join(' ') : '' });
    return false;
  } catch (e) {
    log('turnstile_unreachable', { error: errorText(e) });
    return false;
  }
}
