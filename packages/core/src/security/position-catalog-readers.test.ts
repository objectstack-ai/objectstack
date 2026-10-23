// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two readers the position catalog's list describes a position with —
 * `readPositionGrantsInForce` (the sets its definition grants, in force) and
 * `countPositionHolders` (who holds it in an organization) — pinned against the
 * resolver that enforces both, `resolveUserAuthzGrants`, on the recording double
 * the batch-equivalence suite drives.
 *
 * The pin is the agreement, not the reader's own output: for every user of the
 * fixture, a user is counted for position P exactly when the resolver gives that
 * user P, and a position's sets in force are exactly the sets the resolver
 * grants a user who holds that position alone.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import {
  countPositionHolders,
  readPositionGrantsInForce,
  resolveUserAuthzGrants,
} from './resolve-authz-context.js';
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

const definitions = {
  permissions: [
    { name: 'crm_sales_user', systemPermissions: ['cap_sales'] },
    { name: 'forecasting', systemPermissions: ['cap_forecast'] },
    { name: 'switched_off_set', systemPermissions: ['cap_off'] },
  ],
  positions: [
    { name: 'everyone', permissionSets: [] },
    { name: 'sales_rep', permissionSets: ['crm_sales_user'] },
    // One live set, one switched off, one the catalog holds no set for.
    { name: 'sales_manager', permissionSets: ['crm_sales_user', 'forecasting', 'switched_off_set', 'no_such_set'] },
    { name: 'retired_position', permissionSets: ['forecasting'] },
    { name: 'unbound', permissionSets: [] },
  ],
};

const off = (metadata_type: 'position' | 'permission', name: string) =>
  ({ metadata_type, name, package_id: null, active: false });

const PAST = '2000-01-01T00:00:00.000Z';

function tables() {
  return {
    sys_user: ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => ({ id, email: `${id}@example.com` })),
    sys_member: [
      { user_id: 'u1', organization_id: ORG_A, role: 'owner' },
      { user_id: 'u2', organization_id: ORG_A, role: 'member' },
      { user_id: 'u3', organization_id: ORG_A, role: 'member,admin' },
      { user_id: 'u4', organization_id: ORG_A, role: 'member', valid_until: PAST },
      { user_id: 'u5', organization_id: ORG_B, role: 'member' },
    ],
    sys_user_position: [
      { user_id: 'u1', organization_id: ORG_A, position: 'sales_manager' },
      { user_id: 'u2', organization_id: ORG_A, position: 'sales_rep' },
      { user_id: 'u3', organization_id: ORG_A, position: 'sales_rep' },
      // Lapsed: holds nothing.
      { user_id: 'u3', organization_id: ORG_A, position: 'sales_manager', valid_until: PAST },
      { user_id: 'u2', organization_id: ORG_A, position: 'retired_position' },
      // Another organization's row: counted there, not here.
      { user_id: 'u5', organization_id: ORG_B, position: 'sales_rep' },
      // An organization-less row applies in no organization.
      { user_id: 'u2', organization_id: null, position: 'unbound' },
    ],
    sys_user_permission_set: [],
    sys_metadata_activation: [off('permission', 'switched_off_set'), off('position', 'retired_position')],
  };
}

const ql = () => bindStaticSecurityCatalog(makeRecordingQl(tables()), definitions);

const ledgerWithoutPositions = () => bindStaticSecurityCatalog(makeRecordingQl({
  ...tables(),
  sys_metadata_activation: tables().sys_metadata_activation.filter((r) => r.metadata_type !== 'position'),
}), definitions);

const POSITIONS = ['everyone', 'sales_rep', 'sales_manager', 'retired_position', 'unbound', 'org_owner', 'org_admin', 'org_member'];

describe('countPositionHolders agrees with the resolver, user by user', () => {
  it('counts a user for P exactly when resolveUserAuthzGrants gives that user P in the organization', async () => {
    for (const org of [ORG_A, ORG_B]) {
      const counts = await countPositionHolders(ql(), org, POSITIONS);
      const expected = new Map<string, number>(POSITIONS.map((p) => [p, 0]));
      for (const userId of ['u1', 'u2', 'u3', 'u4', 'u5']) {
        // Holding is the assignment: a switched-off position keeps its holders
        // (ADR-0049 — "users keep their assignment but the position stops
        // granting permissions"), and the resolver drops its NAME only to stop
        // the grant. So the resolver is asked over the same rows with no
        // position switched off; what a switched-off position grants (nothing) is
        // the other reader's, below.
        const grants = await resolveUserAuthzGrants(ledgerWithoutPositions(), userId, { tenantId: org });
        // A user who is not an active member of the organization holds nothing in it
        // (the resolver still projects `everyone`, the authenticated audience).
        const member = tables().sys_member.some((m) => m.user_id === userId && m.organization_id === org && !m.valid_until);
        for (const p of POSITIONS) {
          if (grants.positions.includes(p) && (member || p !== 'everyone')) expected.set(p, expected.get(p)! + 1);
        }
      }
      expect(Object.fromEntries(counts), org).toEqual(Object.fromEntries(expected));
    }
  });

  it('reads the measured numbers for the fixture', async () => {
    const counts = await countPositionHolders(ql(), ORG_A, POSITIONS);
    expect(Object.fromEntries(counts)).toEqual({
      everyone: 3, // u1, u2, u3; u4's membership lapsed
      sales_rep: 2, // u2, u3
      sales_manager: 1, // u1; u3's row lapsed
      retired_position: 1, // u2 holds the row; what it grants is the other reader's question
      unbound: 0, // u2's organization-less row applies nowhere
      org_owner: 1,
      org_admin: 1,
      org_member: 2, // u2, u3
    });
  });

  it('has no count without an organization, for the derived and anonymous positions, or past a truncated read', async () => {
    expect((await countPositionHolders(ql(), undefined, POSITIONS)).size).toBe(0);
    const counts = await countPositionHolders(ql(), ORG_A, ['platform_admin', 'guest', 'sales_rep']);
    expect([...counts.keys()]).toEqual(['sales_rep']);
    expect((await countPositionHolders(ql(), ORG_A, ['sales_rep'], { limit: 2 })).size).toBe(0);
  });
});

describe('readPositionGrantsInForce agrees with the resolver, position by position', () => {
  it('a position grants exactly the definition sets a holder of it alone is granted', async () => {
    const { inForce, disabledPositions } = await readPositionGrantsInForce(ql(), [
      'sales_rep', 'sales_manager', 'retired_position', 'unbound',
    ]);
    expect(Object.fromEntries(inForce)).toEqual({
      sales_rep: ['crm_sales_user'],
      // switched_off_set is off in the ledger; no_such_set names nothing.
      sales_manager: ['crm_sales_user', 'forecasting'],
      unbound: [],
    });
    expect([...disabledPositions]).toEqual(['retired_position']);

    // The resolver's own answer for a user holding each position alone.
    for (const position of ['sales_rep', 'sales_manager', 'retired_position', 'unbound']) {
      const alone = {
        ...tables(),
        sys_member: [{ user_id: 'solo', organization_id: ORG_A, role: '' }],
        sys_user_position: [{ user_id: 'solo', organization_id: ORG_A, position }],
      };
      const grants = await resolveUserAuthzGrants(
        bindStaticSecurityCatalog(makeRecordingQl(alone), definitions), 'solo', { tenantId: ORG_A },
      );
      expect(grants.permissions, position).toEqual(inForce.get(position) ?? []);
    }
  });
});
