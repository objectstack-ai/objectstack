// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] `resolveUserAuthzGrants` §6 resolves a user grant's
 * permission set BY NAME — `sys_user_permission_set.permission_set` — in the
 * security catalog: the set exists, and grants what it grants, because the
 * catalog holds a definition of that name. Its `permission_set_id` is not read.
 * The catalog row is read for one thing, its ADR-0049 `active` flag: the
 * grant's own organization's row, else the organization-less row.
 *
 * What is pinned here, on the recording double the batch-equivalence suite
 * drives (with an explicit catalog bound over it):
 *
 * - the body is the catalog definition, whichever organization's row carries
 *   the name — and a name only a row carries (no definition) confers nothing;
 * - a grant that names nothing confers nothing, platform standing included;
 * - platform standing stands on an organization-less grant only;
 * - the `active` flag: an organization's own row wins over the
 *   organization-less one, and a deactivated own row does not fall through;
 * - position-bound sets are the ones the position's definition names, and the
 *   junction rows are not read at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import { makeRecordingQl } from './__tests__/resolve-authz-context.batch-equivalence.testkit.js';
import { bindStaticSecurityCatalog } from './__tests__/security-catalog.testkit.js';

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

/** The catalog rows: one name per organization, plus the organization-less platform rows. */
const catalog = () => [
  { id: 'ps_admin', name: ADMIN_FULL_ACCESS, organization_id: null },
  { id: 'ps_admin_b', name: ADMIN_FULL_ACCESS, organization_id: ORG_B },
  { id: 'ps_tools_a', name: 'tools', organization_id: ORG_A },
  { id: 'ps_tools_b', name: 'tools', organization_id: ORG_B },
  { id: 'ps_tools', name: 'tools', organization_id: null },
  { id: 'ps_row_only', name: 'row_only', organization_id: ORG_B },
  { id: 'ps_off_a', name: 'switched', organization_id: ORG_A, active: false },
  { id: 'ps_on', name: 'switched', organization_id: null, active: true },
  { id: 'ps_bound', name: 'bound_by_position', organization_id: null },
];

/** The definitions the catalog holds — the only place a set's body lives. */
const definitions = {
  permissions: [
    { name: ADMIN_FULL_ACCESS, systemPermissions: ['manage_users'] },
    { name: 'tools', systemPermissions: ['cap_tools'] },
    { name: 'switched', systemPermissions: ['cap_switched'] },
    { name: 'bound_by_position', systemPermissions: ['cap_bound'] },
    { name: 'no_row', systemPermissions: ['cap_no_row'] },
  ],
  positions: [] as Array<Record<string, unknown>>,
};

/** The same catalog, with the `everyone` anchor distributing one set. */
const withEveryone = { ...definitions, positions: [{ name: 'everyone', permissionSets: ['bound_by_position'] }] };

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

async function resolve(
  grants: Array<Record<string, unknown>>,
  tenantId?: string,
  extra?: Record<string, unknown[]>,
  catalogDefinitions: typeof definitions = definitions,
) {
  const ql = bindStaticSecurityCatalog(makeRecordingQl(tables(grants, extra)), catalogDefinitions);
  const out = await resolveUserAuthzGrants(ql, 'u1', tenantId ? { tenantId } : {});
  return { out, ql };
}

describe('[ADR-0131 D3/D4] a grant names its set; the catalog says what the set is', () => {
  it('the body is the definition, whichever organization\'s row carries the name', async () => {
    for (const [grantOrg, tenantId] of [[ORG_A, ORG_A], [null, ORG_A], [ORG_B, ORG_B], [null, undefined]] as const) {
      const { out } = await resolve([{ permission_set_id: 'ps_tools_a', permission_set: 'tools', organization_id: grantOrg }], tenantId);
      expect(out.permissions, `${grantOrg} in ${tenantId}`).toEqual(['tools']);
      expect(out.systemPermissions, `${grantOrg} in ${tenantId}`).toEqual(['cap_tools']);
    }
  });

  it('a name only a ROW carries — no definition — confers nothing, in its organization or out of it', async () => {
    for (const [grantOrg, tenantId] of [[ORG_B, ORG_B], [null, ORG_B], [null, undefined]] as const) {
      const { out } = await resolve([{ permission_set_id: 'ps_row_only', permission_set: 'row_only', organization_id: grantOrg }], tenantId);
      expect(out.permissions, `${grantOrg} in ${tenantId}`).toEqual([]);
    }
  });

  it('CONTROL — a definition with no row at all confers its body: no row carries no flag to read', async () => {
    const { out } = await resolve([{ permission_set: 'no_row', organization_id: null }], ORG_A);
    expect(out.permissions).toEqual(['no_row']);
    expect(out.systemPermissions).toEqual(['cap_no_row']);
  });

  it('the id does not decide: a grant named `tools` whose id points at another set resolves `tools`', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_admin', permission_set: 'tools', organization_id: ORG_A }], ORG_A);
    expect(out.permissions).toEqual(['tools']);
    expect(out.posture).not.toBe('PLATFORM_ADMIN');
  });

  it('the junction and the id bridge are never read; the catalog rows are read by NAME only', async () => {
    const { ql } = await resolve([{ permission_set_id: 'ps_tools_a', permission_set: 'tools', organization_id: ORG_A }], ORG_A);
    expect(ql.calls.map((c) => c.object)).not.toContain('sys_position_permission_set');
    for (const call of ql.calls.filter((c) => c.object === 'sys_permission_set')) {
      expect(Object.keys(call.where as object)).not.toContain('id');
      expect(Object.keys(call.where as object)).toContain('name');
    }
  });
});

