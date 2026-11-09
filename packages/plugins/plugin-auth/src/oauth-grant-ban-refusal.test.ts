// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The token endpoint mints no token for a user whose ban holds: the grant is
 * answered as an invalid grant of its type (`oauth-grant-ban-refusal.ts`).
 *
 * The answer is pinned against the provider's own error for that grant — the
 * same class, status, `error` and `error_description` the installed
 * `@better-auth/oauth-provider` throws for an invalid refresh token or code —
 * so a banned user's grant cannot be told from an invalid one. The wiring into
 * the provider and the door's answer are pinned end to end in the dogfood
 * battery (`oauth-banned-subject.dogfood.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { APIError } from 'better-auth/api';
import { refuseGrantForBannedUser } from './oauth-grant-ban-refusal.js';

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

/** What the provider answers an invalid grant of `grantType` with, as it builds it. */
const providerInvalidGrant = (description: string) =>
  new APIError('BAD_REQUEST', { error_description: description, error: 'invalid_grant' });

describe('a banned user is minted no token: the grant answers as an invalid grant of its type', () => {
  it('a refresh grant for a banned user answers as an invalid refresh token', async () => {
    const err = await refusalOf(refuseGrantForBannedUser({ grantType: 'refresh_token', user: user({ banned: true }) }, NOW));
    const control = providerInvalidGrant('invalid refresh token');

    expect(err).toBeInstanceOf(APIError);
    expect(err.status).toBe(control.status);
    expect(err.statusCode).toBe(400);
    expect(err.body).toEqual(control.body);
    expect(err.body).toEqual({ error_description: 'invalid refresh token', error: 'invalid_grant' });
    expect(err.headers).toEqual(control.headers);
  });

  it('an authorization-code exchange for a banned user answers as an invalid code', async () => {
    const err = await refusalOf(refuseGrantForBannedUser({ grantType: 'authorization_code', user: user({ banned: true }) }, NOW));
    expect(err).toBeInstanceOf(APIError);
    expect(err.body).toEqual(providerInvalidGrant('invalid code').body);
  });

  it('any other grant that acts for a banned user is refused as an invalid grant too', async () => {
    const err = await refusalOf(
      refuseGrantForBannedUser({ grantType: 'urn:ietf:params:oauth:grant-type:device_code', user: user({ banned: true }) }, NOW),
    );
    expect(err).toBeInstanceOf(APIError);
    expect(err.statusCode).toBe(400);
    expect(err.body).toEqual({ error_description: 'invalid grant', error: 'invalid_grant' });
  });

  it('a ban with an expiry binds until it passes, in either spelling the row carries', async () => {
    const soon = new Date(NOW + 60_000);
    const lapsed = new Date(NOW - 60_000);
    for (const over of [{ banExpires: soon }, { ban_expires: soon.toISOString() }]) {
      const err = await refusalOf(refuseGrantForBannedUser({ grantType: 'refresh_token', user: user({ banned: true, ...over }) }, NOW));
      expect(err?.body?.error, JSON.stringify(over)).toBe('invalid_grant');
    }
    for (const over of [{ banExpires: lapsed }, { ban_expires: lapsed.toISOString() }]) {
      await expect(
        refuseGrantForBannedUser({ grantType: 'refresh_token', user: user({ banned: true, ...over }) }, NOW),
        JSON.stringify(over),
      ).resolves.toBeUndefined();
    }
  });

  it('control: a user who is not banned, or was unbanned, is granted as before', async () => {
    for (const row of [user(), user({ banned: false, banExpires: null }), user({ banned: null })]) {
      await expect(refuseGrantForBannedUser({ grantType: 'refresh_token', user: row }, NOW), JSON.stringify(row)).resolves.toBeUndefined();
      await expect(refuseGrantForBannedUser({ grantType: 'authorization_code', user: row }, NOW)).resolves.toBeUndefined();
    }
  });

  it('control: a grant with no user (client_credentials) is not touched', async () => {
    await expect(refuseGrantForBannedUser({ grantType: 'client_credentials', user: undefined }, NOW)).resolves.toBeUndefined();
    await expect(refuseGrantForBannedUser({ grantType: 'client_credentials', user: null }, NOW)).resolves.toBeUndefined();
  });
});
