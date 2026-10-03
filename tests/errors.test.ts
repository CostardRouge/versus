import { describe, expect, it } from 'vitest';
import { errorKey, OWNER_ERRORS, PUBLISH_ERRORS, READ_ERRORS, REPORT_ERRORS } from '../src/app/errors';
import { type ApiCode, ApiError } from '../src/app/remote';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

/** Every code an API call can fail with: a full record, so a code added to the protocol fails typecheck here too. */
const CODES: Record<ApiCode, true> = {
  network: true,
  bad_request: true,
  images_not_allowed: true,
  not_found: true,
  forbidden: true,
  exists: true,
  closed: true,
  unknown_item: true,
  not_assigned: true,
  final: true,
  too_fast: true,
  hello_first: true,
  full: true,
  too_few: true,
  captcha: true,
  rate_limited: true,
  upgrade: true,
  changed: true,
  too_large: true,
  unsupported: true,
};

describe('the error maps', () => {
  it('give every code a message that both dictionaries have', () => {
    for (const [name, map] of Object.entries({ OWNER_ERRORS, PUBLISH_ERRORS, READ_ERRORS, REPORT_ERRORS })) {
      expect(Object.keys(map).sort(), name).toEqual(Object.keys(CODES).sort());
      for (const [code, key] of Object.entries(map)) {
        expect(en, `${name}.${code}`).toHaveProperty(key);
        expect(fr, `${name}.${code}`).toHaveProperty(key);
      }
    }
  });

  it('say offline when the server can’t be reached, and what the call means otherwise', () => {
    expect(errorKey(new ApiError('network'), OWNER_ERRORS)).toBe('offline');
    expect(errorKey(new ApiError('network'), PUBLISH_ERRORS)).toBe('offline');
    expect(errorKey(new ApiError('forbidden'), OWNER_ERRORS)).toBe('ownerKeyLost');
    expect(errorKey(new ApiError('forbidden'), REPORT_ERRORS)).toBe('reportNeedsVote');
    expect(errorKey(new ApiError('too_large'), PUBLISH_ERRORS)).toBe('publishTooLarge');
    expect(errorKey(new ApiError('bad_request'), PUBLISH_ERRORS)).toBe('publishInvalid');
    expect(errorKey(new ApiError('not_found'), READ_ERRORS)).toBe('boardGone');
    // A code from a newer server, or no API error at all: the call's own fallback.
    expect(errorKey(new ApiError('brand_new' as ApiCode), PUBLISH_ERRORS, 'publishFailed')).toBe('publishFailed');
    expect(errorKey(new TypeError('bug'), OWNER_ERRORS)).toBe('actionFailed');
  });
});
