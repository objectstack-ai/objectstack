// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * oauth-grant-ban-refusal — the token endpoint mints no token for a user whose
 * ban holds.
 *
 * A ban holds every credential of the user: it ends their sessions, refuses
 * their sign-in, their API keys, and their OAuth access tokens at the door that
 * resolves them (`@objectstack/runtime` `oauth-subject-ban.ts`). A refresh
 * token renews an access token, and an authorization code exchange mints one,
 * so the grant is refused here for as long as the ban holds — with the one ban
 * predicate every other refusal asks (`isUserBanInForce`, `@objectstack/core`):
 * the ban flag, lifted once its expiry has passed, exactly as sign-in reads it.
 *
 * ## Where it runs, and why there
 *
 * The installed `@better-auth/oauth-provider` (1.7.12) resolves every grant
 * that acts for a user — `authorization_code`, `refresh_token`, and any
 * extension grant that issues through the provider — to that user's row
 * (`internalAdapter.findUserById`) and hands the row to ONE function,
 * `createUserTokens`, which mints the access, refresh and ID tokens. Its first
 * operator callback, `customTokenResponseFields({ grantType, user, … })`, runs
 * there BEFORE anything is written: before the refresh token is rotated, before
 * any token row is created, before anything is signed. So it is the one point
 * that sees every user grant with the user's row in hand, and a refusal thrown
 * from it leaves every row as it was. The provider throws its own grant errors
 * from the same handler, so a refusal thrown here leaves the endpoint exactly
 * as one of those does: the same status, body and headers.
 *
 * Not chosen: a `/oauth2/token` before-hook (it has no user — it would have to
 * re-implement the provider's refresh-token decoding and storage hashing); a
 * database hook on the token models (a refresh that mints a JWT access token
 * writes no access-token row, and the old refresh token is revoked before the
 * new one is created); `customAccessTokenClaims` (called for JWT access tokens
 * only, and after an opaque grant's refresh token is already written).
 *
 * The row is the provider's own read, so the refusal costs no read of its own.
 * A `client_credentials` grant has no user and is not touched.
 *
 * ## The answer
 *
 * The answer an invalid grant of the same type gets today: `400 invalid_grant`
 * with the provider's own description for that grant — `invalid refresh token`
 * (what an expired, revoked or misdirected refresh token answers) and `invalid
 * code` (what a spent or unknown code answers). Nothing tells the holder
 * whether the grant, or its user, is the reason. A grant type the provider
 * names no description for answers `invalid grant`.
 *
 * ⛔ Not a revocation: nothing is written, so lifting the ban (or letting it
 * expire) lets the same refresh token renew again.
 */

import { isUserBanInForce, type UserBanFields } from '@objectstack/core';

/** The provider's own `invalid_grant` description per grant type, as it answers an invalid grant of that type. */
const INVALID_GRANT_DESCRIPTION: Readonly<Record<string, string>> = {
  refresh_token: 'invalid refresh token',
  authorization_code: 'invalid code',
};

/** What the provider hands `customTokenResponseFields` that this refusal reads. */
export interface TokenGrantInput {
  grantType?: string;
  user?: (UserBanFields & Record<string, unknown>) | null;
}

/**
 * Throws the provider's `invalid_grant` error when the grant acts for a user
 * whose ban holds at `nowMs`; returns nothing otherwise.
 */
export async function refuseGrantForBannedUser(input: TokenGrantInput, nowMs: number = Date.now()): Promise<void> {
  if (!input.user || !isUserBanInForce(input.user, nowMs)) return;
  const { APIError } = await import('better-auth/api');
  throw new APIError('BAD_REQUEST', {
    error_description: INVALID_GRANT_DESCRIPTION[input.grantType ?? ''] ?? 'invalid grant',
    error: 'invalid_grant',
  });
}
