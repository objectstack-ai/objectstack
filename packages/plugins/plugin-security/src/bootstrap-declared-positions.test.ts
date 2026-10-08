// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#2909 T2] Lock the seed semantics of bootstrapDeclaredPositions.
 *
 * sys_position is RECORD-AUTHORITATIVE (ADR-0094 addendum): the declared
 * `positions: []` metadata seeds row IDENTITY + display fields only. The
 * record side — permission-set bindings, `active`, `is_default`,
 * `delegatable`, `managed_by` provenance — belongs to the runtime/admin and
 * must never be touched by a re-seed. These tests exist to keep that
 * contract from regressing silently (the behavior predates them but was
 * never locked).
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { registerBuiltinPositions, securityBuiltinPositions } from './builtin-positions.js';
import { SECURITY_PLUGIN_ID } from './manifest.js';

/**
 * The metadata service of a deployment that declares no position in it — the
 * catalog read takes both sources and refuses to be built over a missing one.
 */
const NO_METADATA_POSITIONS = { get: async () => undefined, list: async () => [] };

/**
 * A registry over a fixed list, as the catalog read uses one: its list, its
 * by-name read (first match), and no disabled package.
 */
function listRegistry(items: () => any[]) {
  return {
    listItems: (type: string) => (type === 'position' ? [...items()] : []),
    getItem: (type: string, name: string) => (type === 'position' ? items().find((i) => i?.name === name) : undefined),
    isPackageDisabled: () => false,
  };
}

/** A metadata service holding `items` as its declared positions. */
const metadataListing = (items: any[]) => ({
  get: async (type: string, name: string) => (type === 'position' ? items.find((i) => i.name === name) : undefined),
  list: async (type: string) => (type === 'position' ? items.map((i) => ({ ...i })) : []),
});

/**
 * Minimal in-memory ql for sys_position seeding. `registry` replaces the
 * list-backed one when a case needs the real engine registry's by-name
 * precedence.
 */
function makeQl(declared: any[] = [], registry?: unknown) {
  const rows: any[] = [];
  return {
    rows,
    // [#8378] Items are surfaced as the real engine surfaces them — the
    // document itself, not a `{ content: <item> }` box that nothing produces.
    registry: registry ?? listRegistry(() => declared),
    async find(object: string, q: any) {
      if (object !== 'sys_position') return [];
      const where = q?.where ?? {};
      // Membership is modelled because the real engine supports it and the
      // #10946 boot seeders now hoist ONE `$in` existence read out of their
      // loop. A double that silently answered `[]` to `$in` would report
      // "nothing is seeded" and make every re-seed look like a first boot.
      return rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const inList = (v as any).$in;
          if (Array.isArray(inList)) return inList.includes(r[k]);
          throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
        }
        return r[k] === v;
      }));
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_position') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      if (object !== 'sys_position') return;
      const r = rows.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
  };
}

describe('bootstrapDeclaredPositions (#2909 T2 — seed-only semantics locked)', () => {
  it('inserts new declared positions with identity + display fields only', async () => {
    const ql = makeQl([{ name: 'contributor', label: 'Contributor', description: 'Does work' }]);
    const r = await bootstrapDeclaredPositions(ql, NO_METADATA_POSITIONS);
    expect(r.seeded).toBe(1);
    const row = ql.rows[0];
    expect(row).toMatchObject({ name: 'contributor', label: 'Contributor', active: true, is_default: false });
    // Provenance is NOT stamped by the declared seeder (bootstrapBuiltinRoles
    // owns the built-in anchors; declared positions carry the object default).
    expect(row.managed_by).toBeUndefined();
  });

  it('refreshes ONLY label/description on existing rows', async () => {
    const ql = makeQl([{ name: 'contributor', label: 'Contributor v2', description: 'new text' }]);
    ql.rows.push({
      id: 'pos_1', name: 'contributor', label: 'Contributor', description: 'old',
      active: true, is_default: false,
    });
    const r = await bootstrapDeclaredPositions(ql, NO_METADATA_POSITIONS);
    expect(r.updated).toBe(1);
    expect(ql.rows[0].label).toBe('Contributor v2');
    expect(ql.rows[0].description).toBe('new text');
  });

  it('NEVER touches authoritative record fields (active/is_default/delegatable/managed_by)', async () => {
    const ql = makeQl([{ name: 'contributor', label: 'Contributor v2' }]);
    // Admin turned the position off, made it default, marked it delegatable,
    // and the row carries provenance — a re-seed must not reset any of it.
    ql.rows.push({
      id: 'pos_1', name: 'contributor', label: 'Contributor', description: 'old',
      active: false, is_default: true, delegatable: true, managed_by: 'package',
      permissions: ['something_admin_set'],
    });
    await bootstrapDeclaredPositions(ql, NO_METADATA_POSITIONS);
    const row = ql.rows[0];
    expect(row.active).toBe(false);
    expect(row.is_default).toBe(true);
    expect(row.delegatable).toBe(true);
    expect(row.managed_by).toBe('package');
    expect(row.permissions).toEqual(['something_admin_set']);
    // …while the display fields did refresh.
    expect(row.label).toBe('Contributor v2');
  });

  it('is idempotent — a re-run inserts nothing new', async () => {
    const ql = makeQl([{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }]);
    const r1 = await bootstrapDeclaredPositions(ql, NO_METADATA_POSITIONS);
    expect(r1.seeded).toBe(2);
    const r2 = await bootstrapDeclaredPositions(ql, NO_METADATA_POSITIONS);
    expect(r2.seeded).toBe(0);
    expect(ql.rows).toHaveLength(2);
  });
});

