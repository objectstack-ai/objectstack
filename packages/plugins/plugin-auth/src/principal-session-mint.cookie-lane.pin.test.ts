// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23772] The principal-session mint on the COOKIE lane: a browser (the print
 * service's headless one, local or remote) carrying the minted session
 * cookie and nothing else.
 *
 * better-auth's `get-session` renews any session past `updateAge` to
 * `now + expiresIn`; a minted session is past it from its first read, and the
 * cookie lane carries no dont-remember cookie (the mint hands out none). So
 * the read below WOULD turn a 120-second credential into a 7-day one — the
 * control proves it on a session minted the same way without the brand — and
 * the pin is that the minted one does not move, in the row or in the answer.
 * Revoke is pinned on the same lane: afterwards the cookie resolves nothing.
 *
 * Real better-auth, real request seam (`AuthManager.handleRequest`), the
 * `sys_session` row read straight off the engine's table.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { bootMintFixture, expiresAtMs, rawTokenOf, type MintFixture } from './principal-session-mint-test-support';
import { PRINCIPAL_SESSION_MAX_TTL_SECONDS } from '@objectstack/spec/contracts';

/** Clock slack between the server's `now` and this file's, in ms. */
const SLACK_MS = 5_000;

let fx: MintFixture;
let expiresInSec: number;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fx = await bootMintFixture(createMemoryEngine as any);
  expiresInSec = Number((await fx.manager.getAuthContext()).sessionConfig.expiresIn);
});

afterAll(() => vi.restoreAllMocks());

describe('[#23772] cookie lane — a minted session is never renewed', () => {
  it('control: a short session WITHOUT the brand is renewed to now + expiresIn by the same read', async () => {
    const ctx: any = await fx.manager.getAuthContext();
    const plain = await ctx.internalAdapter.createSession(
      fx.userId, false, { expiresAt: new Date(Date.now() + 120_000) }, true,
    );
    const { makeSignature } = await import('better-auth/crypto');
    const value = encodeURIComponent(`${plain.token}.${await makeSignature(plain.token, ctx.secret)}`);
    const before = expiresAtMs(fx.row(plain.token));

    const res = await fx.getSession({ cookie: `${ctx.authCookies.sessionToken.name}=${value}` });

    expect(res.status).toBe(200);
    expect(res.body?.user?.id, 'the control cookie did not authenticate').toBe(fx.userId);
    const after = expiresAtMs(fx.row(plain.token));
    expect(after - before, 'the fixture does not renew — the pin below would pass vacuously')
      .toBeGreaterThan((expiresInSec - 3600) * 1000);
  });

  it('the minted cookie authenticates as the user and its expiry does not move', async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human());
    const token = rawTokenOf(minted);
    const mintedAt = expiresAtMs(fx.row(token));
    expect(Math.abs(mintedAt - (Date.now() + PRINCIPAL_SESSION_MAX_TTL_SECONDS * 1000))).toBeLessThan(SLACK_MS);
    expect(new Date(minted.expiresAt).getTime()).toBe(mintedAt);

    for (let i = 0; i < 3; i++) {
      const res = await fx.getSession({ cookie: `${minted.cookie.name}=${minted.cookie.value}` });
      expect(res.status).toBe(200);
      expect(res.body?.user?.id, 'the minted cookie did not authenticate').toBe(fx.userId);
      expect(new Date(res.body.session.expiresAt).getTime(), 'get-session answered a renewed expiry').toBe(mintedAt);
      expect(expiresAtMs(fx.row(token)), `read ${i + 1} renewed the minted session row`).toBe(mintedAt);
    }
    await minted.revoke();
  });

  it('after revoke the cookie resolves no session, and a second revoke is a no-op', async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human());
    const cookie = `${minted.cookie.name}=${minted.cookie.value}`;
    expect((await fx.getSession({ cookie })).body?.user?.id).toBe(fx.userId);

    await minted.revoke();
    await minted.revoke();

    expect(fx.row(rawTokenOf(minted)), 'revoke left the session row').toBeUndefined();
    // The platform's answer for "no session" on this route (anonymous-session-refusal.ts).
    const res = await fx.getSession({ cookie });
    expect({ status: res.status, code: res.body?.error?.code }, 'a revoked cookie still resolved a session')
      .toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  });
});
