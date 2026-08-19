// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9652 — ban / unban as ObjectStack raw mounts with the ADR-0068 gate.
 *
 * ⛔ NOTE FOR THE NEXT AUTHOR: nothing in this file patches `role = 'admin'`
 * onto a user row. The pre-existing hand-patch in `remove-user-atomicity.test.ts`
 * exists precisely because the better-auth admin plugin authorizes on that
 * legacy scalar; these handlers do not, so the workaround is not needed and
 * must not be reintroduced (re-synthesizing the scalar is permanently vetoed,
 * maintainer ruling 2026-08-18).
 *
 * Rejection cases assert `code` AND `status` per ADR-0112 — a bare "it threw"
 * would pass against a handler that refuses everyone.
 */

import { describe, it, expect } from 'vitest';
import { runAdminBanUser, runAdminUnbanUser, type AuthBanContextLike } from './admin-ban-endpoints.js';
import { judgePlatformAdmin, isPlatformAdminUser } from './platform-admin-gate.js';
import { isLastLocalCredentialHolder } from './last-local-credential.js';

const ADMIN = { id: 'usr_admin', email: 'admin@example.com' };

interface Recorded {
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  sessionsDeletedFor: string[];
}

/**
 * A fake `$context` slice. `credentialHolders` drives the break-glass guard:
 * the ids that hold a local password account.
 */
function fakeContext(opts: {
  users?: string[];
  credentialHolders?: string[];
}): { ctx: AuthBanContextLike; rec: Recorded } {
  const users = new Set(opts.users ?? ['usr_target']);
  const holders = opts.credentialHolders ?? [];
  const rec: Recorded = { updates: [], sessionsDeletedFor: [] };

  const ctx: AuthBanContextLike = {
    internalAdapter: {
      findUserById: async (id) => (users.has(id) ? { id } : null),
      updateUser: async (id, data) => {
        rec.updates.push({ id, data });
        return { id, ...data };
      },
      deleteUserSessions: async (userId) => {
        rec.sessionsDeletedFor.push(userId);
        return true;
      },
    },
    adapter: {
      findOne: async ({ where }) => {
        const userId = where.find((w) => w.field === 'userId')?.value;
        return userId && holders.includes(userId) ? { userId } : null;
      },
      findMany: async () => holders.map((userId) => ({ userId })),
    },
  };
  return { ctx, rec };
}

