// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * oauth-token-read-ban-refusal — the authorization server's own doors that
 * read an access token back answer a banned user's token as one that is not
 * valid, while the ban holds.
 *
 * A ban refuses the user's OAuth access tokens at the MCP door
 * (`@objectstack/runtime` `oauth-subject-ban.ts`), and the token endpoint mints
 * that user no new token (`oauth-grant-ban-refusal.ts`). The installed
 * `@better-auth/oauth-provider` (1.7.12) serves two more doors that take an
 * access token and answer for its user: `/oauth2/userinfo` (OIDC Core §5.3),
 * which returns the user's claims, and `/oauth2/introspect` (RFC 7662), which
 * tells a resource server whether the token is active. Both answer here as
 * they answer a token that is not valid, with the one ban predicate every
 * other refusal asks (`isUserBanInForce`, `@objectstack/core`): the ban flag,
 * lifted once its expiry has passed, exactly as sign-in reads it.
 *
 * ## userinfo — `customUserInfoClaims`
 *
 * The provider validates the token, reads the user's row
 * (`internalAdapter.findUserById`) and hands that row to the operator's
 * `customUserInfoClaims` before it answers; nothing is written at userinfo. A
 * refusal thrown there is the provider's own answer to an access token that
 * does not verify: `401 invalid_token`, its description and its
 * `WWW-Authenticate` challenge — the answer a made-up token gets
 * ({@link INVALID_ACCESS_TOKEN_DESCRIPTION}; the provider does not export its
 * constants, so the real-provider test pins this answer equal to its own). The
 * row is the provider's read, so the refusal costs no read of its own.
 *
 * ## introspection — the global after-hook
 *
 * The provider answers an introspection of a JWT access token from the token
 * alone: that path reads no user row and calls no operator callback. So the
 * ban is judged on the answer, after the provider has produced it: an active
 * answer whose `sub` names a user whose ban holds is rewritten in place to
 * `{ active: false }`, the answer a made-up, expired or revoked token gets
 * (RFC 7662 §2.2). The same holds for an opaque access token and a refresh
 * token, whose active answers carry the same `sub`. `sub` is the user's id:
 * the platform configures no pairwise subject identifiers.
 *
 * One read of the subject's row, through the provider's own adapter, per
 * active answer that names a subject. A read that throws propagates and the
 * endpoint fails: never an invented active or inactive answer. A subject with
 * no user row (a machine-to-machine token) keeps the provider's answer.
 *
 * ⛔ Not a revocation, at either door: nothing is written, so lifting the ban
 * (or letting it expire) lets the same token read userinfo and introspect as
 * active again.
 */

import { isUserBanInForce, type UserBanFields } from '@objectstack/core';

/** The provider's description for an access token that does not verify (`/oauth2/userinfo`). */
export const INVALID_ACCESS_TOKEN_DESCRIPTION = 'Invalid access token';

/** The provider's challenge for an access token that does not verify. */
export const INVALID_ACCESS_TOKEN_WWW_AUTHENTICATE =
  `Bearer error="invalid_token", error_description="${INVALID_ACCESS_TOKEN_DESCRIPTION}"`;

/** The better-auth path of the introspection endpoint, as the hooks read `ctx.path`. */
export const OAUTH_INTROSPECT_PATH = '/oauth2/introspect';

type BanRow = (UserBanFields & Record<string, unknown>) | null | undefined;

/** What the provider hands `customUserInfoClaims` that this refusal reads. */
export interface UserInfoInput {
  user?: BanRow;
}

/**
 * Throws the provider's invalid-access-token error when the userinfo request
 * answers for a user whose ban holds at `nowMs`; returns nothing otherwise.
 */
export async function refuseUserInfoForBannedUser(input: UserInfoInput, nowMs: number = Date.now()): Promise<void> {
  if (!input.user || !isUserBanInForce(input.user, nowMs)) return;
  const { APIError } = await import('better-auth/api');
  throw new APIError(
    'UNAUTHORIZED',
    { error_description: INVALID_ACCESS_TOKEN_DESCRIPTION, error: 'invalid_token' },
    { 'WWW-Authenticate': INVALID_ACCESS_TOKEN_WWW_AUTHENTICATE },
  );
}

/** Reads one user row by id, as the provider's own adapter does. */
export type UserRowById = (userId: string) => Promise<BanRow>;

/**
 * The global after-hook's introspection section: rewrites an active
 * introspection answer for a banned subject to `{ active: false }`, in place.
 * A no-op for every other path and answer. `readUser` defaults to the
 * provider's adapter on `ctx.context`.
 */
export async function refuseIntrospectionForBannedSubject(
  ctx: any,
  readUser?: UserRowById,
  nowMs: number = Date.now(),
): Promise<void> {
  if (ctx?.path !== OAUTH_INTROSPECT_PATH) return;
  const returned = ctx?.context?.returned;
  if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return;
  if (returned.active !== true || typeof returned.sub !== 'string' || returned.sub === '') return;
  const read: UserRowById = readUser ?? ((id) => ctx.context.internalAdapter.findUserById(id));
  const user = await read(returned.sub);
  if (!user || !isUserBanInForce(user, nowMs)) return;
  for (const key of Object.keys(returned)) delete returned[key];
  returned.active = false;
}
