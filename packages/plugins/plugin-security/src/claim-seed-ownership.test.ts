// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimSeedOwnership } from './claim-seed-ownership.js';

const SYSTEM = 'usr_system';
const ADMIN = 'usr_admin_human';

function makeQL(schemas: any[], rowsByObject: Record<string, any[]>) {
  const updates: { object: string; data: any }[] = [];
  const ql: any = {
    registry: { getAllObjects: () => schemas },
    find: vi.fn(async (object: string, query: any) => {
      const all = rowsByObject[object] ?? [];
      const w = query?.where ?? {};
      if ('owner_id' in w) {
        return all.filter((r) => (r.owner_id ?? null) === (w.owner_id ?? null));
      }
      return all;
    }),
    update: vi.fn(async (object: string, data: any) => {
      updates.push({ object, data });
      const row = (rowsByObject[object] ?? []).find((r) => r.id === data.id);
      if (row) row.owner_id = data.owner_id;
      return row;
    }),
  };
  return { ql, updates };
}

describe('claimSeedOwnership', () => {
  it('returns [] when registry is unavailable', async () => {
    const ql: any = { find: vi.fn(), update: vi.fn() };
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
  });

  it('no-ops when the target is empty or the system user', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const { ql, updates } = makeQL(schemas, { crm_lead: [{ id: 'l1', owner_id: null }] });
    expect(await claimSeedOwnership(ql, '')).toEqual([]);
    expect(await claimSeedOwnership(ql, SYSTEM)).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('skips managedBy and sys_* tables', async () => {
    const schemas = [
      { name: 'sys_user', managedBy: 'better-auth', fields: [{ name: 'owner_id' }] },
      { name: 'sys_widget', fields: [{ name: 'owner_id' }] },
    ];
    const { ql, updates } = makeQL(schemas, {
      sys_user: [{ id: 'u1', owner_id: null }],
      sys_widget: [{ id: 'w1', owner_id: null }],
    });
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('skips external (federated) objects even when they expose owner_id', async () => {
    // Federated read-only objects (ADR-0015) bind to a remote table; the
    // platform must not scan or re-own them — and the remote table may not even
    // exist at boot, so a scan would error with "no such table".
    const schemas = [
      {
        name: 'showcase_ext_customer',
        external: { remoteName: 'customers' },
        fields: [{ name: 'owner_id' }],
      },
    ];
    const { ql, updates } = makeQL(schemas, {
      showcase_ext_customer: [{ id: 'c1', owner_id: null }],
    });
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
    expect(ql.find).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('skips objects without an owner_id field', async () => {
    const schemas = [{ name: 'crm_pricebook', fields: [{ name: 'name' }] }];
    const { ql, updates } = makeQL(schemas, { crm_pricebook: [{ id: 'p1' }] });
    expect(await claimSeedOwnership(ql, ADMIN)).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('re-owns NULL and usr_system rows to the admin, leaving human-owned rows untouched', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const rows = [
      { id: 'l1', owner_id: null },        // claimed (author left unset)
      { id: 'l2', owner_id: SYSTEM },       // claimed (seed identity)
      { id: 'l3', owner_id: 'usr_someone' },// untouched (already human-owned)
    ];
    const { ql, updates } = makeQL(schemas, { crm_lead: rows });
    const result = await claimSeedOwnership(ql, ADMIN);

    expect(result).toEqual([{ object: 'crm_lead', count: 2 }]);
    expect(updates.map((u) => u.data.id).sort()).toEqual(['l1', 'l2']);
    expect(updates.every((u) => u.data.owner_id === ADMIN)).toBe(true);
    expect(rows.find((r) => r.id === 'l3')!.owner_id).toBe('usr_someone');
  });

  it('is idempotent — a second run claims nothing', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }] }];
    const { ql } = makeQL(schemas, { crm_lead: [{ id: 'l1', owner_id: null }] });
    await claimSeedOwnership(ql, ADMIN);
    const second = await claimSeedOwnership(ql, ADMIN);
    expect(second).toEqual([]);
  });
});