describe('[ADR-0068 D2] platform standing stands on an organization-less grant only', () => {
  it('an organization-less grant named admin_full_access holds platform standing', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_admin_b', permission_set: ADMIN_FULL_ACCESS, organization_id: null }], ORG_B);
    expect(out.posture).toBe('PLATFORM_ADMIN');
    expect(out.positions[0]).toBe('platform_admin');
  });

  it('an ORGANIZATION’s admin_full_access grant carries the set, never platform standing', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_admin_b', permission_set: ADMIN_FULL_ACCESS, organization_id: ORG_B }], ORG_B);
    expect(out.permissions).toContain(ADMIN_FULL_ACCESS);
    expect(out.posture).not.toBe('PLATFORM_ADMIN');
  });

  it('with no admin_full_access definition in the catalog, the grant confers nothing at all', async () => {
    const { out } = await resolve(
      [{ permission_set_id: 'ps_admin', permission_set: ADMIN_FULL_ACCESS, organization_id: null }],
      undefined,
      undefined,
      { ...definitions, permissions: definitions.permissions.filter((d) => d.name !== ADMIN_FULL_ACCESS) },
    );
    expect(out.posture).not.toBe('PLATFORM_ADMIN');
    expect(out.permissions).toEqual([]);
  });

  it('a DEACTIVATED organization-less row takes the standing away', async () => {
    const { out } = await resolve(
      [{ permission_set_id: 'ps_admin', permission_set: ADMIN_FULL_ACCESS, organization_id: null }],
      undefined,
      { sys_permission_set: [{ id: 'ps_admin', name: ADMIN_FULL_ACCESS, organization_id: null, active: false }] },
    );
    expect(out.posture).not.toBe('PLATFORM_ADMIN');
    expect(out.permissions).toEqual([]);
  });
});

describe('[ADR-0049] the row that carries the `active` flag', () => {
  it('a deactivated own row is the answer: it confers nothing and does not fall through to the organization-less row', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_off_a', permission_set: 'switched', organization_id: ORG_A }], ORG_A);
    expect(out.permissions).not.toContain('switched');
    expect(out.systemPermissions).toEqual([]);
  });

  it('CONTROL — an organization-less grant of the same name reads the organization-less row, which is active', async () => {
    const { out } = await resolve([{ permission_set_id: 'ps_on', permission_set: 'switched', organization_id: null }], ORG_A);
    expect(out.permissions).toEqual(['switched']);
    expect(out.systemPermissions).toEqual(['cap_switched']);
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
});

describe('[ADR-0131 D3/D4] position-bound sets are the ones the position definition names', () => {
  it('the `everyone` definition\'s set resolves; a junction row binding another set confers nothing', async () => {
    const { out, ql } = await resolve([], ORG_A, {
      sys_position: [{ id: 'p_everyone', name: 'everyone', organization_id: ORG_A }],
      sys_position_permission_set: [{ position_id: 'p_everyone', permission_set_id: 'ps_tools_a' }],
    }, withEveryone);
    expect(out.permissions).toEqual(['bound_by_position']);
    expect(out.systemPermissions).toEqual(['cap_bound']);
    expect(ql.calls.map((c) => c.object)).not.toContain('sys_position_permission_set');
  });

  it('a DEACTIVATED position row drops the sets its definition names', async () => {
    const { out } = await resolve([], ORG_A, {
      sys_position: [{ id: 'p_everyone', name: 'everyone', organization_id: ORG_A, active: false }],
    }, withEveryone);
    expect(out.permissions).toEqual([]);
    expect(out.positions).not.toContain('everyone');
  });
});
