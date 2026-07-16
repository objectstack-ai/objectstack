// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0093 — membership lifecycle, end-to-end against a real stack.
 *
 * The original bug (#2882): user-creation paths outside better-auth's org
 * flows (`/admin/create-user`, sign-up) never wrote a `sys_member` row, so in
 * single-org mode those users didn't belong to the Default Organization.
 * ADR-0093 D2 gives the invariant ONE owner — a reconciler composed into
 * better-auth's `user.create.after` hook.
 *
 * Harness note: `bootStack` deliberately disables the default-org bootstrap
 * (`autoDefaultOrganization: false` — the ADR-0057 "single-tenant, no org row"
 * posture) and does not enable the better-auth admin plugin. So these tests
 * mint the single-org Default Organization themselves (system context, exactly
 * what the bootstrap would do) and drive the invariant through the REAL
 * better-auth sign-up pipeline — the path with no endpoint-side bind, where a
 * membership can only come from the `user.create.after` reconciler. The
 * endpoint-side create-user bind has its own unit coverage
 * (plugin-auth/src/admin-user-endpoints.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { backfillMemberships, reconcileMembership } from '@objectstack/plugin-auth';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('ADR-0093: membership lifecycle (single-org, real stack)', () => {
  let stack: VerifyStack;
  let ql: any;
  let defaultOrgId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {}); // single-org (no OS_MULTI_ORG_ENABLED)
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    // Mint the Default Organization the single-org bootstrap would create
    // (the harness disables that bootstrap — see header). System context is
    // the legitimate writer for better-auth-managed tables (ADR-0092).
    const org = await ql.insert(
      'sys_organization',
      { name: 'Default Organization', slug: 'default' },
      { context: SYSTEM_CTX },
    );
    defaultOrgId = String(org.id);
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('sign-up produces a membership through the user.create.after reconciler alone (D2, e2e)', async () => {
    // No endpoint bind exists on the sign-up path — a membership here can ONLY
    // come from the reconciler hook consulting tenancy.defaultOrgId().
    const token = await stack.signUp('reconciled.member@example.com', 'SignUp!Pass123', 'Reconciled Member');
    expect(token).toBeTruthy();
    const users = await findRows(ql, 'sys_user', { email: 'reconciled.member@example.com' }, 1);
    expect(users.length).toBe(1);
    const userId: string = users[0].id;

    // better-auth defers user.create.after past the signup transaction —
    // poll briefly before asserting.
    let members: any[] = [];
    for (let i = 0; i < 40 && members.length === 0; i++) {
      members = await findRows(ql, 'sys_member', { user_id: userId }, 5);
      if (members.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(members.length).toBe(1);
    expect(members[0].organization_id).toBe(defaultOrgId);
    expect(members[0].role).toBe('member');
  }, 30_000);

  it('backfill binds a pre-existing member-less user and is idempotent (D6)', async () => {
    // A user created OUTSIDE the better-auth pipeline (system-context insert —
    // e.g. rows that predate the reconciler).
    const orphan = await ql.insert(
      'sys_user',
      { name: 'Orphan User', email: 'orphan.user@example.com' },
      { context: SYSTEM_CTX },
    );
    expect(orphan?.id).toBeTruthy();
    expect((await findRows(ql, 'sys_member', { user_id: orphan.id })).length).toBe(0);

    const resolveTargetOrg = async () => defaultOrgId;
    const first = await backfillMemberships(ql, { policy: 'auto', resolveTargetOrg });
    expect(first.bound).toBeGreaterThanOrEqual(1); // orphan (+ any other member-less user, e.g. the dev admin)
    const members = await findRows(ql, 'sys_member', { user_id: orphan.id });
    expect(members.length).toBe(1);
    expect(members[0].organization_id).toBe(defaultOrgId);
    expect(members[0].role).toBe('member');

    // Idempotent: a second run binds nothing new.
    const second = await backfillMemberships(ql, { policy: 'auto', resolveTargetOrg });
    expect(second.bound).toBe(0);
    expect((await findRows(ql, 'sys_member', { user_id: orphan.id })).length).toBe(1);
  }, 30_000);

  it('invite-only policy never auto-binds, on the real engine (D1)', async () => {
    const loner = await ql.insert(
      'sys_user',
      { name: 'Invite Only', email: 'invite.only@example.com' },
      { context: SYSTEM_CTX },
    );

    const res = await reconcileMembership(ql, loner.id, {
      policy: 'invite-only',
      resolveTargetOrg: async () => defaultOrgId,
    });
    expect(res.outcome).toBe('policy-skip');
    expect((await findRows(ql, 'sys_member', { user_id: loner.id })).length).toBe(0);

    // Backfill refuses under invite-only too.
    const bf = await backfillMemberships(ql, {
      policy: 'invite-only',
      resolveTargetOrg: async () => defaultOrgId,
    });
    expect(bf.reason).toBe('policy');
    expect((await findRows(ql, 'sys_member', { user_id: loner.id })).length).toBe(0);
  }, 30_000);

  it('reconciler yields to an existing membership instead of double-binding (D2 yield rule)', async () => {
    // Simulate a host hook having bound the user to some OTHER org first —
    // the reconciler must respect it and never add a second membership.
    const hosted = await ql.insert(
      'sys_user',
      { name: 'Host Bound', email: 'host.bound@example.com' },
      { context: SYSTEM_CTX },
    );
    const otherOrg = await ql.insert(
      'sys_organization',
      { name: 'Host Org', slug: 'host-org' },
      { context: SYSTEM_CTX },
    );
    await ql.insert(
      'sys_member',
      { organization_id: String(otherOrg.id), user_id: hosted.id, role: 'owner' },
      { context: SYSTEM_CTX },
    );

    const res = await reconcileMembership(ql, hosted.id, {
      policy: 'auto',
      resolveTargetOrg: async () => defaultOrgId,
    });
    expect(res.outcome).toBe('yielded');
    const members = await findRows(ql, 'sys_member', { user_id: hosted.id });
    expect(members.length).toBe(1);
    expect(members[0].organization_id).toBe(String(otherOrg.id)); // host's bind won
  }, 30_000);
});
