// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  reconcileMembership,
  backfillMemberships,
  MEMBERSHIP_POLICIES,
  type MembershipPolicy,
} from './reconcile-membership.js';
import { runAttributedToUser } from './auth-actor-attribution.js';

/**
 * Off-vocabulary policy values, as a JS caller or a host stack could pass them
 * past the `MembershipPolicy` type. `reconcileMembership` and
 * `backfillMemberships` are public exports of `@objectstack/plugin-auth`, so
 * the cast is the test reproducing a real call, not defeating the type system
 * for convenience.
 */
const asPolicy = (value: unknown) => value as MembershipPolicy;

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
 * [#5205] The two entry points read the SAME policy field and used to judge it
 * with opposite predicates: `reconcileMembership` tested `=== 'invite-only'`
 * (so anything else, including a typo, fell through to the `auto` branch and
 * bound — fail-open), `backfillMemberships` tested `!== 'auto'` (refused —
 * fail-safe). The dangerous half was the sign-up path: a caller who believed
 * they had turned auto-binding off got it anyway, silently.
 *
 * These pin the fixed contract: one input, one direction (nothing bound), and
 * a verdict that says *why* — `'invalid-policy'`, not a `policy-skip` /
 * `'policy'` that would send a reader to inspect a setting that is fine.
 */
describe('reconcileMembership / backfillMemberships — off-vocabulary policy (#5205)', () => {
  const INVALID: Array<[label: string, value: unknown]> = [
    ['camelCase typo', 'inviteOnly'],
    ['snake_case typo', 'invite_only'],
    ['wrong case', 'Auto'],
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['boolean', false],
    ['object', { policy: 'invite-only' }],
  ];

  describe.each(INVALID)('policy = %s', (_label, value) => {
    it('reconcileMembership refuses — invalid-policy, nothing bound', async () => {
      const engine = makeEngine();
      const resolveTargetOrg = vi.fn(async () => 'org_default');
      const res = await reconcileMembership(engine, 'user-1', {
        policy: asPolicy(value),
        resolveTargetOrg,
      });
      expect(res.outcome).toBe('invalid-policy');
      // The whole bug: this used to be `bound`.
      expect(engine.insert).not.toHaveBeenCalled();
      expect(engine._members).toHaveLength(0);
      // Refused at the entry — no org was even resolved.
      expect(resolveTargetOrg).not.toHaveBeenCalled();
    });

    it('backfillMemberships refuses — invalid-policy, nothing bound', async () => {
      const engine = makeEngine({ users: [{ id: 'u1' }, { id: 'u2' }] });
      const resolveTargetOrg = vi.fn(async () => 'org_default');
      const res = await backfillMemberships(engine, {
        policy: asPolicy(value),
        resolveTargetOrg,
      });
      expect(res.reason).toBe('invalid-policy');
      expect(res.bound).toBe(0);
      expect(engine.insert).not.toHaveBeenCalled();
      expect(resolveTargetOrg).not.toHaveBeenCalled();
    });

    it('both paths agree: same input, same direction, neither binds', async () => {
      const signupEngine = makeEngine();
      const backfillEngine = makeEngine({ users: [{ id: 'u1' }] });
      const deps = { policy: asPolicy(value), resolveTargetOrg: async () => 'org_default' };

      const signup = await reconcileMembership(signupEngine, 'user-1', deps);
      const backfill = await backfillMemberships(backfillEngine, deps);

      expect(signupEngine._members).toHaveLength(0);
      expect(backfillEngine._members).toHaveLength(0);
      // …and both name the same cause, so a reader of either one lands on the
      // caller's policy value rather than on the deployment's setting.
      expect(signup.outcome).toBe('invalid-policy');
      expect(backfill.reason).toBe('invalid-policy');
      expect(signup.outcome).not.toBe('policy-skip');
      expect(backfill.reason).not.toBe('policy');
    });
  });

  it('names the offending value so it is not swallowed — logged and returned', async () => {
    const error = vi.fn();
    const res = await reconcileMembership(makeEngine(), 'user-1', {
      policy: asPolicy('inviteOnly'),
      resolveTargetOrg: async () => 'org_default',
      logger: { error, warn: vi.fn() },
    });
    // Returned, so the diagnosis survives a caller that passed no logger.
    expect(res.error).toContain(`'inviteOnly'`);
    expect(res.error).toContain('invite-only'); // the expected vocabulary
    expect(error).toHaveBeenCalledTimes(1);
    const [msg, meta] = error.mock.calls[0];
    expect(msg).toContain(`'inviteOnly'`);
    expect(meta).toMatchObject({ userId: 'user-1', expected: MEMBERSHIP_POLICIES });
  });

  it('logs at error, not warn — nothing else looks broken afterwards', async () => {
    const error = vi.fn();
    const warn = vi.fn();
    await backfillMemberships(makeEngine({ users: [{ id: 'u1' }] }), {
      policy: asPolicy('inviteOnly'),
      resolveTargetOrg: async () => 'org_default',
      logger: { error, warn },
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still reaches a logger that only has warn', async () => {
    const warn = vi.fn();
    await reconcileMembership(makeEngine(), 'user-1', {
      policy: asPolicy('inviteOnly'),
      resolveTargetOrg: async () => 'org_default',
      logger: { warn },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`'inviteOnly'`);
  });

  it('refuses without a logger at all (the refusal is not a logging side effect)', async () => {
    const engine = makeEngine();
    const res = await reconcileMembership(engine, 'user-1', {
      policy: asPolicy('inviteOnly'),
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.outcome).toBe('invalid-policy');
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('does not echo a non-string value into the log — typeof only', async () => {
    const error = vi.fn();
    const res = await reconcileMembership(makeEngine(), 'user-1', {
      // A caller that passed the whole config object by mistake; it may carry
      // fields that have no business in a log line.
      policy: asPolicy({ membershipPolicy: 'invite-only', adminEmail: 'ops@example.com' }),
      resolveTargetOrg: async () => 'org_default',
      logger: { error, warn: vi.fn() },
    });
    expect(res.outcome).toBe('invalid-policy');
    expect(res.error).toContain('[object]');
    expect(error.mock.calls[0][0]).not.toContain('ops@example.com');
    expect(JSON.stringify(error.mock.calls[0][1])).not.toContain('ops@example.com');
  });

  it('bounds a long string value', async () => {
    const error = vi.fn();
    const res = await reconcileMembership(makeEngine(), 'user-1', {
      policy: asPolicy('x'.repeat(500)),
      resolveTargetOrg: async () => 'org_default',
      logger: { error, warn: vi.fn() },
    });
    expect(res.error).toContain('(truncated)');
    expect(res.error!.length).toBeLessThan(200);
  });

  it('preconditions still win — a missing engine reports skipped, not invalid-policy', async () => {
    const res = await reconcileMembership(undefined, 'user-1', {
      policy: asPolicy('inviteOnly'),
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.outcome).toBe('skipped');
    const bf = await backfillMemberships(undefined, {
      policy: asPolicy('inviteOnly'),
      resolveTargetOrg: async () => 'org_default',
    });
    expect(bf.reason).toBe('engine-unavailable');
  });
});

/**
 * [#5205] The guard must not move the ground under the two values that ARE
 * policies. Asserted as a table over the declared vocabulary, so the behaviour
 * of every legal value is stated here rather than inferred from a green suite.
 */
describe('legal policies are unaffected by the invalid-policy guard (#5205)', () => {
  const EXPECTED: Record<MembershipPolicy, { signup: string; backfillReason?: string; binds: boolean }> = {
    auto: { signup: 'bound', backfillReason: undefined, binds: true },
    'invite-only': { signup: 'policy-skip', backfillReason: 'policy', binds: false },
  };

  it('covers the whole declared vocabulary', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...MEMBERSHIP_POLICIES].sort());
  });

  it.each([...MEMBERSHIP_POLICIES])('reconcileMembership(%s) is unchanged', async (policy) => {
    const engine = makeEngine();
    const res = await reconcileMembership(engine, 'user-1', {
      policy,
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.outcome).toBe(EXPECTED[policy].signup);
    expect(res.error).toBeUndefined();
    expect(engine._members).toHaveLength(EXPECTED[policy].binds ? 1 : 0);
  });

  it.each([...MEMBERSHIP_POLICIES])('backfillMemberships(%s) is unchanged', async (policy) => {
    const engine = makeEngine({ users: [{ id: 'u1' }] });
    const res = await backfillMemberships(engine, {
      policy,
      resolveTargetOrg: async () => 'org_default',
    });
    expect(res.reason).toBe(EXPECTED[policy].backfillReason);
    expect(res.error).toBeUndefined();
    expect(res.bound).toBe(EXPECTED[policy].binds ? 1 : 0);
    expect(engine._members).toHaveLength(EXPECTED[policy].binds ? 1 : 0);
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
