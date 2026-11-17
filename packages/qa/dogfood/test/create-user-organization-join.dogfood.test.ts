// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In multi-org mode, Create User adds the new user to the administrator's
 * CURRENT organization — measured on the real route, in a real walled posture.
 *
 * The membership reconciler binds no organization by itself in multi-org mode
 * (ADR-0093 D3 — it never guesses one), so a user created from Setup used to be
 * member-less and the administrator had to follow up with Add Member. The D3
 * amendment folds that step in: the organization the administrator is working
 * in is the one the new user joins, as `member`, through better-auth's own
 * `addMember` inside the account's transaction — the way mainstream admin
 * consoles add people to the workspace you are standing in.
 *
 *   J1  in an organization: the user lands with exactly one membership,
 *       `member` of the administrator's current organization — not another one
 *       the request names.
 *   J2  no current organization: refused, and no user is created — never a
 *       member-less account.
 *
 * Import Users follows the same rule, row by row (ruling on #34535, option B):
 *
 *   I1  every imported row joins the administrator's current organization;
 *       a row the organization's member cap refuses is rolled back in the real
 *       engine transaction — no account, no temporary password — and the other
 *       rows land.
 *   I2  no current organization: the whole import is refused, and no user is
 *       created.
 *
 * The member cap is `OS_ORG_MEMBERSHIP_LIMIT`, read when better-auth's
 * organization plugin is built, so it is set before the boot.
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

describe("Create User in multi-org mode joins the administrator's current organization", () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  /** An organization the administrator is NOT working in. */
  let otherOrgId: string;
  /** The administrator's own current organization. */
  let adminOrgId: string;
  let priorScim: string | undefined;
  let priorMemberCap: string | undefined;
  /** I1's organization: the administrator (owner) plus two imported members fill its cap. */
  let importOrgId: string;
  const MEMBER_CAP = 3;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    priorMemberCap = process.env.OS_ORG_MEMBERSHIP_LIMIT;
    process.env.OS_ORG_MEMBERSHIP_LIMIT = String(MEMBER_CAP);
    stack = await bootStack(crmStack as never, { multiTenant: 'posture-only' });
    adminToken = await stack.signIn(); // the seeded dev admin (platform admin)
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const ownerToken = await stack.signUp('owner.create-user-org@example.com');
    const other = await stack.apiAs(ownerToken, 'POST', '/auth/organization/create', {
      name: 'Elsewhere', slug: 'elsewhere-create-user',
    });
    expect(other.status, `org create: ${await other.clone().text()}`).toBe(200);
    otherOrgId = ((await other.json()) as { id: string }).id;

    const home = await stack.apiAs(adminToken, 'POST', '/auth/organization/create', {
      name: 'Admin Home', slug: 'admin-home-create-user',
    });
    expect(home.status, `admin org create: ${await home.clone().text()}`).toBe(200);
    adminOrgId = ((await home.json()) as { id: string }).id;

    const importHome = await stack.apiAs(adminToken, 'POST', '/auth/organization/create', {
      name: 'Import Home', slug: 'import-home-create-user',
    });
    expect(importHome.status, `import org create: ${await importHome.clone().text()}`).toBe(200);
    importOrgId = ((await importHome.json()) as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
    if (priorMemberCap === undefined) delete process.env.OS_ORG_MEMBERSHIP_LIMIT;
    else process.env.OS_ORG_MEMBERSHIP_LIMIT = priorMemberCap;
  });

  async function setActive(organizationId: string | null): Promise<void> {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/set-active', { organizationId });
    expect(res.status, `set-active: ${await res.clone().text()}`).toBe(200);
    const session = await (await stack.apiAs(adminToken, 'GET', '/auth/get-session')).json();
    expect(session.session.activeOrganizationId ?? null).toBe(organizationId);
  }

  it('guard the guard: a real multi-org posture', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{
      posture: string; isolationActive: boolean; degraded: boolean; defaultOrgId(): Promise<string | null>;
    }>('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(tenancy.degraded).toBe(false);
    // The reconciler's target: none — so the membership below is the join's doing, not the reconciler's.
    expect(await tenancy.defaultOrgId()).toBeNull();
    expect(adminOrgId).not.toBe(otherOrgId);
  });

  it("J1 in an organization: the user joins the administrator's current one, and only that one", async () => {
    await setActive(adminOrgId);
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email: 'joined.create-user-org@example.com',
      password: 'Joined!Pass123',
      // Not a choice the route offers: the current organization decides.
      organizationId: otherOrgId,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.data.organizationId).toBe(adminOrgId);
    expect(body.data.membershipCreated).toBe(true);
    const members = await findRows(ql, 'sys_member', { user_id: String(body.data.user.id) });
    expect(members.map((m) => [m.organization_id, m.role])).toEqual([[adminOrgId, 'member']]);
  }, 120_000);

  it('J2 no current organization: refused, and no user is created', async () => {
    await setActive(null);
    const email = 'orphan.create-user-org@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      password: 'Orphan!Pass123',
    });
    const text = await res.clone().text();
    expect(res.status, text).toBe(400);
    expect((await res.json()).error.code).toBe('NO_ACTIVE_ORGANIZATION');
    expect(await findRows(ql, 'sys_user', { email })).toHaveLength(0);
  }, 120_000);

  it("I1 import: each row joins the administrator's current organization; a row the member cap refuses is rolled back", async () => {
    await setActive(importOrgId);
    const emails = ['one.import-org@example.com', 'two.import-org@example.com', 'three.import-org@example.com'];
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/import-users', {
      format: 'json',
      passwordPolicy: 'temporary',
      rows: emails.map((email, i) => ({ email, name: `Import ${i + 1}` })),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { summary, rows } = (await res.json()).data;
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(1);

    for (const [i, email] of emails.slice(0, 2).entries()) {
      expect(rows[i]).toMatchObject({ ok: true, action: 'created' });
      const members = await findRows(ql, 'sys_member', { user_id: String(rows[i].id) });
      expect(members.map((m) => [m.organization_id, m.role]), email).toEqual([[importOrgId, 'member']]);
    }
    // The third row would exceed the cap: refused, and the real transaction took its account back.
    expect(rows[2]).toMatchObject({ ok: false, action: 'failed' });
    expect(rows[2].error).toContain('no user was created');
    expect(rows[2].temporaryPassword).toBeUndefined();
    expect(await findRows(ql, 'sys_user', { email: emails[2] })).toHaveLength(0);
    expect(await findRows(ql, 'sys_member', { organization_id: importOrgId })).toHaveLength(MEMBER_CAP);
  }, 120_000);

  it('I2 import with no current organization: the whole import is refused, and no user is created', async () => {
    await setActive(null);
    const email = 'orphan.import-org@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/import-users', {
      format: 'json',
      passwordPolicy: 'temporary',
      rows: [{ email, name: 'Orphan' }],
    });
    const text = await res.clone().text();
    expect(res.status, text).toBe(400);
    expect((await res.json()).error.code).toBe('NO_ACTIVE_ORGANIZATION');
    expect(await findRows(ql, 'sys_user', { email })).toHaveLength(0);
  }, 120_000);
});