/**
 * [ADR-0131 C2 S2] The six built-in positions are declared metadata, which the
 * catalog read lists; they stay `bootstrapBuiltinRoles`'s rows — this seeder
 * writes no copy of them and refreshes none of their columns.
 */
describe('bootstrapDeclaredPositions — the six built-in positions are not this seeder’s', () => {
  const builtins = () => securityBuiltinPositions.map((p) => ({ ...p }));

  it('seeds the metadata service’s positions while the registry holds the six', async () => {
    const ql = makeQl(builtins());
    const r = await bootstrapDeclaredPositions(
      ql,
      metadataListing([{ name: 'field_rep', label: 'Field Rep' }, { name: 'auditor', label: 'Auditor' }]),
    );
    expect(ql.rows.map((row) => row.name).sort()).toEqual(['auditor', 'field_rep']);
    expect(r).toEqual({ seeded: 2, updated: 0, unchanged: 0, unreadable: 0 });
  });

  it('writes nothing for the six on a fresh organization — no copy ahead of the built-in pass', async () => {
    const ql = makeQl(builtins());
    const r = await bootstrapDeclaredPositions(ql, metadataListing(builtins()), { organizationId: 'org_a' });
    expect(ql.rows).toEqual([]);
    expect(r).toEqual({ seeded: 0, updated: 0, unchanged: 0, unreadable: 0 });
  });

  it('refreshes nothing on the six’s rows, whatever a declaration of the same name says', async () => {
    // The rows as `bootstrapBuiltinRoles` leaves them…
    const seeded = securityBuiltinPositions.map((p, i) => ({
      id: `pos_builtin_${i}`, name: p.name, label: p.label, description: p.description,
      managed_by: 'platform', active: true, is_default: false,
    }));
    // …and a declaration of each name whose display text differs from them.
    const drifted = securityBuiltinPositions.map((p) => ({ name: p.name, label: `${p.label} (redeclared)` }));
    const ql = makeQl([...drifted, { name: 'door_authored', label: 'Door Authored' }]);
    ql.rows.push(...seeded.map((row) => ({ ...row })));
    const r = await bootstrapDeclaredPositions(ql, metadataListing(drifted));
    expect(ql.rows.filter((row) => row.name !== 'door_authored')).toEqual(seeded);
    expect(r).toEqual({ seeded: 1, updated: 0, unchanged: 0, unreadable: 0 });
  });
});

/**
 * [ADR-0131 C2 S2b] The seeder reads through the security catalog read — the
 * engine registry and the metadata service, in its one read order — where it
 * used to take the registry ALONE whenever the registry held any position
 * besides the six.
 *
 * The registry here is the real `SchemaRegistry`, so a name's answer is the
 * registry's own by-name precedence, not a fixture's: the six registered the
 * way the plugin registers them (packaged, composite keys), and a definition a
 * metadata author saved hydrated the way the door hydrates one (no package, the
 * bare slot).
 */
