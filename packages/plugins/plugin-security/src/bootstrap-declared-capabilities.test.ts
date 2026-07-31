// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { bootstrapDeclaredCapabilities } from './bootstrap-declared-capabilities.js';
import { bootstrapSystemCapabilities } from './bootstrap-system-capabilities.js';

/** Minimal in-memory ql for sys_capability seeding with a registry stub. */
function makeQl(declared: any[] = []) {
  const rows: any[] = [];
  return {
    rows,
    // readDeclared() reads engine.registry.listItems(type); stub it so
    // capabilities are surfaced without a metadata service.
    registry: {
      listItems(type: string) {
        return type === 'capability' ? declared.map((c) => ({ content: c })) : [];
      },
    },
    async find(object: string, q: any) {
      if (object !== 'sys_capability') return [];
      const where = q?.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_capability') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      if (object !== 'sys_capability') return;
      const r = rows.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
  };
}

describe('bootstrapDeclaredCapabilities (ADR-0066 D1 package declaration)', () => {
  it('seeds an explicit package declaration with package provenance', async () => {
    const ql = makeQl([
      { name: 'export_data', label: 'Export Data', description: 'Bulk export.', scope: 'org', _packageId: 'com.acme.reports' },
    ]);
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out.seeded).toBe(1);
    expect(out.declaredNames).toEqual(['export_data']);
    const row = ql.rows.find((r) => r.name === 'export_data');
    expect(row).toMatchObject({
      name: 'export_data',
      label: 'Export Data',
      description: 'Bulk export.',
      scope: 'org',
      managed_by: 'package',
      package_id: 'com.acme.reports',
      active: true,
    });
  });

  it('is idempotent + upgrade-aware for its own rows (re-seed, no dup)', async () => {
    const ql = makeQl([{ name: 'billing.refund', label: 'Refund', scope: 'platform', _packageId: 'com.acme.billing' }]);
    await bootstrapDeclaredCapabilities(ql, null);
    // Ship a new label on the next boot.
    (ql as any).registry.listItems = (t: string) =>
      t === 'capability' ? [{ content: { name: 'billing.refund', label: 'Issue Refund', _packageId: 'com.acme.billing' } }] : [];
    const out2 = await bootstrapDeclaredCapabilities(ql, null);
    expect(out2.seeded).toBe(0);
    expect(out2.updated).toBe(1);
    expect(ql.rows.filter((r) => r.name === 'billing.refund')).toHaveLength(1);
    expect(ql.rows.find((r) => r.name === 'billing.refund')?.label).toBe('Issue Refund');
  });

  it('defaults label/description/scope when omitted', async () => {
    const ql = makeQl([{ name: 'approve_invoice', _packageId: 'com.acme.inv' }]);
    await bootstrapDeclaredCapabilities(ql, null);
    const row = ql.rows.find((r) => r.name === 'approve_invoice');
    expect(row.label).toBe('Approve Invoice');
    expect(row.description).toBe('Capability approve_invoice.');
    expect(row.scope).toBe('platform');
  });

  it('refuses to hijack a curated platform capability', async () => {
    const ql = makeQl([{ name: 'manage_users', label: 'Evil', _packageId: 'com.acme.evil' }]);
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out.skippedPlatform).toBe(1);
    expect(out.seeded).toBe(0);
    expect(ql.rows.find((r) => r.name === 'manage_users')).toBeUndefined();
  });

  it('skips a declaration with no owning package', async () => {
    const ql = makeQl([{ name: 'orphan_cap', label: 'Orphan' }]);
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out.seeded).toBe(0);
    expect(ql.rows.find((r) => r.name === 'orphan_cap')).toBeUndefined();
  });

  it('refuses to write into a capability owned by a different package', async () => {
    const ql = makeQl([{ name: 'shared_cap', _packageId: 'com.b' }]);
    ql.rows.push({ id: 'cap_x', name: 'shared_cap', managed_by: 'package', package_id: 'com.a' });
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out.skippedForeign).toBe(1);
    expect(ql.rows.find((r) => r.name === 'shared_cap')?.package_id).toBe('com.a');
  });

  it('never clobbers an admin-authored row', async () => {
    const ql = makeQl([{ name: 'admin_cap', label: 'Ship', _packageId: 'com.a' }]);
    ql.rows.push({ id: 'cap_a', name: 'admin_cap', label: 'Admin Made', managed_by: 'admin' });
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out.skippedAdmin).toBe(1);
    expect(ql.rows.find((r) => r.name === 'admin_cap')?.label).toBe('Admin Made');
  });

  it('CLAIMS a derived-from-systemPermissions platform placeholder', async () => {
    // Simulate the back-compat path: bootstrapSystemCapabilities derived a
    // placeholder from a permission set's systemPermissions.
    const ql = makeQl([{ name: 'export_data', label: 'Export Data', description: 'Nice.', scope: 'org', _packageId: 'com.acme.reports' }]);
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['export_data'] }]);
    const derived = ql.rows.find((r) => r.name === 'export_data');
    expect(derived.managed_by).toBe('platform');
    // Now the explicit declaration claims it.
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out.claimed).toBe(1);
    const claimed = ql.rows.find((r) => r.name === 'export_data');
    expect(claimed).toMatchObject({ managed_by: 'package', package_id: 'com.acme.reports', label: 'Export Data', scope: 'org' });
    expect(ql.rows.filter((r) => r.name === 'export_data')).toHaveLength(1);
  });

  it('declared name suppresses the implicit derived placeholder (no clobber)', async () => {
    // Full boot order: declared first, then system with declaredNames.
    const ql = makeQl([{ name: 'export_data', label: 'Export Data', scope: 'org', _packageId: 'com.acme.reports' }]);
    const cap = await bootstrapDeclaredCapabilities(ql, null);
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['export_data'] }], {
      declaredCapabilityNames: cap.declaredNames,
    });
    const row = ql.rows.find((r) => r.name === 'export_data');
    // The package row is untouched — no humanized placeholder overwrote it.
    expect(row).toMatchObject({ managed_by: 'package', label: 'Export Data', scope: 'org' });
    expect(ql.rows.filter((r) => r.name === 'export_data')).toHaveLength(1);
  });

  it('returns an empty outcome when nothing is declared', async () => {
    const ql = makeQl([]);
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out).toMatchObject({ seeded: 0, updated: 0, claimed: 0, declaredNames: [] });
  });
});
