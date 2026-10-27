// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.deployment-tables-platform-only`, acceptance[1]
// and acceptance[2], over the REST data door on the stock showcase.
//
// Seven tables are deployment-level: they carry no tenant column and declare
// `requiredPermissions: ['manage_platform_settings']` (the object-declaration
// pins in platform-objects, service-automation and service-realtime). The item
// scores the doors at the `api` oracle, so this file reads them as the two
// personas the item names:
//
//   - an organization administrator (the Default Organization's membership
//     role promoted to `admin`, which provisions the organization-admin set)
//     who is not the platform administrator: 403 PERMISSION_DENIED on every
//     table;
//   - the platform administrator: 200 on every table;
//   - acceptance[2]: an `organization_id` filter is 400 INVALID_FIELD, since
//     the column does not exist on these tables.
//
// Isolated boot: the file promotes a membership.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const ORG_ADMIN = 'deployment-tables-org-admin@verify.test';
const PASSWORD = 'Deploy-Tables-26571';
const TABLES = [
  'sys_job', 'sys_job_queue', 'sys_job_run', 'sys_migration', 'sys_migration_journal', 'sys_flow_dispatch', 'sys_presence',
] as const;

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('deployment-level tables are the platform administrator\'s alone', () => {
  let stack: VerifyStack;
  let admin: string;
  let orgAdmin: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    orgAdmin = await stack.signUp(ORG_ADMIN, PASSWORD);
    const userId = (await ql.findOne('sys_user', { where: { email: ORG_ADMIN }, ...SYS }))?.id;
    expect(userId, 'the org admin is provisioned').toBeTruthy();
    // Promote the way an organization does: the membership role.
    const [membership] = await ql.find('sys_member', { where: { user_id: userId }, ...SYS });
    expect(membership?.organization_id, 'a member of the Default Organization').toBeTruthy();
    await ql.update('sys_member', { id: membership.id, role: 'admin' }, SYS);
    // A fresh session reads the promoted role.
    orgAdmin = await stack.signIn(ORG_ADMIN, PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('guard the guard: the org admin holds the organization-admin standing and is not the platform administrator', async () => {
    const session = (await (await stack.apiAs(orgAdmin, 'GET', '/auth/get-session')).json()) as any;
    expect(session.user?.isPlatformAdmin, 'not the platform administrator').not.toBe(true);
    expect(session.user?.positions ?? []).not.toContain('platform_admin');
    const p = (await (await stack.apiAs(orgAdmin, 'GET', '/auth/me/permissions')).json()) as any;
    const resolved = p?.data ?? p;
    expect((resolved.permissionSets ?? []).map(String).join(','), 'the organization-admin set is held').toMatch(/organization_admin/);
    expect(resolved.systemPermissions ?? [], 'no platform-settings capability').not.toContain('manage_platform_settings');
  });

  it.each(TABLES)('acceptance[1]: %s — the org admin is refused 403 PERMISSION_DENIED; the platform admin reads 200', async (table) => {
    const refused = await stack.apiAs(orgAdmin, 'GET', `/data/${table}`);
    const body = await refused.json();
    expect([refused.status, codeOf(body)], JSON.stringify(body)).toEqual([403, 'PERMISSION_DENIED']);
    const served = await stack.apiAs(admin, 'GET', `/data/${table}`);
    expect(served.status, await served.clone().text()).toBe(200);
  });

  it.each(TABLES)('acceptance[2]: %s — an organization_id filter is 400 INVALID_FIELD (the column does not exist)', async (table) => {
    const filter = encodeURIComponent(JSON.stringify([['organization_id', '=', 'x']]));
    const res = await stack.apiAs(admin, 'GET', `/data/${table}?filter=${filter}`);
    const body = await res.json();
    expect([res.status, codeOf(body)], JSON.stringify(body)).toEqual([400, 'INVALID_FIELD']);
  });
});
