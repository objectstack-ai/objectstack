// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { claimOrphanOrgRows } from './claim-orphan-org-rows.js';

function makeQL(schemas: any[], rowsByObject: Record<string, any[]>) {
  const updates: { object: string; data: any; options: any }[] = [];
  const ql: any = {
    registry: { getAllObjects: () => schemas },
    find: vi.fn(async (object: string, query: any, _options: any) => {
      const all = rowsByObject[object] ?? [];
      // emulate `where: { organization_id: null }`
      if (query?.where?.organization_id === null) {
        return all.filter((r) => r.organization_id == null);
      }
      return all;
    }),
    update: vi.fn(async (object: string, data: any, options: any) => {
      updates.push({ object, data, options });
      const row = (rowsByObject[object] ?? []).find((r) => r.id === data.id);
      if (row) row.organization_id = data.organization_id;
      return row;
    }),
  };
  return { ql, updates };
}

describe('claimOrphanOrgRows', () => {
  it('returns [] when registry is unavailable', async () => {
    const ql: any = { find: vi.fn(), update: vi.fn() };
    const result = await claimOrphanOrgRows(ql, 'org_1');
    expect(result).toEqual([]);
  });

  it('skips schemas with managedBy set', async () => {
    const schemas = [
      { name: 'better_auth_user', managedBy: 'better-auth', fields: [{ name: 'organization_id' }] },
    ];
    const { ql, updates } = makeQL(schemas, {
      better_auth_user: [{ id: 'u1', organization_id: null }],
    });
    const result = await claimOrphanOrgRows(ql, 'org_1');
    expect(updates).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it('skips sys_-prefixed schemas even without managedBy', async () => {
    const schemas = [
      { name: 'sys_permission_set', fields: [{ name: 'organization_id' }] },
    ];
    const { ql, updates } = makeQL(schemas, {
      sys_permission_set: [{ id: 'ps1', organization_id: null }],
    });
    await claimOrphanOrgRows(ql, 'org_1');
    expect(updates).toHaveLength(0);
  });

  it('skips schemas without an organization_id field', async () => {
    const schemas = [{ name: 'global_setting', fields: [{ name: 'key' }, { name: 'value' }] }];
    const { ql, updates } = makeQL(schemas, {
      global_setting: [{ id: 's1' }],
    });
    await claimOrphanOrgRows(ql, 'org_1');
    expect(updates).toHaveLength(0);
  });

  it('updates only orphan rows and reports per-object counts', async () => {
    const schemas = [
      { name: 'lead', fields: [{ name: 'organization_id' }] },
      { name: 'account', fields: [{ name: 'organization_id' }] },
    ];
    const { ql, updates } = makeQL(schemas, {
      lead: [
        { id: 'l1', organization_id: null },
        { id: 'l2', organization_id: null },
        { id: 'l3', organization_id: 'org_other' },
      ],
      account: [{ id: 'a1', organization_id: null }],
    });
    const result = await claimOrphanOrgRows(ql, 'org_1');
    expect(updates).toHaveLength(3);
    expect(updates.every((u) => u.options.context?.isSystem === true)).toBe(true);
    expect(updates.every((u) => u.data.organization_id === 'org_1')).toBe(true);
    expect(result).toEqual([
      { object: 'lead', count: 2 },
      { object: 'account', count: 1 },
    ]);
  });

  it('continues past rows whose update throws (e.g. user hooks)', async () => {
    const schemas = [{ name: 'quote', fields: [{ name: 'organization_id' }] }];
    const ql: any = {
      registry: { getAllObjects: () => schemas },
      find: vi.fn(async () => [
        { id: 'q1', organization_id: null },
        { id: 'q2', organization_id: null },
      ]),
      update: vi.fn(async (_o: string, data: any) => {
        if (data.id === 'q1') throw new Error('hook rejected');
        return { id: data.id };
      }),
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await claimOrphanOrgRows(ql, 'org_1', { logger });
    expect(result).toEqual([{ object: 'quote', count: 1 }]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('claim failed for quote:q1'),
      expect.objectContaining({ error: 'hook rejected' }),
    );
  });

  it('is a no-op when no orphans exist', async () => {
    const schemas = [{ name: 'lead', fields: [{ name: 'organization_id' }] }];
    const { ql, updates } = makeQL(schemas, {
      lead: [{ id: 'l1', organization_id: 'org_other' }],
    });
    const result = await claimOrphanOrgRows(ql, 'org_1');
    expect(updates).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it('returns [] when ql lacks find/update', async () => {
    const result = await claimOrphanOrgRows({} as any, 'org_1');
    expect(result).toEqual([]);
  });
});
