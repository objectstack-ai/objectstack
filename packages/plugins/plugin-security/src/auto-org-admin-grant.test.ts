// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  reconcileOrgAdminGrant,
  backfillOrgAdminGrants,
  AUTO_ORG_ADMIN_GRANT_REASON_PREFIX,
  autoOrgAdminGrantReason,
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

// ---------------------------------------------------------------------------
// [#4586] Hop 2 of the elevation chain stops discarding provenance.
//
// The chain is `sys_member.role` → this reconciler → `sys_user_permission_set`
// → `isTenantAdmin()`. The grant row had a `granted_by` column and wrote `null`
// into it unconditionally, so "why is X a tenant admin" dead-ended one hop in.
// Now the row records BOTH halves of the answer: the human whose better-auth
// call changed the grade (`granted_by`), and the machine writer + the exact
// membership row that triggered it (`reason`).
// ---------------------------------------------------------------------------
describe('[#4586] the auto-grant records its provenance', () => {
  const seed = () =>
    makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [{ id: 'mem_42', user_id: 'u1', organization_id: 'o1', role: 'admin' }],
      sys_user_permission_set: [],
    });

  it('stamps the attributed human into granted_by', async () => {
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, attributedUserId: 'usr_boss' });
    expect(stub.tables.sys_user_permission_set[0].granted_by).toBe('usr_boss');
  });

  it('names the machine writer and the triggering sys_member row in reason', async () => {
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, attributedUserId: 'usr_boss' });
    const reason: string = stub.tables.sys_user_permission_set[0].reason;
    // The marker a reader matches on — one constant, not a re-derived string.
    expect(reason.startsWith(AUTO_ORG_ADMIN_GRANT_REASON_PREFIX)).toBe(true);
    // …and the rest of the chain: which membership, at which grade, to which set.
    expect(reason).toContain('mem_42');
    expect(reason).toContain('admin');
    expect(reason).toContain('organization_admin');
    expect(reason).toBe(
      autoOrgAdminGrantReason({ id: 'mem_42', role: 'admin' }, 'organization_admin'),
    );
  });

  it('a machine-originated grade change leaves granted_by NULL — never a sentinel', async () => {
    // ADR-0118 D1: `granted_by` is a `sys_user` lookup, so the only two legal
    // values are a real id and null. The kernel:ready backfill and any boot
    // bind have no human, and writing 'system' there would break the join and
    // force every reader to special-case it.
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', WALLED);
    const row = stub.tables.sys_user_permission_set[0];
    expect(row.granted_by).toBeNull();
    // The machine provenance is still recorded — in the column that takes text.
    expect(row.reason.startsWith(AUTO_ORG_ADMIN_GRANT_REASON_PREFIX)).toBe(true);
  });

  it('attribution changes nothing about WHETHER the grant happens', async () => {
    // The threaded human is attribution, not authority: a member-grade row does
    // not become grantable because an admin triggered the write.
    const stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [{ id: 'mem_9', user_id: 'u1', organization_id: 'o1', role: 'member' }],
      sys_user_permission_set: [],
    });
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      ...WALLED,
      attributedUserId: 'usr_boss',
    });
    expect(res.action).toBe('noop');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('demotion still revokes — with or without an attributed actor', async () => {
    const stub = seed();
    await reconcileOrgAdminGrant(stub, 'u1', 'o1', { ...WALLED, attributedUserId: 'usr_boss' });
    expect(stub.tables.sys_user_permission_set).toHaveLength(1);

    stub.tables.sys_member = [
      { id: 'mem_42', user_id: 'u1', organization_id: 'o1', role: 'member' },
    ];
    const res = await reconcileOrgAdminGrant(stub, 'u1', 'o1', {
      ...WALLED,
      attributedUserId: 'usr_boss',
    });
    expect(res.action).toBe('revoked');
    expect(stub.tables.sys_user_permission_set).toHaveLength(0);
  });

  it('the backfill grants with no human — it is machine-originated by construction', async () => {
    const stub = makeStub({
      sys_permission_set: [ORG_ADMIN_SET, ORG_ADMIN_NO_BYPASS_SET],
      sys_member: [{ id: 'mem_7', user_id: 'u1', organization_id: 'o1', role: 'owner' }],
      sys_user_permission_set: [],
    });
    await backfillOrgAdminGrants(stub, WALLED);
    const row = stub.tables.sys_user_permission_set[0];
    expect(row.granted_by).toBeNull();
    expect(row.reason).toContain('mem_7');
  });
});
