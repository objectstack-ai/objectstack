// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23772] The principal-session mint on the BEARER lane: a client sending
 * the minted token as `Authorization: Bearer`, over HTTP and through the
 * in-process session read every transport makes for a bearer-only request
 * (`inProcessSessionReadInput`, `@objectstack/types`, which reads WITH
 * renewal on that lane).
 *
 * This is the lane a client-side defence cannot reach: better-auth's
 * `bearer()` turns the token into the session cookie and no dont-remember
 * cookie rides along, so `get-session` renews a short session to
 * `now + expiresIn` on its first read — the control proves it on a session
 * minted the same way without the brand. The pin is that the minted one does
 * not move on either reader, and that after revoke the token resolves nothing.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { inProcessSessionReadInput } from '@objectstack/types';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { bootMintFixture, expiresAtMs, rawTokenOf, type MintFixture } from './principal-session-mint-test-support';

let fx: MintFixture;
let expiresInSec: number;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fx = await bootMintFixture(createMemoryEngine as any);
  expiresInSec = Number((await fx.manager.getAuthContext()).sessionConfig.expiresIn);
});

afterAll(() => vi.restoreAllMocks());

const inProcessRead = async (token: string) => {
  const api: any = await fx.manager.getApi();
  return api.getSession(inProcessSessionReadInput(new Headers({ authorization: `Bearer ${token}` })));
};

describe('[#23772] bearer lane — a minted session is never renewed', () => {
  it('control: a short session WITHOUT the brand is renewed by a bearer get-session', async () => {
    const ctx: any = await fx.manager.getAuthContext();
    const plain = await ctx.internalAdapter.createSession(
      fx.userId, false, { expiresAt: new Date(Date.now() + 120_000) }, true,
    );
    const before = expiresAtMs(fx.row(plain.token));

    const res = await fx.getSession({ authorization: `Bearer ${plain.token}` });

    expect(res.body?.user?.id, 'the control bearer did not authenticate').toBe(fx.userId);
    expect(expiresAtMs(fx.row(plain.token)) - before, 'the fixture does not renew — the pins below would pass vacuously')
      .toBeGreaterThan((expiresInSec - 3600) * 1000);
  });

  it('over HTTP: the minted token authenticates as the user and its expiry does not move', async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human());
    const token = rawTokenOf(minted);
    const mintedAt = expiresAtMs(fx.row(token));

    for (let i = 0; i < 3; i++) {
      const res = await fx.getSession({ authorization: `Bearer ${minted.token}` });
      expect(res.status).toBe(200);
      expect(res.body?.user?.id, 'the minted bearer did not authenticate').toBe(fx.userId);
      expect(new Date(res.body.session.expiresAt).getTime(), 'get-session answered a renewed expiry').toBe(mintedAt);
      expect(expiresAtMs(fx.row(token)), `read ${i + 1} renewed the minted session row`).toBe(mintedAt);
    }
    await minted.revoke();
  });

  it('in-process (the bearer-only read that renews): the expiry does not move', async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human());
    const token = rawTokenOf(minted);
    const mintedAt = expiresAtMs(fx.row(token));

    const read = await inProcessRead(minted.token);

    expect(read?.user?.id, 'the in-process bearer read did not resolve the user').toBe(fx.userId);
    expect(expiresAtMs(fx.row(token)), 'the in-process read renewed the minted session row').toBe(mintedAt);
    await minted.revoke();
  });

  it('after revoke the token resolves no session, over HTTP and in-process', async () => {
    const minted = await fx.manager.mintPrincipalSession(fx.human());
    expect((await fx.getSession({ authorization: `Bearer ${minted.token}` })).body?.user?.id).toBe(fx.userId);

    await minted.revoke();

    expect(fx.row(rawTokenOf(minted)), 'revoke left the session row').toBeUndefined();
    expect((await fx.getSession({ authorization: `Bearer ${minted.token}` })).body).toBeNull();
    expect(await inProcessRead(minted.token)).toBeNull();
  });
});
