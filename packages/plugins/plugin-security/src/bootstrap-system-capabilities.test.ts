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

// ───────────────────────────────────────────────────────────────────────────
// [#5876] The DERIVED half reconciles display fields only on rows it OWNS.
//
// The seed loop used to refresh `label`/`description` on whatever row it found
// for a derived name, whatever its provenance — while the comment above it said
// admin edits were not clobbered. For a derived name `label` is `humanize(name)`
// and `description` is `Capability <name>.`, so an admin-authored row was
// rewritten to a humanized placeholder on EVERY boot (silent data loss; the
// reachable chain is: admin creates the capability in Setup → an app whose
// bootstrap permission set grants it by name is installed → every boot after).
//
// The CURATED half keeps refreshing (the platform ships new copy for its own
// definitions — pinned by 'does NOT clobber an admin-edited scope on re-seed'
// above); only the derived half is guarded, so these pins must DISCRIMINATE
// rather than just prove nothing is written.
// ───────────────────────────────────────────────────────────────────────────
describe('derived defaults never clobber an authored row (#5876)', () => {
  const OPS_SETS = [{ systemPermissions: ['showcase.export_data'] }];
  const AUTHORED = { label: 'Admin Made', description: 'Admin wrote this.' };

  /** A pre-existing row for a name the derivation would otherwise derive. */
  function seedRow(ql: ReturnType<typeof makeQl>, managed_by: string | undefined) {
    ql.rows.push({
      id: 'cap_existing',
      name: 'showcase.export_data',
      ...AUTHORED,
      scope: 'org',
      ...(managed_by === undefined ? {} : { managed_by }),
      active: true,
    });
  }

  it('leaves an ADMIN-authored row untouched', async () => {
    const ql = makeQl();
    seedRow(ql, 'admin');
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      ...AUTHORED, managed_by: 'admin', scope: 'org',
    });
    expect(out.skippedAuthored).toBe(1);
    // The skip is a SKIP, not a silent failed write: it is not counted as an update.
    expect(ql.rows.filter((r) => r.name === 'showcase.export_data')).toHaveLength(1);
  });

  it('leaves a PACKAGE-authored row untouched', async () => {
    const ql = makeQl();
    ql.rows.push({
      id: 'cap_pkg', name: 'showcase.export_data', label: 'Export Data', description: 'Bulk export.',
      managed_by: 'package', package_id: 'com.acme.reports', active: true,
    });
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Export Data', description: 'Bulk export.', managed_by: 'package', package_id: 'com.acme.reports',
    });
    expect(out.skippedAuthored).toBe(1);
  });

  it('leaves a row of UNKNOWN provenance untouched (the field defaults to admin)', async () => {
    // `sys_capability.managed_by` is required with `defaultValue: 'admin'`, so a
    // row that reaches this pass without one is not a platform placeholder —
    // "not provably ours" resolves to leave-it-alone, never to overwrite.
    const ql = makeQl();
    seedRow(ql, undefined);
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject(AUTHORED);
    expect(out.skippedAuthored).toBe(1);
  });

  it('POSITIVE CONTROL: still refreshes its OWN platform placeholder', async () => {
    // Same fixture, same grant — only the provenance differs. A guard that also
    // switched this case off would be indistinguishable from deleting the
    // reconcile, so this is what gives the three pins above their teeth.
    const ql = makeQl();
    seedRow(ql, 'platform');
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Showcase Export Data', description: 'Capability showcase.export_data.', managed_by: 'platform',
    });
    expect(out.skippedAuthored).toBe(0);
    expect(out.updated).toBeGreaterThanOrEqual(1);
    // [#2909 T3] `scope` stays seed-once even on a row this pass owns.
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')?.scope).toBe('org');
  });

  it('stays stable across boots: derive, then never re-write the row again', async () => {
    const ql = makeQl();
    const boot1 = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(boot1.seeded).toBe(KNOWN_CAPABILITIES.length + 1);
    // An admin renames the derived placeholder… which the platform/package write
    // guard actually refuses today (see #5876's reachability note), so simulate
    // the storage effect only, and re-boot.
    const row = ql.rows.find((r) => r.name === 'showcase.export_data')!;
    row.label = 'Renamed By Admin';
    row.managed_by = 'admin';
    const boot2 = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(row.label).toBe('Renamed By Admin');
    expect(boot2.seeded).toBe(0);
    expect(boot2.skippedAuthored).toBe(1);
  });

  it('the guard is scoped to the DERIVED half — curated names still refresh', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, []);
    const curated = KNOWN_CAPABILITIES[0];
    const row = ql.rows.find((r) => r.name === curated.name)!;
    row.label = 'stale label';
    row.description = 'stale description';
    const out = await bootstrapSystemCapabilities(ql, []);
    expect(row.label).toBe(curated.label);
    expect(row.description).toBe(curated.description);
    expect(out.skippedAuthored).toBe(0);
  });
});
