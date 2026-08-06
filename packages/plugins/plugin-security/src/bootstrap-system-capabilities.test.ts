// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { bootstrapSystemCapabilities, KNOWN_CAPABILITIES } from './bootstrap-system-capabilities.js';

/** Minimal in-memory ql for sys_capability seeding. */
function makeQl() {
  const rows: any[] = [];
  return {
    rows,
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

describe('bootstrapSystemCapabilities (ADR-0066 D1 back-compat seed)', () => {
  it('seeds the curated platform capabilities as records (idempotent)', async () => {
    const ql = makeQl();
    const r1 = await bootstrapSystemCapabilities(ql, []);
    expect(r1.seeded).toBe(KNOWN_CAPABILITIES.length);
    // every known capability is now a row with managed_by=platform + active
    for (const cap of KNOWN_CAPABILITIES) {
      const row = ql.rows.find((x) => x.name === cap.name);
      expect(row).toBeDefined();
      expect(row.managed_by).toBe('platform');
      expect(row.active).toBe(true);
      expect(row.scope).toBe(cap.scope);
    }
    // re-run → no new inserts (idempotent)
    const r2 = await bootstrapSystemCapabilities(ql, []);
    expect(r2.seeded).toBe(0);
    expect(ql.rows.length).toBe(KNOWN_CAPABILITIES.length);
  });

  it('derives extra capabilities referenced by permission sets', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['manage_users', 'export_data', 'approve_invoice'] }]);
    expect(ql.rows.find((x) => x.name === 'export_data')).toBeDefined();
    expect(ql.rows.find((x) => x.name === 'approve_invoice')).toBeDefined();
    // org-scoped known capability keeps its scope
    expect(ql.rows.find((x) => x.name === 'manage_org_users')?.scope).toBe('org');
  });

  it('does NOT derive a placeholder for an already-materialized capability', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['export_data', 'approve_invoice'] }], {
      materializedCapabilityNames: ['export_data'],
    });
    // `export_data` is owned by the declared seeder — no platform placeholder.
    expect(ql.rows.find((x: any) => x.name === 'export_data')).toBeUndefined();
    // `approve_invoice` is still derived as before.
    expect(ql.rows.find((x: any) => x.name === 'approve_invoice')).toBeDefined();
  });

  // [#2909 T3] `scope` is an admin-editable classification face — seed-once.
  it('does NOT clobber an admin-edited scope on re-seed (label/description still refresh)', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, []);
    const cap = KNOWN_CAPABILITIES[0];
    const row = ql.rows.find((x) => x.name === cap.name)!;
    // Admin reclassifies the capability and tweaks nothing else.
    row.scope = row.scope === 'org' ? 'platform' : 'org';
    const adminScope = row.scope;
    row.label = 'stale label';
    await bootstrapSystemCapabilities(ql, []);
    expect(row.scope).toBe(adminScope); // admin's edit survives the boot
    expect(row.label).toBe(cap.label); // platform display fields refreshed
  });

  it('still writes scope on first insert', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, []);
    for (const cap of KNOWN_CAPABILITIES) {
      expect(ql.rows.find((x) => x.name === cap.name)?.scope).toBe(cap.scope);
    }
  });

  it('marks manage_org_users as org-scoped and the rest platform', () => {
    const org = KNOWN_CAPABILITIES.find((c) => c.name === 'manage_org_users');
    expect(org?.scope).toBe('org');
    expect(KNOWN_CAPABILITIES.filter((c) => c.scope === 'platform').length).toBeGreaterThanOrEqual(5);
  });
});
