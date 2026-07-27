// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  reconcileOrgAdminGrant,
  backfillOrgAdminGrants,
} from './auto-org-admin-grant.js';

/**
 * Tiny in-memory ObjectQL stub: just enough surface for the reconciler
 * (find / insert / delete) with isSystem context passthrough.
 */
function makeStub(seed: {
  sys_permission_set?: any[];
  sys_member?: any[];
  sys_user_permission_set?: any[];
} = {}) {
  const tables: Record<string, any[]> = {
    sys_permission_set: seed.sys_permission_set ?? [],
    sys_member: seed.sys_member ?? [],
    sys_user_permission_set: seed.sys_user_permission_set ?? [],
  };

  const matches = (row: any, where: any) => {
    for (const [k, v] of Object.entries(where ?? {})) {
      // `$in` — the ADR-0105 D4 backfill sweeps BOTH org-admin variants in one read.
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };

  return {
    tables,
    async find(object: string, args: any) {
      const rows = tables[object] ?? [];
      return rows.filter((r) => matches(r, args?.where));
    },
    async insert(object: string, data: any) {
      const id = data.id ?? `${object}_${tables[object].length + 1}`;
      const row = { ...data, id };
      tables[object] = [...(tables[object] ?? []), row];
      return row;
    },
    async delete(object: string, id: string) {
      tables[object] = (tables[object] ?? []).filter((r) => r.id !== id);
      return true;
    },
  };
}

const ORG_ADMIN_SET = { id: 'ps_org_admin', name: 'organization_admin' };
// [ADR-0105 D4] The wall-less variant a `single`-posture deployment grants instead.
const ORG_ADMIN_NO_BYPASS_SET = { id: 'ps_org_admin_nb', name: 'organization_admin_no_bypass' };

// Every pre-ADR-0105 case in this file exercised the WALLED behavior (the only
// behavior that existed), so they pin `isolated` explicitly. The wall-less
// posture — which grants the de-VAMA'd variant — gets its own describe below.
const WALLED = { posture: 'isolated' } as const;

describe('reconcileOrgAdminGrant', () => {
  let stub: ReturnType<typeof makeStub>;

  beforeEach(() => {
    stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [],
      sys_user_permission_set: [],
    });
  });

  it('grants when membership role is "owner"', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    const row = stub.tables.sys_user_permission_set[0];
    expect(row.organization_id).toBe('o1');
    expect(row.permission_set_id).toBe('ps_org_admin');
  });

  it('grants when membership role is "admin"', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'admin' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('granted');
  });

  it('handles comma-separated roles like "owner,admin"', async () => {
    stub.tables.sys_member = [
      { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner,admin' },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('granted');
  });

  it('does NOT grant when role is just "member"', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'member' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('noop');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('revokes the scoped grant on demotion (admin → member)', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'member' }];
    stub.tables.sys_user_permission_set = [
      {
        id: 'ups1',
        user_id: 'u1',
        organization_id: 'o1',
        permission_set_id: 'ps_org_admin',
      },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('revoked');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('revokes when membership is gone entirely', async () => {
    stub.tables.sys_user_permission_set = [
      {
        id: 'ups1',
        user_id: 'u1',
        organization_id: 'o1',
        permission_set_id: 'ps_org_admin',
      },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('revoked');
  });

  it('is idempotent — re-running keeps exactly one grant row', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('noop');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
  });

  it('only grants org-scoped (organization_id is set, not null)', async () => {
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const grant = stub.tables.sys_user_permission_set[0];
    expect(grant.organization_id).toBe('o1');
    expect(grant.organization_id).not.toBeNull();
  });

  it('skips cleanly when the permission set is not seeded', async () => {
    stub.tables.sys_permission_set = [];
    stub.tables.sys_member = [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    expect(res.action).toBe('skipped');
    expect(res.reason).toBe('permission_set_missing');
  });
});

describe('backfillOrgAdminGrants', () => {
  it('grants for every owner/admin membership and revokes orphans', async () => {
    const stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o1', role: 'admin' },
        { id: 'm3', user_id: 'u3', organization_id: 'o1', role: 'member' },
      ],
      sys_user_permission_set: [
        // Orphan grant — no matching membership in o2.
        {
          id: 'ups_orphan',
          user_id: 'u4',
          organization_id: 'o2',
          permission_set_id: 'ps_org_admin',
        },
      ],
    });

    const summary = await backfillOrgAdminGrants(stub, WALLED);
    expect(summary.scanned).toBe(3);
    expect(summary.granted).toBe(2);
    expect(summary.revoked).toBe(1);

    const grants = stub.tables.sys_user_permission_set;
    expect(grants).toHaveLength(2);
    const grantedUsers = grants.map((g) => g.user_id).sort();
    expect(grantedUsers).toEqual(['u1', 'u2']);
  });
});

// ---------------------------------------------------------------------------
// [ADR-0105 D4] Posture-selected org-admin variant.
//
// `organization_admin` carries wildcard viewAllRecords/modifyAllRecords, which
// is safe ONLY because Layer 0 bounds it to the caller's organization scope.
// A wall-less posture has no such bound — finding F2: with personal orgs on
// signup, every owner/admin would become an environment-wide superuser — so the
// auto-grant hands out the de-VAMA'd variant there instead.
// ---------------------------------------------------------------------------
describe('[ADR-0105 D4] posture selects the org-admin variant', () => {
  const seedBoth = () =>
    makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [{ id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });

  it('grants the de-VAMA\'d variant under the wall-less `single` posture', async () => {
    const stub = seedBoth();
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');
  });

  it('grants the full set under `isolated` (the wall bounds the superuser bits)', async () => {
    const stub = seedBoth();
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(res.action).toBe('granted');
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');
  });

  it('grants the full set under `group` (the union wall bounds them too)', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'group' });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');
  });

  it('defaults to the de-VAMA\'d variant when no posture is supplied (fail safe)', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1');
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');
  });

  // The F2 close-out: a deployment that drops its wall must not leave the
  // unbounded grant in force. Reconciling converges on exactly one row.
  it('revokes the superseded variant when the posture changes', async () => {
    const stub = seedBoth();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');

    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'single' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin_nb');

    // ...and back again.
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { posture: 'isolated' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);
    expect(stub.tables.sys_user_permission_set[0].permission_set_id).toBe('ps_org_admin');
  });

  it('backfill converges every pair onto the posture\'s variant', async () => {
    const stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [
        { id: 'm1', user_id: 'u1', organization_id: 'o1', role: 'owner' },
        { id: 'm2', user_id: 'u2', organization_id: 'o1', role: 'admin' },
      ],
      // Pre-existing unbounded grants from a previously-walled boot.
      sys_user_permission_set: [
        { id: 'ups1', user_id: 'u1', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
        { id: 'ups2', user_id: 'u2', organization_id: 'o1', permission_set_id: 'ps_org_admin' },
      ],
    });

    await backfillOrgAdminGrants(stub, { posture: 'single' });

    const grants = stub.tables.sys_user_permission_set;
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.permission_set_id === 'ps_org_admin_nb')).toBe(true);
  });
});
