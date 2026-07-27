// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D8 / #3697] The scope-bounded issuance path gets a caller — proven
 * over the real HTTP route, not against a hook in isolation.
 *
 * The gap: D8 authorizes invitation *placement* against the issuer's
 * `adminScope` (ADR-0090 D12), but nobody could reach that gate in a state
 * where it narrowed anything. better-auth grants `invitation: ["create"]` to
 * `owner`/`admin` only, and under a wall-enforcing posture those two are
 * auto-elevated to tenant admins — for whom the gate short-circuits. The
 * `delegated_admin` org role is the missing principal.
 *
 * Registering it alone would have been a four-step privilege escalation:
 * better-auth's `creatorRole` guard (default `owner`) blocks inviting an
 * **owner** but not an **admin**, and an accepted `admin` membership is
 * auto-elevated to `organization_admin` → wildcard `modifyAllRecords` →
 * `isTenantAdmin()`. So the role ships with a role cap in the framework's own
 * `beforeCreateInvitation` hook, and this file pins BOTH halves end to end:
 *
 *  1. a `delegated_admin` may actually issue an invitation (the role reaches
 *     the endpoint — the unit tests can only prove the roles map was built);
 *  2. the same principal issuing `role: "admin"` is refused, with no
 *     invitation row left behind;
 *  3. a plain `member` still cannot invite at all — so it is the ROLE that
 *     opened the endpoint, not some unrelated loosening.
 *
 * Harness note: `bootStack` disables the default-org bootstrap, so this file
 * mints the Default Organization itself (system context — exactly what the
 * bootstrap would do) and sets membership roles the same way, which is the
 * only writer better-auth-managed tables accept (ADR-0092).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The membership row the sign-up reconciler writes lands asynchronously
 *  (better-auth defers `user.create.after` past the signup transaction). */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

describe('#3697: delegated_admin may invite — as `member` only', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  let adminToken: string;
  let delegateToken: string;
  let plainMemberToken: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    adminToken = await stack.signIn(); // the seeded dev admin
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert(
      'sys_organization',
      { name: 'Default Organization', slug: 'default' },
      { context: SYSTEM_CTX },
    );
    orgId = String(org.id);

    // The dev admin predates the org row, so give them the owner membership the
    // single-org bootstrap would have. They are who PROVISIONS a delegate, and
    // the reference for "an org owner's behavior is unchanged by any of this".
    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUser.id }, 5);
    if (adminMembers.length > 0) {
      await ql.update(
        'sys_member',
        { id: adminMembers[0].id, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    } else {
      await ql.insert(
        'sys_member',
        { user_id: adminUser.id, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    }

    // The delegate: an ordinary user promoted to the delegated issuer grade.
    // Deliberately NOT owner/admin — that is the whole point of the role.
    delegateToken = await stack.signUp('delegate.3697@example.com', 'Delegate!Pass123', 'Delegate 3697');
    const [delegateUser] = await findRows(ql, 'sys_user', { email: 'delegate.3697@example.com' }, 1);
    const delegateMember = await waitForMembership(ql, String(delegateUser.id));
    expect(delegateMember.role).toBe('member'); // the reconciler's default
    await ql.update(
      'sys_member',
      { id: delegateMember.id, role: 'delegated_admin' },
      { context: SYSTEM_CTX },
    );

    // The control: an ordinary member, left alone.
    plainMemberToken = await stack.signUp('plain.3697@example.com', 'Plain!Pass123', 'Plain 3697');
    const [plainUser] = await findRows(ql, 'sys_user', { email: 'plain.3697@example.com' }, 1);
    await waitForMembership(ql, String(plainUser.id));
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('a delegated_admin CAN issue an invitation — the gate finally has a caller', async () => {
    const res = await stack.apiAs(delegateToken, 'POST', '/auth/organization/invite-member', {
      email: 'invitee.member.3697@example.com',
      role: 'member',
      organizationId: orgId,
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const rows = await findRows(ql, 'sys_invitation', { email: 'invitee.member.3697@example.com' }, 5);
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe('member');
  }, 30_000);

  it('the same delegate issuing `admin` is REFUSED, with no invitation row left behind', async () => {
    // The escalation chain in one request: were this to succeed, acceptance
    // would write sys_member(role='admin') and auto-org-admin-grant would turn
    // a subtree-scoped delegate's invitee into a tenant admin.
    const res = await stack.apiAs(delegateToken, 'POST', '/auth/organization/invite-member', {
      email: 'invitee.admin.3697@example.com',
      role: 'admin',
      organizationId: orgId,
    });

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/never confer a role above the issuer/);
    // Rejecting throws out of the endpoint BEFORE the row is written.
    expect(
      (await findRows(ql, 'sys_invitation', { email: 'invitee.admin.3697@example.com' }, 5)).length,
    ).toBe(0);
  }, 30_000);

  it('an org owner CAN invite someone AS a delegated_admin — the provisioning flow', async () => {
    // How a delegate comes to exist in the first place. Both `sys_invitation.role`
    // and `sys_member.role` are enforced selects, so this is also the proof that
    // the new role is storable on the invitation as well as the membership — a
    // role missing from either list is a role that cannot be handed out.
    const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/invite-member', {
      email: 'invitee.delegate.3697@example.com',
      role: 'delegated_admin',
      organizationId: orgId,
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const rows = await findRows(ql, 'sys_invitation', { email: 'invitee.delegate.3697@example.com' }, 5);
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe('delegated_admin');
  }, 30_000);

  it('a plain member still cannot invite at all — the ROLE is what opened the endpoint', async () => {
    const res = await stack.apiAs(plainMemberToken, 'POST', '/auth/organization/invite-member', {
      email: 'invitee.frommember.3697@example.com',
      role: 'member',
      organizationId: orgId,
    });

    expect(res.status).toBe(403);
    expect(
      (await findRows(ql, 'sys_invitation', { email: 'invitee.frommember.3697@example.com' }, 5))
        .length,
    ).toBe(0);
  }, 30_000);
});