describe('bootstrapDeclaredPositions — one catalog read, both sources (ADR-0131 C2 S2b)', () => {
  const declaredRegistry = (...authored: Array<Record<string, unknown>>) => {
    const registry = new SchemaRegistry();
    for (const item of authored) registry.registerItem('position', { ...item }, 'name');
    registerBuiltinPositions(registry, SECURITY_PLUGIN_ID);
    return registry;
  };
  const byName = (rows: any[]) => Object.fromEntries(rows.map((row) => [row.name, row]));

  it('a door-authored position no longer silences the stack’s declared positions', async () => {
    const ql = makeQl([], declaredRegistry({ name: 'door_authored', label: 'Door Authored' }));
    const r = await bootstrapDeclaredPositions(
      ql,
      metadataListing([{ name: 'field_rep', label: 'Field Rep' }, { name: 'auditor', label: 'Auditor' }]),
      { organizationId: 'org_late' },
    );
    expect(ql.rows.map((row) => row.name).sort()).toEqual(['auditor', 'door_authored', 'field_rep']);
    expect(r).toEqual({ seeded: 3, updated: 0, unchanged: 0, unreadable: 0 });
  });

  it('writes the door-authored position’s row as the registry-only read wrote it', async () => {
    const ql = makeQl([], declaredRegistry({ name: 'door_authored', label: 'Door Authored' }));
    await bootstrapDeclaredPositions(ql, metadataListing([{ name: 'field_rep', label: 'Field Rep' }]));
    const { id, ...row } = byName(ql.rows).door_authored;
    expect(id).toMatch(/^position_/);
    expect(row).toEqual({ name: 'door_authored', label: 'Door Authored', description: null, active: true, is_default: false });
  });

  // The read order, measured: for a name BOTH sources hold, the registry's body
  // is the one written — what the either-or wrote too, because the registry
  // holding that name was itself what made the registry answer.
  it('a name both sources hold is written from the registry’s body', async () => {
    const ql = makeQl([], declaredRegistry({ name: 'field_rep', label: 'Field Rep (saved at the door)', description: 'Door text' }));
    const r = await bootstrapDeclaredPositions(
      ql,
      metadataListing([{ name: 'field_rep', label: 'Field Rep', description: 'Declared text' }]),
    );
    expect(ql.rows.map((row) => [row.name, row.label, row.description])).toEqual([
      ['field_rep', 'Field Rep (saved at the door)', 'Door text'],
    ]);
    expect(r).toEqual({ seeded: 1, updated: 0, unchanged: 0, unreadable: 0 });
  });

  // A definition saved under a built-in name before the six were declared is
  // hydrated into the bare slot and shadows the declaration at read. Positive
  // control first: the registry really answers the stored body for the name.
  it('a stored definition shadowing a built-in name is neither seeded nor restamped', async () => {
    // Both hydration shapes: stated tenant-authored only (hydrated before the
    // six were registered), and with the declaration's envelope grafted on
    // (hydrated after) — which names THIS plugin's package.
    const shadows = [
      { name: 'org_admin', label: 'Repurposed Org Admin', description: 'Saved at the door', _provenance: 'org' },
      { name: 'everyone', label: 'Repurposed Everyone', description: 'Saved at the door', _provenance: 'org', _packageId: SECURITY_PLUGIN_ID },
    ];
    const registry = declaredRegistry(...shadows);
    expect((registry.getItem('position', 'org_admin') as any)?.label).toBe('Repurposed Org Admin');
    expect((registry.getItem('position', 'everyone') as any)?.label).toBe('Repurposed Everyone');

    const seeded = securityBuiltinPositions.map((p, i) => ({
      id: `pos_builtin_${i}`, name: p.name, label: p.label, description: p.description,
      managed_by: 'platform', active: true, is_default: false,
    }));
    const fresh = makeQl([], registry);
    const onFresh = await bootstrapDeclaredPositions(fresh, NO_METADATA_POSITIONS, { organizationId: 'org_a' });
    expect(fresh.rows).toEqual([]);
    expect(onFresh).toEqual({ seeded: 0, updated: 0, unchanged: 0, unreadable: 0 });

    const existing = makeQl([], registry);
    existing.rows.push(...seeded.map((row) => ({ ...row })));
    const onExisting = await bootstrapDeclaredPositions(existing, NO_METADATA_POSITIONS);
    expect(existing.rows).toEqual(seeded);
    expect(onExisting).toEqual({ seeded: 0, updated: 0, unchanged: 0, unreadable: 0 });
  });

  // A read that did not happen is not "nothing declared": the seeder writes
  // nothing and the failure reaches its caller, which reports it.
  it('writes nothing when a catalog source cannot be read, and says so', async () => {
    const ql = makeQl([{ name: 'field_rep', label: 'Field Rep' }]);
    (ql.registry as any).listItems = () => { throw new Error('registry unreachable'); };
    const failure = await bootstrapDeclaredPositions(ql, NO_METADATA_POSITIONS).then(
      () => undefined,
      (e: any) => ({ code: e?.code, status: e?.status }),
    );
    expect(failure).toEqual({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(ql.rows).toEqual([]);

    const degraded = makeQl([{ name: 'field_rep', label: 'Field Rep' }]);
    const lostLoader = {
      ...NO_METADATA_POSITIONS,
      listDiagnosed: async () => ({ items: [{ name: 'auditor', label: 'Auditor' }], degraded: true, errors: ['loader down'] }),
    };
    const partial = await bootstrapDeclaredPositions(degraded, lostLoader).then(
      () => undefined,
      (e: any) => ({ code: e?.code, status: e?.status }),
    );
    expect(partial).toEqual({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(degraded.rows).toEqual([]);
  });

  it('refuses a composition with no metadata service rather than reading the registry alone', async () => {
    const ql = makeQl([{ name: 'field_rep', label: 'Field Rep' }]);
    const failure = await bootstrapDeclaredPositions(ql, null).then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(TypeError);
    expect(ql.rows).toEqual([]);
  });
});
