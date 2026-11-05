// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The authorization server's doors that read an access token back answer a
 * banned user's token as one that is not valid (`oauth-token-read-ban-refusal.ts`):
 * userinfo as an access token that does not verify, introspection as an
 * inactive token.
 *
 * Both answers are pinned equal to the real provider's own answer for a
 * made-up token in `auth-manager.oauth-consent-organization.test.ts`; this
 * file pins each refusal's rule, the controls, the store-fault posture, and
 * that AuthManager's global after-hook runs the introspection section.
 */

import { describe, it, expect, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import {
  INVALID_ACCESS_TOKEN_DESCRIPTION,
  INVALID_ACCESS_TOKEN_WWW_AUTHENTICATE,
  OAUTH_INTROSPECT_PATH,
  refuseIntrospectionForBannedSubject,
  refuseUserInfoForBannedUser,
} from './oauth-token-read-ban-refusal.js';
import { globalAfterHook, type AfterHookHost } from './auth-manager-after-hook.js';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const user = (over: Record<string, unknown> = {}) => ({ id: 'u1', email: 'u1@example.com', ...over });

async function refusalOf(promise: Promise<void>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('userinfo answers a banned user\'s token as an access token that does not verify', () => {
  it('a banned user\'s userinfo is refused with the provider\'s invalid-token answer', async () => {
    const err = await refusalOf(refuseUserInfoForBannedUser({ user: user({ banned: true }) }, NOW));
    expect(err).toBeInstanceOf(APIError);
    expect(err.statusCode).toBe(401);
    expect(err.body).toEqual({ error_description: INVALID_ACCESS_TOKEN_DESCRIPTION, error: 'invalid_token' });
    expect(err.headers).toMatchObject({ 'WWW-Authenticate': INVALID_ACCESS_TOKEN_WWW_AUTHENTICATE });
  });

  it('a ban with a future expiry binds, in either spelling of the expiry', async () => {
    const future = NOW + 60_000;
    for (const exp of [new Date(future), new Date(future).toISOString()]) {
      expect(await refusalOf(refuseUserInfoForBannedUser({ user: user({ banned: true, banExpires: exp }) }, NOW))).toBeInstanceOf(APIError);
      expect(await refusalOf(refuseUserInfoForBannedUser({ user: user({ banned: true, ban_expires: exp }) }, NOW))).toBeInstanceOf(APIError);
    }
  });

  it('control: a passed expiry, a lifted ban, no ban and no user row each read userinfo as before', async () => {
    const past = new Date(NOW - 60_000);
    for (const u of [user({ banned: true, banExpires: past }), user({ banned: false }), user(), null, undefined]) {
      await expect(refuseUserInfoForBannedUser({ user: u as any }, NOW)).resolves.toBeUndefined();
    }
  });
});

describe('introspection answers a banned user\'s token as inactive', () => {
  const introspection = (returned: unknown, path = OAUTH_INTROSPECT_PATH) => ({ path, context: { returned } });
  const ACTIVE = () => ({ active: true, sub: 'u1', client_id: 'c1', scope: 'openid', exp: 1, iat: 0, token_type: 'Bearer' });

  it('an active answer for a banned subject becomes `{ active: false }`, in place', async () => {
    const ctx = introspection(ACTIVE());
    const returned = ctx.context.returned;
    const read = vi.fn(async () => user({ banned: true }));
    await refuseIntrospectionForBannedSubject(ctx, read, NOW);
    expect(ctx.context.returned).toBe(returned);
    expect(returned).toEqual({ active: false });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('u1');
  });

  it('a ban with a future expiry binds; a passed one does not', async () => {
    const banned = introspection(ACTIVE());
    await refuseIntrospectionForBannedSubject(banned, async () => user({ banned: true, banExpires: new Date(NOW + 60_000) }), NOW);
    expect(banned.context.returned).toEqual({ active: false });

    const lapsed = introspection(ACTIVE());
    await refuseIntrospectionForBannedSubject(lapsed, async () => user({ banned: true, banExpires: new Date(NOW - 60_000) }), NOW);
    expect(lapsed.context.returned).toEqual(ACTIVE());
  });

  it('control: a subject that is not banned, or has no user row, keeps the provider\'s answer', async () => {
    for (const row of [user({ banned: false }), user(), null, undefined]) {
      const ctx = introspection(ACTIVE());
      await refuseIntrospectionForBannedSubject(ctx, async () => row as any, NOW);
      expect(ctx.context.returned).toEqual(ACTIVE());
    }
  });

  it('an inactive answer, an answer with no subject, another path and a non-object answer read nothing', async () => {
    const read = vi.fn(async () => user({ banned: true }));
    const cases = [
      introspection({ active: false }),
      introspection({ active: true, client_id: 'c1' }),
      introspection({ active: true, sub: '' }),
      introspection(ACTIVE(), '/oauth2/userinfo'),
      introspection(null),
      introspection([ACTIVE()]),
      introspection(new APIError('BAD_REQUEST', { error: 'invalid_request' })),
    ];
    for (const ctx of cases) {
      const before = JSON.stringify(ctx.context.returned);
      await refuseIntrospectionForBannedSubject(ctx, read, NOW);
      expect(JSON.stringify(ctx.context.returned)).toBe(before);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('a subject read that throws fails the request and leaves the answer as the provider produced it', async () => {
    const ctx = introspection(ACTIVE());
    const fault = new Error('store unavailable');
    await expect(refuseIntrospectionForBannedSubject(ctx, async () => { throw fault; }, NOW)).rejects.toBe(fault);
    expect(ctx.context.returned).toEqual(ACTIVE());
  });

  it('reads the subject through the provider\'s own adapter when no reader is given', async () => {
    const findUserById = vi.fn(async () => user({ banned: true }));
    const ctx: any = introspection(ACTIVE());
    ctx.context.internalAdapter = { findUserById };
    await refuseIntrospectionForBannedSubject(ctx, undefined, NOW);
    expect(findUserById).toHaveBeenCalledWith('u1');
    expect(ctx.context.returned).toEqual({ active: false });
  });

  it('AuthManager\'s global after-hook runs the introspection section', async () => {
    const host = {
      externalDirectoryDoorDeps: () => ({}),
      isEmailDeliveryLive: () => false,
      roleChangeGrantDeps: () => undefined,
    } as unknown as AfterHookHost;
    const ctx: any = introspection(ACTIVE());
    ctx.context.internalAdapter = { findUserById: async () => user({ banned: true }) };
    await globalAfterHook.call(host, ctx);
    expect(ctx.context.returned).toEqual({ active: false });
  });
});
