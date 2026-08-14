// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0081 D1 — the default-org bootstrap helper (open home: plugin-auth).
// Covers the idempotency short-circuits, the create/reuse paths, and the
// injectable seed-ownership step (enterprise injects it; open path omits it).

import { describe, it, expect, vi } from 'vitest';
import { ensureDefaultOrganization } from './ensure-default-organization.js';

type Row = Record<string, any>;

function makeQl(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
    sys_user_permission_set: [
      { id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
    ],
    sys_member: [],
    sys_organization: [],
    ...seed,
  };
  const matches = (row: Row, where: Row) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return v === null ? row[k] == null : row[k] === v;
    });
  return {
    tables,
    find: vi.fn(async (object: string, q: any) =>
      (tables[object] ?? []).filter((r) => matches(r, q?.where)).slice(0, q?.limit ?? 100),
    ),
    insert: vi.fn(async (object: string, data: Row) => {
      (tables[object] ??= []).push(data);
      return data;
    }),
  };
}

describe('ensureDefaultOrganization (plugin-auth home)', () => {
  it('creates the default org and binds the admin as owner', async () => {
    const ql = makeQl();
    const res = await ensureDefaultOrganization(ql);
    expect(res.defaultOrgCreated).toBe(true);
    expect(res.memberCreated).toBe(true);
    expect(ql.tables.sys_organization[0]).toMatchObject({ slug: 'default', name: 'Default Organization' });
    expect(ql.tables.sys_member[0]).toMatchObject({ user_id: 'u1', role: 'owner', organization_id: res.defaultOrgId });
  });

  it('no-ops when there is no platform admin yet', async () => {
    const ql = makeQl({ sys_user_permission_set: [] });
    const res = await ensureDefaultOrganization(ql);
    expect(res).toMatchObject({ defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' });
    expect(ql.insert).not.toHaveBeenCalled();
  });

  it('respects an admin who already belongs to an org', async () => {
    const ql = makeQl({ sys_member: [{ id: 'm0', user_id: 'u1', organization_id: 'org_x' }] });
    const res = await ensureDefaultOrganization(ql);
    expect(res.reason).toBe('admin_already_in_org');
    expect(ql.insert).not.toHaveBeenCalled();
  });

  it('reuses a pre-existing slug=default org instead of minting a new one', async () => {
    const ql = makeQl({ sys_organization: [{ id: 'org_default', slug: 'default', name: 'Default Organization' }] });
    const res = await ensureDefaultOrganization(ql);
    expect(res.defaultOrgCreated).toBe(false);
    expect(res.defaultOrgId).toBe('org_default');
    expect(res.memberCreated).toBe(true);
  });

  it('picks the OLDEST cross-tenant admin grant', async () => {
    const ql = makeQl({
      sys_user_permission_set: [
        { id: 'b', user_id: 'u_newer', permission_set_id: 'ps_admin', organization_id: null, created_at: '2026-01-02T00:00:00Z' },
        { id: 'a', user_id: 'u_older', permission_set_id: 'ps_admin', organization_id: null, created_at: '2026-01-01T00:00:00Z' },
      ],
    });
    await ensureDefaultOrganization(ql);
    expect(ql.tables.sys_member[0].user_id).toBe('u_older');
  });

  it('runs the injected claimSeedOwnership step (enterprise path) and reports the count', async () => {
    const ql = makeQl();
    const claim = vi.fn(async () => [{ count: 3 }, { count: 2 }]);
    const res = await ensureDefaultOrganization(ql, { claimSeedOwnership: claim });
    expect(claim).toHaveBeenCalledWith(ql, res.defaultOrgId, 'u1', expect.any(Object));
    expect(res.ownershipClaimed).toBe(5);
  });

  it('skips seed-ownership when not injected (open single-org path)', async () => {
    const res = await ensureDefaultOrganization(makeQl());
    expect(res.ownershipClaimed).toBe(0);
  });

  it('a failing injected claim never undoes the owner bind', async () => {
    const ql = makeQl();
    const res = await ensureDefaultOrganization(ql, {
      claimSeedOwnership: vi.fn(async () => { throw new Error('seed pipeline down'); }),
    });
    expect(res.memberCreated).toBe(true);
    expect(ql.tables.sys_member).toHaveLength(1);
  });
});
