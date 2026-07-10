// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — permission-set materialization, focused on the
 * insert-once vs `resync` (#2705) split.
 *
 * The default boot path is insert-once: an existing default permission-set row
 * is env-authored config and is never clobbered on restart (so admin Setup
 * edits survive). That protection is CORRECT for prod but makes a dev source
 * edit silently stale until a `--fresh` wipe. `os meta resync` passes
 * `{ resync: true }` to reconcile platform-owned rows to the shipped dist
 * without touching business data — while still refusing to overwrite a row an
 * admin or a package has explicitly taken over.
 */

import { describe, it, expect } from 'vitest';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';

/** Minimal in-memory ql. Only `sys_permission_set` is modeled; the admin-
 *  promotion tables return empty, so promotion short-circuits and we assert the
 *  seed/resync outcome (carried on every return) directly. */
function makeQl(seedRows: any[] = []) {
  const rows: any[] = seedRows.map((r) => ({ ...r }));
  return {
    rows,
    async find(object: string, q: any) {
      if (object !== 'sys_permission_set') return [];
      const where = q?.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_permission_set') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      if (object !== 'sys_permission_set') return;
      const r = rows.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
  };
}

/** Shipped declaration: member_default now grants `setup.access`. */
const memberDefault = (over: Record<string, any> = {}) =>
  ({
    name: 'member_default',
    label: 'Member',
    objects: { crm_lead: { allowRead: true } },
    systemPermissions: ['setup.access'],
    ...over,
  }) as any;

const row = (ql: ReturnType<typeof makeQl>) => ql.rows.find((x) => x.name === 'member_default');

describe('bootstrapPlatformAdmin — insert-once vs resync (#2705)', () => {
  it('default (no resync): leaves an existing row stale — the deliberate insert-once posture', async () => {
    const ql = makeQl([
      { id: 'ps_old', name: 'member_default', system_permissions: '[]', object_permissions: '{}' },
    ]);
    const r = await bootstrapPlatformAdmin(ql, [memberDefault()]);
    expect(r.resynced).toBe(0);
    // Same row, and the shipped `setup.access` did NOT land — this is the
    // #2705 boot behavior (protects admin edits; stale in the dev loop).
    expect(row(ql)!.id).toBe('ps_old');
    expect(row(ql)!.system_permissions).toBe('[]');
  });

  it('resync: reconciles a platform-owned row to the shipped declaration in place', async () => {
    const ql = makeQl([
      { id: 'ps_old', name: 'member_default', system_permissions: '[]', object_permissions: '{}', managed_by: null },
    ]);
    const r = await bootstrapPlatformAdmin(ql, [memberDefault()], { resync: true });
    expect(r.resynced).toBe(1);
    expect(r.resyncSkipped).toBe(0);
    // Updated in place (no new insert), and the declaration is now live.
    expect(ql.rows.filter((x) => x.name === 'member_default')).toHaveLength(1);
    expect(row(ql)!.id).toBe('ps_old');
    expect(JSON.parse(row(ql)!.system_permissions)).toEqual(['setup.access']);
    expect(JSON.parse(row(ql)!.object_permissions)).toEqual({ crm_lead: { allowRead: true } });
  });

  it('resync: leaves an admin-owned (managed_by:user) row untouched', async () => {
    const ql = makeQl([
      { id: 'ps_custom', name: 'member_default', system_permissions: '["custom.perm"]', managed_by: 'user' },
    ]);
    const r = await bootstrapPlatformAdmin(ql, [memberDefault()], { resync: true });
    expect(r.resynced).toBe(0);
    expect(r.resyncSkipped).toBe(1);
    expect(row(ql)!.system_permissions).toBe('["custom.perm"]');
  });

  it('resync: leaves a package-owned row untouched', async () => {
    const ql = makeQl([
      { id: 'ps_pkg', name: 'member_default', system_permissions: '[]', managed_by: 'package', package_id: 'com.x' },
    ]);
    const r = await bootstrapPlatformAdmin(ql, [memberDefault()], { resync: true });
    expect(r.resynced).toBe(0);
    expect(r.resyncSkipped).toBe(1);
  });

  it('resync: inserts a set that does not exist yet (nothing to reconcile)', async () => {
    const ql = makeQl([]);
    const r = await bootstrapPlatformAdmin(ql, [memberDefault()], { resync: true });
    expect(r.resynced).toBe(0);
    expect(row(ql)).toBeTruthy();
    expect(JSON.parse(row(ql)!.system_permissions)).toEqual(['setup.access']);
  });
});
