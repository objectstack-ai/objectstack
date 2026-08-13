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
    //
    // [#8378] Items are surfaced as the real engine surfaces them — the
    // document itself, not a `{ content: <item> }` box that nothing produces.
    registry: {
      listItems(type: string) {
        return type === 'capability' ? [...declared] : [];
      },
    },
    async find(object: string, q: any) {
      if (object !== 'sys_capability') return [];
      const where = q?.where ?? {};
      // [#8470] A `null` comparand is IS NULL, not `=== null`: `driver-sql`
      // compiles `{ field: null }` to `IS NULL`, `driver-memory`'s matcher uses
      // `value == condition`, and MongoDB matches null-or-missing — none of them
      // is strict equality against an ABSENT key. `bootstrapSystemCapabilities`
      // (called by several cases below) scopes its curated lookup with
      // `organization_id: null`, which strict `===` would make unsatisfiable
      // here while it works in production.
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => (v === null ? r[k] == null : r[k] === v)),
      );
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
    expect(out.materializedNames).toEqual(['export_data']);
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
      t === 'capability' ? [{ name: 'billing.refund', label: 'Issue Refund', _packageId: 'com.acme.billing' }] : [];
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
    expect(out.skippedUnowned).toBe(1);
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
    // Full boot order: declared first, then system with materializedNames.
    const ql = makeQl([{ name: 'export_data', label: 'Export Data', scope: 'org', _packageId: 'com.acme.reports' }]);
    const cap = await bootstrapDeclaredCapabilities(ql, null);
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['export_data'] }], {
      materializedCapabilityNames: cap.materializedNames,
    });
    const row = ql.rows.find((r) => r.name === 'export_data');
    // The package row is untouched — no humanized placeholder overwrote it.
    expect(row).toMatchObject({ managed_by: 'package', label: 'Export Data', scope: 'org' });
    expect(ql.rows.filter((r) => r.name === 'export_data')).toHaveLength(1);
  });

  it('returns an empty outcome when nothing is declared', async () => {
    const ql = makeQl([]);
    const out = await bootstrapDeclaredCapabilities(ql, null);
    expect(out).toMatchObject({ seeded: 0, updated: 0, claimed: 0, skippedUnowned: 0, materializedNames: [] });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#4967 Part 1] A REFUSED declaration must not suppress the back-compat
// derivation. `materializedNames` reports the names this pass CONFIRMED have a
// row — the three refusal paths land on different sides of that line, for
// different reasons, so each gets its own pin (and, where the direction is not
// obvious, the reverse case that shows what the other answer would cost).
// ───────────────────────────────────────────────────────────────────────────
describe('refused declarations vs. the derived placeholder (#4967 Part 1)', () => {
  const OPS_SETS = [{ name: 'showcase_ops', systemPermissions: ['setup.access', 'showcase.export_data'] }];

  it('NO OWNING PACKAGE + no row: falls through, so the derivation materializes it', async () => {
    // The showcase repro: `showcase.export_data` declared without a resolvable
    // owner, granted by `showcase_ops`.
    const ql = makeQl([{ name: 'showcase.export_data', label: 'Export Data' }]);
    const out = await bootstrapDeclaredCapabilities(ql, null, { permissionSets: OPS_SETS });

    // The declaration is refused — no package row, and (the fix) the name is
    // NOT reported as materialized.
    expect(out.seeded).toBe(0);
    expect(out.skippedUnowned).toBe(1);
    expect(out.materializedNames).toEqual([]);

    // Second pass — the capability now exists, as the back-compat placeholder
    // it would have had if the declaration had never been written.
    await bootstrapSystemCapabilities(ql, OPS_SETS, { materializedCapabilityNames: out.materializedNames });
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      name: 'showcase.export_data', managed_by: 'platform', active: true,
    });
    // …and it RESOLVES by name, which is what the granting permission set needs
    // from the registry (Setup listing, provenance, ADR-0066 ⑨ lint sources).
    expect(await ql.find('sys_capability', { where: { name: 'showcase.export_data' } })).toHaveLength(1);
  });

  it('REVERSE: the pre-#4967 list (every declared name) leaves the capability in no row at all', async () => {
    // Same fixture, same second pass — only the skip list is the old one, which
    // reported a name the first pass refused to write. Nothing derives it and
    // nothing declared it: the hole.
    const ql = makeQl([{ name: 'showcase.export_data', label: 'Export Data' }]);
    await bootstrapDeclaredCapabilities(ql, null, { permissionSets: OPS_SETS });
    await bootstrapSystemCapabilities(ql, OPS_SETS, {
      materializedCapabilityNames: ['showcase.export_data'], // ← the old `declaredNames`
    });
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toBeUndefined();
  });

  it('is stable across boots: the refusal re-derives nothing and duplicates nothing', async () => {
    const ql = makeQl([{ name: 'showcase.export_data', label: 'Export Data' }]);
    for (let boot = 0; boot < 2; boot += 1) {
      const out = await bootstrapDeclaredCapabilities(ql, null, { permissionSets: OPS_SETS });
      await bootstrapSystemCapabilities(ql, OPS_SETS, { materializedCapabilityNames: out.materializedNames });
    }
    expect(ql.rows.filter((r) => r.name === 'showcase.export_data')).toHaveLength(1);
    // Boot 2 finds the placeholder, so the refusal now reports the name — the
    // row exists and must not be re-derived over.
    const out2 = await bootstrapDeclaredCapabilities(ql, null, { permissionSets: OPS_SETS });
    expect(out2.skippedUnowned).toBe(1);
    expect(out2.materializedNames).toEqual(['showcase.export_data']);
  });

  it('NO OWNING PACKAGE + an admin row: still suppresses, so the placeholder cannot clobber it', async () => {
    const ql = makeQl([{ name: 'showcase.export_data', label: 'Declared Label' }]);
    ql.rows.push({ id: 'cap_admin', name: 'showcase.export_data', label: 'Admin Made', description: 'Admin wrote this.', managed_by: 'admin' });
    const out = await bootstrapDeclaredCapabilities(ql, null, { permissionSets: OPS_SETS });
    expect(out.skippedUnowned).toBe(1);
    expect(out.materializedNames).toEqual(['showcase.export_data']);
    await bootstrapSystemCapabilities(ql, OPS_SETS, { materializedCapabilityNames: out.materializedNames });
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Admin Made', description: 'Admin wrote this.', managed_by: 'admin',
    });
  });

  it('SECOND LAYER (#5876): dropping that name from the list no longer overwrites the admin row', async () => {
    // This pin was written by #5875 (as `REVERSE: dropping that name from the
    // list lets the derivation overwrite the admin row`) to justify why the
    // unowned path checks for an EXISTING row instead of always falling
    // through: back then the derived defaults refreshed label/description on
    // ANY row they found, so the skip list was the ONLY thing standing between
    // an admin-authored row and a humanized placeholder. That fact is fixed —
    // #5876 guards the derived reconcile by `managed_by`, so the write site
    // now refuses the clobber even when the call site forgets to suppress it.
    //
    // The suppression list keeps its job (it is what states the boot-order
    // contract, and it stops the derivation doing work on names another pass
    // owns), but it is no longer load-bearing for THIS shape — which is the
    // point of a second layer.
    const ql = makeQl([]);
    ql.rows.push({ id: 'cap_admin', name: 'showcase.export_data', label: 'Admin Made', description: 'Admin wrote this.', managed_by: 'admin' });
    await bootstrapSystemCapabilities(ql, OPS_SETS, { materializedCapabilityNames: [] });
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Admin Made', description: 'Admin wrote this.', managed_by: 'admin',
    });
  });

  it('DISCRIMINATION (#5876): with the name dropped, a PLATFORM placeholder is still refreshed', async () => {
    // The guard above must not read as "the derivation stopped writing". Same
    // fixture, same empty skip list, provenance flipped to the one the derived
    // pass owns → the reconcile happens exactly as it always did.
    const ql = makeQl([]);
    ql.rows.push({ id: 'cap_derived', name: 'showcase.export_data', label: 'Stale Placeholder', description: 'Stale.', managed_by: 'platform' });
    await bootstrapSystemCapabilities(ql, OPS_SETS, { materializedCapabilityNames: [] });
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Showcase Export Data', description: 'Capability showcase.export_data.', managed_by: 'platform',
    });
  });

  it('FOREIGN owner: suppresses, because the other package authored that row', async () => {
    const sets = [{ name: 'ops', systemPermissions: ['shared_cap'] }];
    const ql = makeQl([{ name: 'shared_cap', label: 'Mine', _packageId: 'com.b' }]);
    ql.rows.push({ id: 'cap_x', name: 'shared_cap', label: 'Owner Label', description: 'Owner wrote this.', managed_by: 'package', package_id: 'com.a' });
    const out = await bootstrapDeclaredCapabilities(ql, null, { permissionSets: sets });
    expect(out.skippedForeign).toBe(1);
    expect(out.materializedNames).toEqual(['shared_cap']);
    await bootstrapSystemCapabilities(ql, sets, { materializedCapabilityNames: out.materializedNames });
    expect(ql.rows.find((r) => r.name === 'shared_cap')).toMatchObject({
      label: 'Owner Label', description: 'Owner wrote this.', package_id: 'com.a',
    });
  });

  it('CURATED platform name: suppresses, and the curated pass seeds the row regardless', async () => {
    // A no-op for the skip list (the derived path never reaches a curated name
    // — it is already in the curated map), but a truthful answer: the row
    // exists after the second pass either way.
    const sets = [{ name: 'ops', systemPermissions: ['manage_users'] }];
    const ql = makeQl([{ name: 'manage_users', label: 'Evil', _packageId: 'com.acme.evil' }]);
    const out = await bootstrapDeclaredCapabilities(ql, null, { permissionSets: sets });
    expect(out.skippedPlatform).toBe(1);
    expect(out.materializedNames).toEqual(['manage_users']);
    await bootstrapSystemCapabilities(ql, sets, { materializedCapabilityNames: out.materializedNames });
    expect(ql.rows.find((r) => r.name === 'manage_users')).toMatchObject({
      label: 'Manage Users', managed_by: 'platform', // curated definition, not the package's
    });
  });

  it('materializedNames reconciles with the outcome counters', async () => {
    const ql = makeQl([
      { name: 'a.new', _packageId: 'com.a' },                    // → seeded
      { name: 'a.own', label: 'Fresh', _packageId: 'com.a' },    // → updated
      { name: 'a.derived', _packageId: 'com.a' },                // → claimed
      { name: 'a.admin', _packageId: 'com.a' },                  // → skippedAdmin
      { name: 'a.foreign', _packageId: 'com.a' },                // → skippedForeign
      { name: 'manage_users', _packageId: 'com.a' },             // → skippedPlatform
      { name: 'a.orphan' },                                      // → skippedUnowned, NO row
    ]);
    ql.rows.push({ id: 'c1', name: 'a.own', managed_by: 'package', package_id: 'com.a' });
    ql.rows.push({ id: 'c2', name: 'a.derived', managed_by: 'platform' });
    ql.rows.push({ id: 'c3', name: 'a.admin', managed_by: 'admin' });
    ql.rows.push({ id: 'c4', name: 'a.foreign', managed_by: 'package', package_id: 'com.z' });

    const out = await bootstrapDeclaredCapabilities(ql, null);

    expect(out).toMatchObject({
      seeded: 1, updated: 1, claimed: 1,
      skippedAdmin: 1, skippedForeign: 1, skippedPlatform: 1, skippedUnowned: 1,
    });
    // Every named declaration lands in exactly one counter…
    const counted = out.seeded + out.updated + out.claimed
      + out.skippedAdmin + out.skippedForeign + out.skippedPlatform + out.skippedUnowned;
    expect(counted).toBe(7);
    // …and `materializedNames` is that set minus the refusal that found no row.
    expect(out.materializedNames).toEqual(['a.new', 'a.own', 'a.derived', 'a.admin', 'a.foreign', 'manage_users']);
    expect(out.materializedNames).toHaveLength(counted - out.skippedUnowned);
    expect(out.materializedNames).not.toContain('a.orphan');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#4967 Part 3] The refusal diagnostic names the GRANTOR permission set(s)
// and the actual consequence. Level stays `warn` per #4632 (functional
// degradation, not a durability failure).
// ───────────────────────────────────────────────────────────────────────────
describe('unowned-declaration diagnostic (#4967 Part 3)', () => {
  function spyLogger() {
    const warns: Array<{ msg: string; meta?: Record<string, any> }> = [];
    const errors: string[] = [];
    return {
      warns,
      errors,
      logger: {
        warn: (msg: string, meta?: Record<string, any>) => { warns.push({ msg, meta }); },
        error: (msg: string) => { errors.push(msg); },
      },
    };
  }

  it('names every permission set that grants the capability, and stays a warn', async () => {
    const { warns, errors, logger } = spyLogger();
    const ql = makeQl([{ name: 'showcase.export_data', label: 'Export Data' }]);
    await bootstrapDeclaredCapabilities(ql, null, {
      logger,
      permissionSets: [
        { name: 'showcase_ops', systemPermissions: ['setup.access', 'showcase.export_data'] },
        { name: 'showcase_admin', systemPermissions: ['showcase.export_data'] },
        { name: 'unrelated', systemPermissions: ['setup.access'] },
      ],
    });
    const w = warns.find((x) => x.msg.includes('showcase.export_data'));
    expect(w).toBeDefined();
    expect(w!.msg).toContain('has no owning package');
    expect(w!.msg).toContain('showcase_ops');
    expect(w!.msg).toContain('showcase_admin');
    expect(w!.msg).not.toContain('unrelated');
    // The consequence, not just the name: it still exists, without provenance.
    expect(w!.msg).toContain('derived placeholder');
    expect(w!.meta?.grantedBy).toEqual(['showcase_ops', 'showcase_admin']);
    // [#4632] functional degradation → warn, never error.
    expect(errors).toEqual([]);
  });

  it('says so plainly when NOTHING grants the capability (it exists nowhere)', async () => {
    const { warns, logger } = spyLogger();
    const ql = makeQl([{ name: 'never_granted' }]);
    await bootstrapDeclaredCapabilities(ql, null, { logger, permissionSets: [{ name: 'ops', systemPermissions: ['setup.access'] }] });
    const w = warns.find((x) => x.msg.includes('never_granted'));
    expect(w!.msg).toContain('granted by no bootstrap permission set');
    expect(w!.msg).toContain('materialized nowhere');
    expect(w!.meta?.grantedBy).toEqual([]);
  });

  it('reports the existing row when one already resolves the name', async () => {
    const { warns, logger } = spyLogger();
    const ql = makeQl([{ name: 'showcase.export_data' }]);
    ql.rows.push({ id: 'cap_p', name: 'showcase.export_data', managed_by: 'platform' });
    await bootstrapDeclaredCapabilities(ql, null, {
      logger,
      permissionSets: [{ name: 'showcase_ops', systemPermissions: ['showcase.export_data'] }],
    });
    const w = warns.find((x) => x.msg.includes('showcase.export_data'));
    expect(w!.msg).toContain('left as-is');
    expect(w!.meta?.grantedBy).toEqual(['showcase_ops']);
  });

  it('falls back to a placeholder label for an unnamed permission set', async () => {
    const { warns, logger } = spyLogger();
    const ql = makeQl([{ name: 'orphan_cap' }]);
    await bootstrapDeclaredCapabilities(ql, null, { logger, permissionSets: [{ systemPermissions: ['orphan_cap'] }] });
    const w = warns.find((x) => x.msg.includes('orphan_cap'));
    expect(w!.meta?.grantedBy).toEqual(['(unnamed permission set)']);
  });
});
