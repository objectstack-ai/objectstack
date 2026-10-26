// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25799] `resolveUserAuthzGrants` reports its own split of the two channels a
 * set reaches a user through: `directPermissions` lists the names conferred by
 * the user's OWN grant rows (`sys_user_permission_set`, §6), and never a name
 * only a held position's definition names (§6a). The explainer reads it to
 * tell an assignment row from a position definition.
 *
 * The rows it lists are the rows §6 confers, by §6's own rules: the row applies
 * in the active organization, and its set is one the catalog holds and the
 * activation ledger has not switched off.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

/** `everyone` (the anchor every member holds) names two sets: one also granted directly below, one not. */
const definitions = {
  permissions: [
    { name: 'tools', systemPermissions: ['cap_tools'] },
    { name: 'elsewhere', systemPermissions: ['cap_elsewhere'] },
    { name: 'both_channels', systemPermissions: ['cap_both'] },
    { name: 'definition_only', systemPermissions: ['cap_definition'] },
  ],
  positions: [{ name: 'everyone', permissionSets: ['both_channels', 'definition_only'] }] as Array<Record<string, unknown>>,
};

/** The user's own grant rows: two in ORG_A, one in ORG_B. */
const GRANTS = [
  { permission_set: 'tools', organization_id: ORG_A },
  { permission_set: 'both_channels', organization_id: ORG_A },
  { permission_set: 'elsewhere', organization_id: ORG_B },
];

async function resolve(tenantId: string | undefined, ledger: unknown[] = []) {
  const ql = bindStaticSecurityCatalog(makeRecordingQl({
    sys_user: [{ id: 'u1', email: 'u1@example.com' }],
    sys_member: [{ user_id: 'u1', organization_id: ORG_A, role: 'member' }, { user_id: 'u1', organization_id: ORG_B, role: 'member' }],
    sys_user_position: [],
    sys_position: [],
    sys_position_permission_set: [],
    sys_user_permission_set: GRANTS.map((g) => ({ user_id: 'u1', ...g })),
    sys_permission_set: [],
    sys_metadata_activation: ledger,
  }), definitions);
  return resolveUserAuthzGrants(ql, 'u1', tenantId ? { tenantId } : {});
}

describe('[#25799] directPermissions is the resolver\'s own direct channel', () => {
  it('lists the sets the user\'s own rows confer in this organization, a set a definition also names included, and no set only a definition names', async () => {
    const out = await resolve(ORG_A);
    // The control: every one of these is in force for the user.
    expect(out.permissions).toEqual(expect.arrayContaining(['tools', 'both_channels', 'definition_only']));
    expect(out.directPermissions).toEqual(['tools', 'both_channels']);
  });

  it('follows the tenant rule: a row of another organization is not a direct grant here, and is one there', async () => {
    expect((await resolve(ORG_A)).directPermissions).not.toContain('elsewhere');
    const inB = await resolve(ORG_B);
    expect(inB.directPermissions).toEqual(['elsewhere']);
    expect(inB.permissions).toContain('elsewhere');
  });

  it('with no active organization no stored row applies, so nothing is direct while the definition-bound sets stand', async () => {
    const out = await resolve(undefined);
    expect(out.directPermissions).toEqual([]);
    expect(out.permissions).toEqual(expect.arrayContaining(['both_channels', 'definition_only']));
  });

  it('a set the activation ledger switched off is not listed: the row confers nothing', async () => {
    const out = await resolve(ORG_A, [{ metadata_type: 'permission', name: 'tools', package_id: null, active: false }]);
    expect(out.permissions).not.toContain('tools');
    expect(out.directPermissions).toEqual(['both_channels']);
  });
});
