// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Create User can join the new user to an organization in the same step —
 * measured on the real route, in a real multi-org posture.
 *
 * In multi-org mode the membership reconciler binds no organization by itself
 * (ADR-0093 D3 — it never guesses one), so a user created without one is
 * member-less and the administrator had to follow up with the organization's
 * Add Member action. Naming the organization on create-user folds that second
 * step into the first: better-auth's own `addMember` joins the user as a
 * `member`, inside the account's transaction.
 *
 *   J1  chosen: the user lands with exactly one membership, `member` of the
 *       chosen organization.
 *   J2  none chosen: still member-less in multi-org — the reconciler's
 *       never-guess posture is unchanged.
 *   J3  an organization that does not exist is refused, and the account rolls
 *       back with it — no member-less user is left behind.
 *
 * Harness: the admin identity routes 501 unless better-auth's `admin` plugin
 * is on; `OS_SCIM_ENABLED` is the one env knob that reaches it (see
 * `admin-identity-audit-trail.dogfood.test.ts`). The posture is a real,
 * non-degraded `isolated` one (`multiTenant: 'posture-only'`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('Create User joins a chosen organization in multi-org mode', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let orgId: string;
  let priorScim: string | undefined;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(crmStack as never, { multiTenant: 'posture-only' });
    adminToken = await stack.signIn(); // the seeded dev admin (platform admin)
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const ownerToken = await stack.signUp('owner.create-user-org@example.com');
    const created = await stack.apiAs(ownerToken, 'POST', '/auth/organization/create', {
      name: 'Join Target', slug: 'join-target-create-user',
    });
    expect(created.status, `org create: ${await created.clone().text()}`).toBe(200);
    orgId = ((await created.json()) as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('guard the guard: a real multi-org posture', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{
      posture: string; isolationActive: boolean; degraded: boolean; defaultOrgId(): Promise<string | null>;
    }>('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(tenancy.degraded).toBe(false);
    // The reconciler's target: none, so J2's member-less outcome is the posture's, not an accident.
    expect(await tenancy.defaultOrgId()).toBeNull();
  });

  it('J1 chosen: the user lands as a member of that organization, and only that one', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email: 'joined.create-user-org@example.com',
      password: 'Joined!Pass123',
      organizationId: orgId,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.data.organizationId).toBe(orgId);
    expect(body.data.membershipCreated).toBe(true);

    const members = await findRows(ql, 'sys_member', { user_id: String(body.data.user.id) });
    expect(members.map((m) => [m.organization_id, m.role])).toEqual([[orgId, 'member']]);
  }, 120_000);

  it('J2 none chosen: member-less, as before — multi-org never guesses an organization', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email: 'unbound.create-user-org@example.com',
      password: 'Unbound!Pass123',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.data.membershipCreated).toBe(false);
    expect(await findRows(ql, 'sys_member', { user_id: String(body.data.user.id) })).toHaveLength(0);
  }, 120_000);

  it('J3 an organization that does not exist: refused, and no user is created', async () => {
    const email = 'refused.create-user-org@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      password: 'Refused!Pass123',
      organizationId: 'org_does_not_exist',
    });
    const text = await res.clone().text();
    expect(res.status, text).toBeGreaterThanOrEqual(400);
    expect(res.status, text).toBeLessThan(500);
    expect((await res.json()).error.message).toContain('no user was created');
    expect(await findRows(ql, 'sys_user', { email })).toHaveLength(0);
  }, 120_000);
});
