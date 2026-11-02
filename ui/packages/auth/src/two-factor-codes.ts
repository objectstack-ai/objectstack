/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29105 — the refusal codes after which a pending two-factor
 * sign-in no longer exists on the server, from better-auth's `twoFactor()`
 * plugin (`TWO_FACTOR_ERROR_CODES`):
 *
 * - `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` — the challenge's attempt budget is
 *   spent; the server consumed it and expired its cookie.
 * - `INVALID_TWO_FACTOR_COOKIE` — the challenge cookie is missing, expired
 *   (ten minutes by default) or already used.
 *
 * Another code can never succeed after either, so the sign-in goes back to
 * the password step. Every other refusal (`INVALID_CODE`,
 * `INVALID_BACKUP_CODE`, `ACCOUNT_TEMPORARILY_LOCKED`, a rate limit) leaves the
 * challenge in place.
 */
export const TWO_FACTOR_CHALLENGE_ENDED_CODES: ReadonlySet<string> = new Set([
  'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
  'INVALID_TWO_FACTOR_COOKIE',
]);
