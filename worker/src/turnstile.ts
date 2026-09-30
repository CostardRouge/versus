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
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}
