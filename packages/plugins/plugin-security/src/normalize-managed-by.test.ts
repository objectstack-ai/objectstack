// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { normalizeManagedByVocab } from './normalize-managed-by.js';

/**
 * A4 #2920 — the boot reconciler that heals legacy `managed_by` values on the
 * RBAC catalogs onto the unified platform/package/admin vocabulary.
 */
function makeQl() {
  const tables: Record<string, any[]> = {
    sys_position: [],
    sys_permission_set: [],
  };
  return {
    tables,
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      return (tables[object] ?? []).filter((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
    },
    async update(object: string, data: any) {
      const row = (tables[object] ?? []).find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

describe('normalizeManagedByVocab (A4 #2920)', () => {
  it('rewrites legacy position values system/config/user -> platform/package/admin', async () => {
    const ql = makeQl();
    ql.tables.sys_position.push(
      { id: 'p1', managed_by: 'system' },
      { id: 'p2', managed_by: 'config' },
      { id: 'p3', managed_by: 'user' },
      { id: 'p4', managed_by: 'platform' }, // already canonical
    );
    const res = await normalizeManagedByVocab(ql);
    expect(res.positions).toBe(3);
    expect(ql.tables.sys_position.map((r) => r.managed_by).sort()).toEqual([
      'admin',
      'package',
      'platform',
      'platform',
    ]);
  });

  it('rewrites legacy permission-set value user -> admin, leaving platform/package untouched', async () => {
    const ql = makeQl();
    ql.tables.sys_permission_set.push(
      { id: 's1', managed_by: 'user' },
      { id: 's2', managed_by: 'package' },
      { id: 's3', managed_by: 'platform' },
      { id: 's4', managed_by: 'admin' },
    );
    const res = await normalizeManagedByVocab(ql);
    expect(res.permissionSets).toBe(1);
    expect(ql.tables.sys_permission_set.find((r) => r.id === 's1')!.managed_by).toBe('admin');
    expect(ql.tables.sys_permission_set.find((r) => r.id === 's2')!.managed_by).toBe('package');
  });

  it('is idempotent — a second run is a no-op', async () => {
    const ql = makeQl();
    ql.tables.sys_position.push({ id: 'p1', managed_by: 'system' });
    ql.tables.sys_permission_set.push({ id: 's1', managed_by: 'user' });
    await normalizeManagedByVocab(ql);
    const res2 = await normalizeManagedByVocab(ql);
    expect(res2).toEqual({ positions: 0, permissionSets: 0 });
  });

  it('tolerates a ql without find/update', async () => {
    expect(await normalizeManagedByVocab(null as any)).toEqual({ positions: 0, permissionSets: 0 });
    expect(await normalizeManagedByVocab({} as any)).toEqual({ positions: 0, permissionSets: 0 });
  });
});
