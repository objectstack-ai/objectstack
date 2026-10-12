// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';
// The fake engines below open `update()` with `assertEngineUpdateDispatch`
// (`pnpm check:engine-double-contract`). A double looser than the real
// `ObjectQLEngine.update` is how a dead write path ships with its suite green;
// one call pins these fakes to the producer's rejection surface and, unlike a
// mirrored `if`, cannot drift when that rule changes.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

const ORG = 'org_1';
const OWNER = 'usr_admin';

function makeQL(schemas: any[], rowsByObject: Record<string, any[]>) {
  const updates: { object: string; data: any }[] = [];
  const ql: any = {
    registry: { getAllObjects: () => schemas },
    find: vi.fn(async (object: string, query: any) => {
      const all = rowsByObject[object] ?? [];
      const w = query?.where ?? {};
      return all.filter((r) => {
        if ('organization_id' in w && (r.organization_id ?? null) !== (w.organization_id ?? null)) return false;
        if ('owner_id' in w && (r.owner_id ?? null) !== (w.owner_id ?? null)) return false;
        return true;
      });
    }),
    update: vi.fn(async (object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      updates.push({ object, data });
      const row = (rowsByObject[object] ?? []).find((r) => r.id === data.id);
      if (row) row.owner_id = data.owner_id;
      return row;
    }),
  };
  return { ql, updates };
}

describe('claimOrgSeedOwnership', () => {
  it('returns [] when registry is unavailable', async () => {
    const ql: any = { find: vi.fn(), update: vi.fn() };
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([]);
  });

  it('no-ops without an org or owner', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] }];
    const { ql, updates } = makeQL(schemas, { crm_lead: [{ id: 'l1', organization_id: ORG, owner_id: null }] });
    expect(await claimOrgSeedOwnership(ql, '', OWNER)).toEqual([]);
    expect(await claimOrgSeedOwnership(ql, ORG, '')).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('skips managedBy / sys_* and objects missing owner_id or organization_id', async () => {
    const schemas = [
      { name: 'sys_user', managedBy: 'better-auth', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] },
      { name: 'sys_widget', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] },
      { name: 'crm_pricebook', fields: [{ name: 'organization_id' }] }, // no owner_id
      { name: 'crm_global', fields: [{ name: 'owner_id' }] }, // no organization_id
    ];
    const { ql, updates } = makeQL(schemas, {
      sys_user: [{ id: 'u1', organization_id: ORG, owner_id: null }],
      sys_widget: [{ id: 'w1', organization_id: ORG, owner_id: null }],
      crm_pricebook: [{ id: 'p1', organization_id: ORG }],
      crm_global: [{ id: 'g1', owner_id: null }],
    });
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('claims this org\'s NULL-owner rows only, leaving other orgs and human-owned rows untouched', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] }];
    const rows = [
      { id: 'l1', organization_id: ORG, owner_id: null },          // claimed
      { id: 'l2', organization_id: ORG, owner_id: 'usr_someone' }, // already owned — untouched
      { id: 'l3', organization_id: 'org_2', owner_id: null },      // other org — untouched
    ];
    const { ql, updates } = makeQL(schemas, { crm_lead: rows });
    const result = await claimOrgSeedOwnership(ql, ORG, OWNER);

    expect(result).toEqual([{ object: 'crm_lead', count: 1 }]);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toMatchObject({ id: 'l1', owner_id: OWNER });
    expect(rows.find((r) => r.id === 'l2')!.owner_id).toBe('usr_someone');
    expect(rows.find((r) => r.id === 'l3')!.owner_id).toBeNull();
  });

  it('is idempotent — a second run claims nothing', async () => {
    const schemas = [{ name: 'crm_lead', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] }];
    const { ql } = makeQL(schemas, { crm_lead: [{ id: 'l1', organization_id: ORG, owner_id: null }] });
    await claimOrgSeedOwnership(ql, ORG, OWNER);
    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([]);
  });

  // ── [#23008] the claim's write dispatches no metadata-bound automation ────

  it('every claim write runs as isSystem with skipAutomations; the read stays a plain system read', async () => {
    // Re-owning a seed row is attribution, not a user event, so the write runs
    // with metadata-bound automation off: no app hook, no record-change flow,
    // hence no approval and no notification. Code-registered hooks (audit,
    // sharing) still run — the real-engine half of this pin is
    // `claim-org-seed-ownership-dispatch.pin.test.ts`; this half pins that
    // EVERY write this function issues carries the flag, across objects.
    const schemas = [
      { name: 'crm_lead', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] },
      { name: 'crm_deal', fields: [{ name: 'owner_id' }, { name: 'organization_id' }] },
    ];
    const { ql, updates } = makeQL(schemas, {
      crm_lead: [
        { id: 'l1', organization_id: ORG, owner_id: null },
        { id: 'l2', organization_id: ORG, owner_id: null },
      ],
      crm_deal: [{ id: 'd1', organization_id: ORG, owner_id: null }],
    });

    expect(await claimOrgSeedOwnership(ql, ORG, OWNER)).toEqual([
      { object: 'crm_lead', count: 2 },
      { object: 'crm_deal', count: 1 },
    ]);
    expect(updates).toHaveLength(3);

    const writeContexts = ql.update.mock.calls.map((call: any[]) => call[2]?.context);
    expect(writeContexts).toHaveLength(3);
    for (const context of writeContexts) {
      expect(context).toEqual({ isSystem: true, skipAutomations: true });
    }
    // The read stays a plain system read: a read starts no record-change flow,
    // and the flag would also switch off an app's read-filter hooks.
    const readContexts = ql.find.mock.calls.map((call: any[]) => call[2]?.context);
    expect(readContexts).toHaveLength(2);
    for (const context of readContexts) {
      expect(context).toEqual({ isSystem: true });
    }
  });
});
