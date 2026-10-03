import type { MsgKey } from '../i18n';
import { type ApiCode, ApiError } from './remote';

/**
 * What the app says when a call to the API fails, for every code it can fail with: each map is a full record, so a
 * code added to the protocol is a type error until it says something. A code the server sends that the app doesn't
 * know (a newer server) gets the call's own fallback.
 */

export type ErrorMap = Record<ApiCode, MsgKey>;

/** What any call says; the maps below change what their own calls mean. */
const COMMON = {
  network: 'offline',
  bad_request: 'actionFailed',
  images_not_allowed: 'boardNoPictures',
  not_found: 'boardGone',
  forbidden: 'actionFailed',
  exists: 'actionFailed',
  closed: 'voteClosed',
  unknown_item: 'actionFailed',
  not_assigned: 'actionFailed',
  final: 'finalVotes',
  too_fast: 'actionFailed',
  hello_first: 'actionFailed',
  full: 'boardFull',
  too_few: 'needTwoItems',
  captcha: 'captchaFailed',
  rate_limited: 'tooManyTries',
  upgrade: 'appOutdated',
  changed: 'actionFailed',
  too_large: 'actionFailed',
  unsupported: 'actionFailed',
} as const satisfies ErrorMap;

/** The author's calls (owner token): a refused token means this device no longer holds the board's key. */
export const OWNER_ERRORS: ErrorMap = { ...COMMON, forbidden: 'ownerKeyLost', exists: 'itemExists' };

/** Publishing a ranking. */
export const PUBLISH_ERRORS: ErrorMap = {
  ...COMMON,
  bad_request: 'publishInvalid',
  too_large: 'publishTooLarge',
  images_not_allowed: 'blockImages',
  // Three new addresses taken in a row: practically never, and trying again works.
  exists: 'publishFailed',
};

/** Reporting a board: only its voters can. */
export const REPORT_ERRORS: ErrorMap = { ...COMMON, forbidden: 'reportNeedsVote' };

/** Reading a board (to make one's own version of it). */
export const READ_ERRORS: ErrorMap = COMMON;

/** The message for a failed call: by its code in `map`, else `fallback` (not an API error, or an unknown code). */
export function errorKey(e: unknown, map: ErrorMap, fallback: MsgKey = 'actionFailed'): MsgKey {
  return (e instanceof ApiError && map[e.code]) || fallback;
}