const post = (body: unknown): Request =>
  new Request('http://local/api/v1/auth/admin/ban-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const depsFor = (ctx: AuthBanContextLike) => ({ getAuthContext: async () => ctx });

describe('#9652 runAdminBanUser', () => {
  it('bans the target and revokes its sessions, mirroring the vendor write', async () => {
    const { ctx, rec } = fakeContext({ credentialHolders: ['usr_target', 'usr_admin'] });

    const res = await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target', banReason: 'abuse' }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].id).toBe('usr_target');
    expect(rec.updates[0].data.banned).toBe(true);
    expect(rec.updates[0].data.banReason).toBe('abuse');
    // Without this the banned user keeps a live session until it expires.
    expect(rec.sessionsDeletedFor).toEqual(['usr_target']);
  });

  it("defaults the reason to the vendor's 'No reason'", async () => {
    const { ctx, rec } = fakeContext({ credentialHolders: ['usr_target', 'usr_admin'] });
    await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target' }));
    expect(rec.updates[0].data.banReason).toBe('No reason');
    expect(rec.updates[0].data.banExpires).toBeUndefined();
  });

  it('converts banExpiresIn seconds into an expiry date', async () => {
    const { ctx, rec } = fakeContext({ credentialHolders: ['usr_target', 'usr_admin'] });
    const before = Date.now();
    await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target', banExpiresIn: 3600 }));
    const expires = rec.updates[0].data.banExpires as Date;
    expect(expires).toBeInstanceOf(Date);
    expect(expires.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
  });

  it('refuses a missing userId with INVALID_REQUEST 400', async () => {
    const { ctx, rec } = fakeContext({});
    const res = await runAdminBanUser(depsFor(ctx), ADMIN, post({}));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(rec.updates).toHaveLength(0);
  });

  it('refuses an unknown user with RESOURCE_NOT_FOUND 404', async () => {
    const { ctx, rec } = fakeContext({ users: ['usr_target'] });
    const res = await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_ghost' }));
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('RESOURCE_NOT_FOUND');
    expect(rec.updates).toHaveLength(0);
  });

  it('refuses self-ban with INVALID_REQUEST 400', async () => {
    const { ctx, rec } = fakeContext({ users: ['usr_admin'] });
    const res = await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_admin' }));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(rec.updates).toHaveLength(0);
  });

  it('keeps the break-glass guard the shadowed vendor route used to inherit', async () => {
    // The target is the ONLY holder of a local password: banning it would sign
    // the last break-glass account out of a deployment under enforced SSO.
    const { ctx, rec } = fakeContext({ credentialHolders: ['usr_target'] });
    const res = await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target' }));
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('LAST_LOCAL_CREDENTIAL');
    expect(rec.updates).toHaveLength(0);
    expect(rec.sessionsDeletedFor).toEqual([]);
  });

  it('permits banning a credential-less (managed) user even when it is alone', async () => {
    const { ctx, rec } = fakeContext({ credentialHolders: [] });
    const res = await runAdminBanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target' }));
    expect(res.status).toBe(200);
    expect(rec.updates).toHaveLength(1);
  });
});

describe('#9652 runAdminUnbanUser', () => {
  it('clears every ban field the vendor handler clears', async () => {
    const { ctx, rec } = fakeContext({});
    const res = await runAdminUnbanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target' }));
    expect(res.status).toBe(200);
    expect(rec.updates[0].data).toMatchObject({ banned: false, banReason: null, banExpires: null });
  });

  it('refuses an unknown user with RESOURCE_NOT_FOUND 404', async () => {
    const { ctx } = fakeContext({ users: ['usr_target'] });
    const res = await runAdminUnbanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_ghost' }));
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('does NOT apply the break-glass guard — lifting a ban cannot cause lockout', async () => {
    const { ctx, rec } = fakeContext({ credentialHolders: ['usr_target'] });
    const res = await runAdminUnbanUser(depsFor(ctx), ADMIN, post({ userId: 'usr_target' }));
    expect(res.status).toBe(200);
    expect(rec.updates).toHaveLength(1);
  });
});

describe('#9652 the shared ADR-0068 platform-admin gate', () => {
  it('admits a platform admin carrying positions[] and NO role scalar', () => {
    // This is the identity a real deployment produces after ADR-0068 D2 — the
    // exact shape better-auth refuses.
    const verdict = judgePlatformAdmin({
      user: { id: 'usr_admin', email: 'a@b.c', positions: ['user', 'platform_admin'], role: 'user' },
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.actor.id).toBe('usr_admin');
  });

  it('admits on the derived isPlatformAdmin alias alone', () => {
    expect(judgePlatformAdmin({ user: { id: 'u', isPlatformAdmin: true } }).ok).toBe(true);
  });

  it('refuses an anonymous caller 401 UNAUTHENTICATED', () => {
    const verdict = judgePlatformAdmin(null);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.refusal.status).toBe(401);
    expect(!verdict.ok && verdict.refusal.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a signed-in plain member 403 PERMISSION_DENIED', () => {
    const verdict = judgePlatformAdmin({ user: { id: 'usr_member', positions: ['user'], role: 'user' } });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.refusal.status).toBe(403);
    expect(!verdict.ok && verdict.refusal.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('an org admin is NOT a platform admin', () => {
    expect(isPlatformAdminUser({ id: 'u', positions: ['user', 'org_admin', 'org_owner'] })).toBe(false);
  });

  it('still reads a pre-ADR-0068 role scalar as the legacy fallback', () => {
    expect(isPlatformAdminUser({ id: 'u', role: 'admin' })).toBe(true);
  });
});

describe('#9652 isLastLocalCredentialHolder', () => {
  const adapterFor = (holders: string[]) => ({
    findOne: async ({ where }: { where: Array<{ field: string; value: string }> }) => {
      const userId = where.find((w) => w.field === 'userId')?.value;
      return userId && holders.includes(userId) ? { userId } : null;
    },
    findMany: async () => holders.map((userId) => ({ userId })),
  });

  it('is true only for the sole credential holder', async () => {
    expect(await isLastLocalCredentialHolder(adapterFor(['a']), 'a')).toBe(true);
    expect(await isLastLocalCredentialHolder(adapterFor(['a', 'b']), 'a')).toBe(false);
  });

  it('is false for a user holding no credential account', async () => {
    expect(await isLastLocalCredentialHolder(adapterFor(['a']), 'b')).toBe(false);
  });

  it('fails OPEN on a lookup error — a transient failure must not block an admin', async () => {
    const broken = {
      findOne: async () => {
        throw new Error('db down');
      },
      findMany: async () => [],
    };
    expect(await isLastLocalCredentialHolder(broken, 'a')).toBe(false);
  });
});
