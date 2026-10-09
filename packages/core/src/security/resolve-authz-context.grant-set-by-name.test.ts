// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] `resolveUserAuthzGrants` §6 finds a user grant's permission
 * set BY NAME — `sys_user_permission_set.permission_set` — on the grant's own
 * organization's row, else the organization-less row. Its
 * `permission_set_id` is not read.
 *
 * What is pinned here, on the recording double the batch-equivalence suite
 * drives (the real-engine half, over the SQL driver and the real write hooks,
 * is `plugin-security`'s `resolve-authz-grant-set-by-name.test.ts`):
 *
 * - a grant whose id names another organization's set confers nothing — the
 *   set row the id points at is never read;
 * - a grant whose NAME is carried only by another organization's row confers
 *   nothing either;
 * - a grant that names nothing confers nothing, platform standing included;
 * - an organization's own row wins over the organization-less one, and a
 *   deactivated own row is the answer — it does not fall through;
 * - position-bound sets are still reached through the junction's id.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import { makeRecordingQl } from './__tests__/resolve-authz-context.batch-equivalence.testkit.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';

const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
let ambient: Record<string, string | undefined> = {};
beforeAll(() => {
  ambient = { [OWNER_ENV]: process.env[OWNER_ENV], [POSTURE_ENV]: process.env[POSTURE_ENV] };
  delete process.env[OWNER_ENV];
  delete process.env[POSTURE_ENV];
  resetPlatformAdminEmailMemo();
});
afterAll(() => {
  for (const [k, v] of Object.entries(ambient)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPlatformAdminEmailMemo();
});

/** The catalog: one name per organization, plus the organization-less platform rows. */
const catalog = () => [
  { id: 'ps_admin', name: ADMIN_FULL_ACCESS, organization_id: null, system_permissions: ['manage_users'] },
  { id: 'ps_admin_b', name: ADMIN_FULL_ACCESS, organization_id: ORG_B, system_permissions: ['manage_users'] },
  { id: 'ps_tools_a', name: 'tools', organization_id: ORG_A, system_permissions: ['cap_a'] },
  { id: 'ps_tools_b', name: 'tools', organization_id: ORG_B, system_permissions: ['cap_b'] },
  { id: 'ps_tools', name: 'tools', organization_id: null, system_permissions: ['cap_global'] },
  { id: 'ps_b_only', name: 'b_only', organization_id: ORG_B, system_permissions: ['cap_b_only'] },
  { id: 'ps_shared', name: 'shared', organization_id: null, system_permissions: ['cap_shared'] },
  { id: 'ps_off_a', name: 'switched', organization_id: ORG_A, active: false, system_permissions: ['cap_off'] },
  { id: 'ps_on', name: 'switched', organization_id: null, active: true, system_permissions: ['cap_on'] },
  { id: 'ps_bound', name: 'bound_by_position', organization_id: null, system_permissions: ['cap_bound'] },
];

function tables(grants: Array<Record<string, unknown>>, extra: Record<string, unknown[]> = {}) {
  return {
    sys_user: [{ id: 'u1', email: 'u1@example.com' }],
    sys_member: [{ user_id: 'u1', organization_id: ORG_A, role: 'member' }],
    sys_user_position: [],
    sys_position: [],
    sys_position_permission_set: [],
    sys_user_permission_set: grants.map((g) => ({ user_id: 'u1', ...g })),
    sys_permission_set: catalog(),
    ...extra,
  };
}

async function resolve(grants: Array<Record<string, unknown>>, tenantId?: string, extra?: Record<string, unknown[]>) {
  const ql = makeRecordingQl(tables(grants, extra));
  const out = await resolveUserAuthzGrants(ql, 'u1', tenantId ? { tenantId } : {});
  return { out, ql };
}

describe('[ADR-0131 D4] a grant whose id names another organization’s set confers nothing', () => {
  it('an unnamed organization-less grant pointing at another organization’s set: nothing, and that row is never read', async () => {
    for (const tenantId of [undefined, ORG_A, ORG_B]) {
      const { out, ql } = await resolve([{ permission_set_id: 'ps_b_only', organization_id: null }], tenantId);
      expect(out.permissions, String(tenantId)).not.toContain('b_only');
      expect(out.systemPermissions, String(tenantId)).not.toContain('cap_b_only');
      expect(JSON.stringify(ql.calls), String(tenantId)).not.toContain('ps_b_only');
    }
  });

  it('a grant named after a set only another organization carries: nothing, in that organization or out of it', async () => {
    const orgLess = await resolve([{ permission_set_id: 'ps_b_only', permission_set: 'b_only', organization_id: null }], ORG_B);
    expect(orgLess.out.permissions).not.toContain('b_only');
    const ownOrg = await resolve([{ permission_set_id: 'ps_b_only', permission_set: 'b_only', organization_id: ORG_A }], ORG_A);
    expect(ownOrg.out.permissions).not.toContain('b_only');
    expect(ownOrg.out.systemPermissions).not.toContain('cap_b_only');
  });

  it('CONTROL — the same name on a row the grant may name confers it', async () => {
    const own = await resolve([{ permission_set_id: 'ps_b_only', permission_set: 'b_only', organization_id: ORG_B }], ORG_B);
    expect(own.out.permissions).toContain('b_only');
    expect(own.out.systemPermissions).toContain('cap_b_only');
  });

  it('an organization-less grant named after admin_full_access stands on the organization-less row only', async () => {
    const only = (rows: any[]) => ({ sys_permission_set: rows });
    const onCopy = await resolve(
      [{ permission_set_id: 'ps_admin_b', permission_set: ADMIN_FULL_ACCESS, organization_id: null }],
      ORG_B,
      only(catalog().filter((r) => r.id !== 'ps_admin')),
    );
    expect(onCopy.out.posture).not.toBe('PLATFORM_ADMIN');
    expect(onCopy.out.permissions).not.toContain(ADMIN_FULL_ACCESS);

    const onPlatformRow = await resolve(
      [{ permission_set_id: 'ps_admin_b', permission_set: ADMIN_FULL_ACCESS, organization_id: null }],
      ORG_B,
    );
    expect(onPlatformRow.out.posture).toBe('PLATFORM_ADMIN');
  });

  it('an ORGANIZATION’s admin_full_access grant is that organization’s set, never platform standing', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_admin_b', permission_set: ADMIN_FULL_ACCESS, organization_id: ORG_B }], ORG_B);
    expect(out.permissions).toContain(ADMIN_FULL_ACCESS);
    expect(out.posture).not.toBe('PLATFORM_ADMIN');
  });
});

describe('[ADR-0131 D4] the row a name resolves to', () => {
  it('an organization’s grant reads its own row first, and the organization-less row only where it has none', async () => {
    const own = await resolve([{ permission_set_id: 'ps_tools_a', permission_set: 'tools', organization_id: ORG_A }], ORG_A);
    expect(own.out.systemPermissions).toEqual(['cap_a']);
    const fallback = await resolve([{ permission_set_id: 'ps_shared', permission_set: 'shared', organization_id: ORG_A }], ORG_A);
    expect(fallback.out.systemPermissions).toEqual(['cap_shared']);
    // An organization-less grant of the same name reads the organization-less row, inside an organization too.
    const global = await resolve([{ permission_set_id: 'ps_tools', permission_set: 'tools', organization_id: null }], ORG_A);
    expect(global.out.systemPermissions).toEqual(['cap_global']);
  });

  it('a deactivated own row is the answer: it confers nothing and does not fall through to the organization-less row', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_off_a', permission_set: 'switched', organization_id: ORG_A }], ORG_A);
    expect(out.permissions).not.toContain('switched');
    expect(out.systemPermissions).toEqual([]);
  });

  it('the id does not decide: a grant named `tools` whose id points at another set resolves `tools`', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_shared', permission_set: 'tools', organization_id: ORG_A }], ORG_A);
    expect(out.permissions).toEqual(['tools']);
    expect(out.systemPermissions).toEqual(['cap_a']);
  });
});

