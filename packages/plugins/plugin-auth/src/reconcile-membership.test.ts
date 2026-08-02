// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { reconcileMembership, backfillMemberships } from './reconcile-membership.js';
import { runAttributedToUser } from './auth-actor-attribution.js';

/**
 * In-memory engine over sys_member (+ optional sys_user) with the find/insert
 * surface the reconciler uses. `find` honors `user_id` / `organization_id`
 * filters; `insert` appends.
 */
function makeEngine(seed: {
  members?: Array<{ organization_id: string; user_id: string }>;
  users?: Array<{ id: string }>;
} = {}) {
  const members = [...(seed.members ?? [])];
  const users = [...(seed.users ?? [])];
  const insert = vi.fn(async (_object: string, row: any) => {
    members.push({ organization_id: row.organization_id, user_id: row.user_id });
    return row;
  });
  const find = vi.fn(async (object: string, query: any) => {
    const where = query?.where ?? {};
    if (object === 'sys_member') {
      return members.filter(
        (m) =>
          (where.user_id === undefined || m.user_id === where.user_id) &&
          (where.organization_id === undefined || m.organization_id === where.organization_id),
      );
    }
    if (object === 'sys_user') return users;
    return [];
  });
  return { find, insert, _members: members };
}

describe('reconcileMembership', () => {
  it('binds a member-less user to the resolved target org (auto)', async () => {
    const engine = makeEngine();
    const res = await reconcileMembership(engine, 'user-1', {
      policy: 'auto',
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res).toEqual({ outcome: 'bound', organizationId: 'org_default' });
    const memberInsert = engine.insert.mock.calls[0];
    expect(memberInsert[0]).toBe('sys_member');
    expect(memberInsert[1]).toMatchObject({
      organization_id: 'org_default',
      user_id: 'user-1',
      role: 'member',
    });
  });

  it('yields to an existing membership (host hook already bound the user)', async () => {
    const engine = makeEngine({ members: [{ organization_id: 'org_personal', user_id: 'user-1' }] });
    const res = await reconcileMembership(engine, 'user-1', {
      policy: 'auto',
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.outcome).toBe('yielded');
    expect(res.organizationId).toBe('org_personal');
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('invite-only policy never auto-binds', async () => {
    const engine = makeEngine();
    const resolveTargetOrg = vi.fn(async () => 'org_default');
    const res = await reconcileMembership(engine, 'user-1', { policy: 'invite-only', resolveTargetOrg });
    expect(res.outcome).toBe('policy-skip');
    expect(resolveTargetOrg).not.toHaveBeenCalled();
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('no target org (multi mode) → no bind', async () => {
    const engine = makeEngine();
    const res = await reconcileMembership(engine, 'user-1', {
      policy: 'auto',
      resolveTargetOrg: async () => null,
    });
    expect(res.outcome).toBe('no-target-org');
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('skips when userId or engine is missing', async () => {
    expect((await reconcileMembership(makeEngine(), undefined, { policy: 'auto', resolveTargetOrg: async () => 'o' })).outcome).toBe('skipped');
    expect((await reconcileMembership(undefined, 'user-1', { policy: 'auto', resolveTargetOrg: async () => 'o' })).outcome).toBe('skipped');
  });

  it('never throws — an insert failure resolves to failed', async () => {
    const engine = makeEngine();
    engine.insert.mockRejectedValueOnce(new Error('unique violation'));
    const warn = vi.fn();
    const res = await reconcileMembership(engine, 'user-1', {
      policy: 'auto',
      resolveTargetOrg: async () => 'org_default',
      logger: { warn },
    });
    expect(res.outcome).toBe('failed');
    expect(warn).toHaveBeenCalled();
  });

  it('is idempotent: re-running after a bind yields', async () => {
    const engine = makeEngine();
    const deps = { policy: 'auto' as const, resolveTargetOrg: async () => 'org_default' };
    const first = await reconcileMembership(engine, 'user-1', deps);
    expect(first.outcome).toBe('bound');
    const second = await reconcileMembership(engine, 'user-1', deps);
    expect(second.outcome).toBe('yielded');
    expect(engine.insert).toHaveBeenCalledTimes(1);
  });
});

describe('backfillMemberships', () => {
  it('binds only the member-less users (single/auto)', async () => {
    const engine = makeEngine({
      users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
      members: [{ organization_id: 'org_default', user_id: 'u2' }],
    });
    const res = await backfillMemberships(engine, {
      policy: 'auto',
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res).toMatchObject({ scanned: 3, bound: 2, skipped: 1 });
    // u1 and u3 got bound; u2 was already a member
    const boundUsers = engine.insert.mock.calls.map((c) => c[1].user_id).sort();
    expect(boundUsers).toEqual(['u1', 'u3']);
  });

  it('refuses under invite-only policy', async () => {
    const engine = makeEngine({ users: [{ id: 'u1' }] });
    const res = await backfillMemberships(engine, {
      policy: 'invite-only',
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.reason).toBe('policy');
    expect(res.bound).toBe(0);
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('refuses when there is no target org (multi mode)', async () => {
    const engine = makeEngine({ users: [{ id: 'u1' }] });
    const res = await backfillMemberships(engine, {
      policy: 'auto',
      resolveTargetOrg: async () => null,
    });
    expect(res.reason).toBe('no-target-org');
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('isolates a per-user insert failure and keeps going', async () => {
    const engine = makeEngine({ users: [{ id: 'u1' }, { id: 'u2' }] });
    engine.insert.mockRejectedValueOnce(new Error('boom')); // u1 fails
    const res = await backfillMemberships(engine, {
      policy: 'auto',
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.scanned).toBe(2);
    expect(res.bound).toBe(1); // u2 still bound
    expect(res.skipped).toBe(1);
  });
});

/**
 * [#4586] The reconciler bind is the third `sys_member` writer (after the
 * better-auth adapter and the invite-accept path), and it runs INSIDE
 * better-auth's `user.create.after` — so when the creation was an admin
 * action, the acting human is in scope and the membership row should name them.
 */
describe('reconcileMembership — actor attribution (#4586)', () => {
  it('credits the acting admin when a request scope names one', async () => {
    const engine = makeEngine();
    await runAttributedToUser('usr_admin', () =>
      reconcileMembership(engine, 'user-1', {
        policy: 'auto',
        resolveTargetOrg: async () => 'org_default',
      }),
    );
    const [, , options] = engine.insert.mock.calls[0];
    // Both halves, side by side and separate: system AUTHORIZES the write to a
    // better-auth-managed table, the admin is merely CREDITED for it.
    expect(options).toEqual({ context: { isSystem: true, attributedUserId: 'usr_admin' } });
  });

  it('a self sign-up has no actor — the bind records as the system', async () => {
    // Nobody else acted, and there is no session on the sign-up request. ADR-0118
    // D1: that is `null`, not a fabricated caller.
    const engine = makeEngine();
    await reconcileMembership(engine, 'user-2', {
      policy: 'auto',
      resolveTargetOrg: async () => 'org_default',
    });
    const [, , options] = engine.insert.mock.calls[0];
    expect(options).toEqual({ context: { isSystem: true } });
  });
});