describe('[ADR-0131 D4] a grant that names nothing confers nothing', () => {
  it('NULL or blank: no set, no capability, no tab', async () => {
    for (const name of [null, '', '   ', undefined]) {
      const { out } = await resolve([{ permission_set_id: 'ps_tools_a', permission_set: name, organization_id: ORG_A }], ORG_A);
      expect(out.permissions, String(name)).toEqual([]);
      expect(out.systemPermissions, String(name)).toEqual([]);
      expect(out.tabPermissions, String(name)).toBeUndefined();
    }
  });

  it('an unnamed UNSCOPED grant on the platform admin_full_access row: no platform standing', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_admin', organization_id: null }], undefined);
    expect(out.posture).not.toBe('PLATFORM_ADMIN');
    expect(out.positions).not.toContain('platform_admin');
    expect(out.permissions).not.toContain(ADMIN_FULL_ACCESS);
  });

  it('CONTROL — the same grant carrying its name holds platform standing', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_admin', permission_set: ADMIN_FULL_ACCESS, organization_id: null }], undefined);
    expect(out.posture).toBe('PLATFORM_ADMIN');
    expect(out.positions[0]).toBe('platform_admin');
  });

  it('position-bound sets are still read through the junction’s id (ADR-0131 C3)', async () => {
    const { out } = await resolve([], ORG_A, {
      sys_position: [{ id: 'p_everyone', name: 'everyone', organization_id: ORG_A }],
      sys_position_permission_set: [{ position_id: 'p_everyone', permission_set_id: 'ps_bound' }],
    });
    expect(out.permissions).toEqual(['bound_by_position']);
    expect(out.systemPermissions).toEqual(['cap_bound']);
  });
});
