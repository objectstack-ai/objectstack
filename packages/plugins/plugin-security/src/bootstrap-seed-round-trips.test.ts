// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10946] The identity boot seeders cost O(1) database round trips on a
 * steady-state rebuild — and still reconcile.
 *
 * ## What is measured here, and what is NOT
 *
 * The defect this file pins is a **COUNT**, not a latency: every declared
 * permission set and every declared position cost exactly 4 sequential database
 * round trips on every kernel boot (2 × existence `SELECT`, 1 × `UPDATE`,
 * 1 × `SELECT`), of which the `UPDATE` fired even when nothing had changed.
 *
 * [#11096] The declared-CAPABILITY seeder next door had the same shape and is
 * pinned here too. ⚠️ Its own slope has never been measured — the hosted rig's
 * axes are permission sets / positions / objects — so nothing below claims one;
 * what is established is that the code shape is identical, and the capability
 * set is typically the LARGEST of the identity axes because it is the union of
 * every capability every declared package contributes.
 * On a local file database that loop is invisible; on a remote libsql/Turso
 * database — every hosted environment — each leg is its own sequential HTTP
 * request.
 *
 * A count is measurable without the hosted rig, so that is what these tests
 * measure: every `find` / `insert` / `update` the seeder issues against the
 * ObjectQL facade is one round trip, counted by {@link makeCountingQl}.
 *
 * ⚠️ The card's LATENCY figure (the whole `bootstrap` step growing 171.7 ms per
 * ms of injected RTT, R² = 0.998) is **inherited from the hosted rig in
 * `objectstack-ai/cloud`, not reproduced here** — nothing in this file measures
 * wall time, and a test that did would measure the machine it ran on.
 *
 * ## Why the assertions are shaped the way they are
 *
 * A round-trip suite alone is a trap: an implementation that simply stopped
 * writing would produce a perfect curve and silently stop reconciling — the
 * loops would keep their shape and lose their purpose. So the counting tests
 * are paired, one for one, with reconciliation tests over the same fixtures:
 * a drifted row still gets its `UPDATE`, an absent name is still created, and a
 * read that FAILED is never mistaken for a read that answered "none".
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { bootstrapDeclaredPermissions } from './bootstrap-declared-permissions.js';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapDeclaredCapabilities } from './bootstrap-declared-capabilities.js';
import { bootstrapSystemCapabilities, KNOWN_CAPABILITIES } from './bootstrap-system-capabilities.js';

interface CountingQl {
  rows: any[];
  calls: { find: number; insert: number; update: number };
  /** Every round trip in issue order — `find`/`insert`/`update`. */
  log: string[];
  /** Payloads of the `where` clauses the seeder issued, for shape assertions. */
  wheres: any[];
  roundTrips(): number;
  reset(): void;
  registry: { listItems: (type: string) => any[] };
  find(object: string, q: any, opts?: any): Promise<any[]>;
  insert(object: string, data: any, opts?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
}

/**
 * An in-memory ObjectQL facade that COUNTS calls. Supports the `$in` membership
 * operator, because the real engine does (`security-plugin.ts` already reads
 * `sys_permission_set` with `{ name: { $in: names } }`) — a double that refused
 * it would be pinning the double's limits, not the seeder's behaviour.
 */
function makeCountingQl(
  object: string,
  metadataType: string,
  declared: any[],
  behaviour: { findThrows?: boolean; findReturnsNonArray?: boolean } = {},
): CountingQl {
  const rows: any[] = [];
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([key, cond]) => {
      // REFUSE the combinators this double does not implement rather than
      // reading `$and`/`$or` as a column name — a matcher that silently treats
      // a combinator as a field is how a fake quietly answers a question the
      // real engine would have answered differently.
      if (key.startsWith('$')) {
        throw new Error(`counting driver: unsupported combinator ${key}`);
      }
      // [#11451] A `null` comparand is IS NULL, not `=== null`. `driver-sql`
      // compiles `{ field: null }` to `IS NULL`; a column never written is NULL
      // in the database and `undefined` in this double, and strict equality
      // matches neither. Inert for every describe above — none of them issues a
      // null comparand — and required by the curated capability read, which is
      // predicated on `organization_id: null`.
      if (cond === null) return row[key] == null;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        const inList = (cond as any).$in;
        if (Array.isArray(inList)) return inList.includes(row[key]);
        throw new Error(`counting driver: unsupported operator ${Object.keys(cond).join(',')}`);
      }
      return row[key] === cond;
    });

  const ql: CountingQl = {
    rows,
    calls: { find: 0, insert: 0, update: 0 },
    log: [],
    wheres: [],
    roundTrips() { return this.calls.find + this.calls.insert + this.calls.update; },
    reset() { this.calls = { find: 0, insert: 0, update: 0 }; this.log = []; this.wheres = []; },
    registry: { listItems: (type: string) => (type === metadataType ? [...declared] : []) },
    async find(obj: string, q: any) {
      if (obj !== object) return [];
      ql.calls.find += 1;
      ql.log.push('find');
      ql.wheres.push(q?.where);
      if (behaviour.findThrows) throw new Error('counting driver: read unavailable');
      if (behaviour.findReturnsNonArray) return undefined as any;
      return rows.filter((r) => matches(r, q?.where));
    },
    async insert(obj: string, data: any) {
      if (obj !== object) return null;
      ql.calls.insert += 1;
      ql.log.push('insert');
      rows.push({ ...data });
      return { id: data.id };
    },
    // Routed through the real dispatch predicate: a fake looser than
    // ObjectQL.update would let the seeder drift to a call shape the engine
    // refuses while this suite stayed green.
    async update(obj: string, data: any, options?: any) {
      if (obj !== object) return;
      ql.calls.update += 1;
      ql.log.push('update');
      const dispatch = assertEngineUpdateDispatch(data, options);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
  };
  return ql;
}

/**
 * `objects` is typed rather than inferred: the upgrade fixtures below widen a
 * grant (`{ allowRead }` -> `{ allowRead, allowEdit }`) to simulate a package
 * version bump, which an inferred literal type rejects.
 */
interface DeclaredSet {
  name: string;
  label: string;
  objects: Record<string, Record<string, boolean>>;
  systemPermissions: string[];
  _packageId: string;
}

const declaredSets = (n: number): DeclaredSet[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `pkg_set_${i}`,
    label: `Set ${i}`,
    objects: { crm_lead: { allowRead: true } },
    systemPermissions: [`crm.use.${i}`],
    _packageId: 'com.example.crm',
  }));

const declaredPositions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `pkg_pos_${i}`,
    label: `Position ${i}`,
    description: `desc ${i}`,
  }));

const permissionQl = (declared: any[], behaviour = {}) =>
  makeCountingQl('sys_permission_set', 'permission', declared, behaviour);
const positionQl = (declared: any[], behaviour = {}) =>
  makeCountingQl('sys_position', 'position', declared, behaviour);

describe('#10946 — steady-state rebuild is O(1) round trips (permission sets)', () => {
  it('does not grow the rebuild round-trip count with the number of declared sets', async () => {
    const measure = async (n: number) => {
      const ql = permissionQl(declaredSets(n));
      await bootstrapDeclaredPermissions(ql, undefined);   // first boot: seeds
      ql.reset();
      const r = await bootstrapDeclaredPermissions(ql, undefined); // REBUILD
      expect(r.seeded).toBe(0);
      expect(r.updated).toBe(0);
      expect(r.unchanged).toBe(n);
      return ql.roundTrips();
    };

    const [n1, n5, n20, n40] = [await measure(1), await measure(5), await measure(20), await measure(40)];
    // The count is asserted, never the wall time.
    expect([n1, n5, n20, n40]).toEqual([1, 1, 1, 1]);
  });

  it('issues ONE batched `$in` existence read for the whole declaration', async () => {
    const ql = permissionQl(declaredSets(12));
    await bootstrapDeclaredPermissions(ql, undefined);
    ql.reset();
    await bootstrapDeclaredPermissions(ql, undefined);
    expect(ql.calls.find).toBe(1);
    expect(ql.wheres[0]).toEqual({ name: { $in: declaredSets(12).map((s) => s.name) } });
  });

  it('first boot costs one batched read plus one INSERT per genuinely new set', async () => {
    const ql = permissionQl(declaredSets(10));
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(10);
    expect(ql.calls.find).toBe(1);
    expect(ql.calls.insert).toBe(10);
    expect(ql.calls.update).toBe(0);
    expect(ql.rows).toHaveLength(10);
  });
});

describe('#10946 — steady-state rebuild is O(1) round trips (positions)', () => {
  it('does not grow the rebuild round-trip count with the number of declared positions', async () => {
    const measure = async (n: number) => {
      const ql = positionQl(declaredPositions(n));
      await bootstrapDeclaredPositions(ql, null);
      ql.reset();
      const r = await bootstrapDeclaredPositions(ql, null);
      expect(r.seeded).toBe(0);
      expect(r.updated).toBe(0);
      expect(r.unchanged).toBe(n);
      return ql.roundTrips();
    };

    const [n1, n5, n20, n40] = [await measure(1), await measure(5), await measure(20), await measure(40)];
    expect([n1, n5, n20, n40]).toEqual([1, 1, 1, 1]);
  });

  it('issues ONE batched `$in` existence read for the whole declaration', async () => {
    const ql = positionQl(declaredPositions(12));
    await bootstrapDeclaredPositions(ql, null);
    ql.reset();
    await bootstrapDeclaredPositions(ql, null);
    expect(ql.calls.find).toBe(1);
    expect(ql.wheres[0]).toEqual({ name: { $in: declaredPositions(12).map((p) => p.name) } });
  });
});

/**
 * ⚠️ LOAD-BEARING. Without these, an implementation that skipped every write
 * would pass every count above while reconciling nothing at all.
 */
describe('#10946 — drift STILL reconciles', () => {
  it('a permission-set row whose stored grants differ still gets its UPDATE', async () => {
    const ql = permissionQl(declaredSets(20));
    await bootstrapDeclaredPermissions(ql, undefined);

    // The package ships a changed declaration for exactly ONE of the 20.
    const upgraded = declaredSets(20);
    upgraded[7] = { ...upgraded[7], objects: { crm_lead: { allowRead: true, allowEdit: true } } };
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? upgraded : []) };

    ql.reset();
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(19);
    expect(ql.calls.update).toBe(1);
    const row = ql.rows.find((x) => x.name === 'pkg_set_7');
    expect(JSON.parse(row.object_permissions)).toEqual({ crm_lead: { allowRead: true, allowEdit: true } });
  });

  it('a permission-set row a hand-edit drifted is healed back to the declaration', async () => {
    const ql = permissionQl(declaredSets(3));
    await bootstrapDeclaredPermissions(ql, undefined);
    // Someone wrote straight at the row.
    ql.rows[1].object_permissions = JSON.stringify({ crm_lead: { allowDelete: true } });

    ql.reset();
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.updated).toBe(1);
    expect(JSON.parse(ql.rows[1].object_permissions)).toEqual({ crm_lead: { allowRead: true } });
  });

  it('a position row whose stored label/description differ still gets its UPDATE', async () => {
    const ql = positionQl(declaredPositions(20));
    await bootstrapDeclaredPositions(ql, null);

    const upgraded = declaredPositions(20);
    upgraded[3] = { ...upgraded[3], label: 'Renamed', description: 'new text' };
    (ql as any).registry = { listItems: (t: string) => (t === 'position' ? upgraded : []) };

    ql.reset();
    const r = await bootstrapDeclaredPositions(ql, null);
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(19);
    expect(ql.calls.update).toBe(1);
    const row = ql.rows.find((x) => x.name === 'pkg_pos_3');
    expect(row.label).toBe('Renamed');
    expect(row.description).toBe('new text');
  });

  it('a re-seed still never touches the record-authoritative columns (#2909 T2 kept)', async () => {
    const ql = positionQl([{ name: 'contributor', label: 'Contributor v2', description: 'new' }]);
    ql.rows.push({
      id: 'pos_1', name: 'contributor', label: 'Contributor', description: 'old',
      active: false, is_default: true, delegatable: true, managed_by: 'package',
    });
    await bootstrapDeclaredPositions(ql, null);
    const row = ql.rows[0];
    expect(row.label).toBe('Contributor v2');
    expect(row.active).toBe(false);
    expect(row.is_default).toBe(true);
    expect(row.delegatable).toBe(true);
    expect(row.managed_by).toBe('package');
  });
});

describe('#10946 — a genuinely NEW declaration is still created', () => {
  it('the batched read does not turn "absent" into "present" (permission sets)', async () => {
    const ql = permissionQl(declaredSets(5));
    await bootstrapDeclaredPermissions(ql, undefined);

    const grown = [...declaredSets(5), {
      name: 'pkg_set_new', label: 'New', objects: {}, _packageId: 'com.example.crm',
    }];
    (ql as any).registry = { listItems: (t: string) => (t === 'permission' ? grown : []) };

    ql.reset();
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(1);
    expect(r.unchanged).toBe(5);
    expect(ql.rows.map((x) => x.name)).toContain('pkg_set_new');
    // one batched read + one insert — the other five cost nothing at all
    expect(ql.roundTrips()).toBe(2);
  });

  it('the batched read does not turn "absent" into "present" (positions)', async () => {
    const ql = positionQl(declaredPositions(5));
    await bootstrapDeclaredPositions(ql, null);

    const grown = [...declaredPositions(5), { name: 'pkg_pos_new', label: 'New', description: null }];
    (ql as any).registry = { listItems: (t: string) => (t === 'position' ? grown : []) };

    ql.reset();
    const r = await bootstrapDeclaredPositions(ql, null);
    expect(r.seeded).toBe(1);
    expect(r.unchanged).toBe(5);
    expect(ql.roundTrips()).toBe(2);
  });
});

/**
 * ⛔ #3807's conflation class, at the seam a batched read newly exposes. The
 * per-item shape was accidentally immune: a failed read fell through to an
 * insert that failed too, for that ONE item. A batched read that swallowed its
 * failure into `[]` would speak for the WHOLE set — every boot would conclude
 * nothing is seeded and try to re-create everything.
 *
 * The judgement is "did the driver return a result set", never "is the array
 * empty": an empty array is the answer "none of these names exist", and the
 * first-boot tests above depend on that answer being trusted.
 */
describe('#10946 — a read that CANNOT ANSWER is not the answer "none exist"', () => {
  it('a throwing read does NOT re-create rows that are already seeded (permission sets)', async () => {
    const ql = permissionQl(declaredSets(4));
    await bootstrapDeclaredPermissions(ql, undefined);
    expect(ql.rows).toHaveLength(4);

    // Every read now fails — the batched one and the per-item fallback alike.
    const broken = permissionQl(declaredSets(4), { findThrows: true });
    broken.rows.push(...ql.rows.map((r) => ({ ...r })));
    const warns: string[] = [];
    const r = await bootstrapDeclaredPermissions(broken, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });

    expect(r.seeded).toBe(0);
    expect(r.unreadable).toBe(4);
    expect(broken.calls.insert).toBe(0);          // ⛔ no blind insert
    expect(broken.rows).toHaveLength(4);          // ⛔ nothing re-created
    expect(warns.some((w) => w.includes('batched seed existence read failed'))).toBe(true);
    expect(warns.some((w) => w.includes('could not be read'))).toBe(true);
  });

  it('a read returning a non-result (undefined) is not read as "none exist"', async () => {
    const ql = permissionQl(declaredSets(4), { findReturnsNonArray: true });
    ql.rows.push(...declaredSets(4).map((s, i) => ({
      id: `ps_${i}`, name: s.name, managed_by: 'package', package_id: 'com.example.crm',
      label: s.label, description: null,
      object_permissions: '{}', field_permissions: '{}', system_permissions: '[]',
      row_level_security: '[]', tab_permissions: '{}', admin_scope: null,
    })));
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(0);
    expect(r.unreadable).toBe(4);
    expect(ql.calls.insert).toBe(0);
    expect(ql.rows).toHaveLength(4);
  });

  it('a throwing read does NOT re-create rows that are already seeded (positions)', async () => {
    const seeded = positionQl(declaredPositions(4));
    await bootstrapDeclaredPositions(seeded, null);

    const broken = positionQl(declaredPositions(4), { findThrows: true });
    broken.rows.push(...seeded.rows.map((r) => ({ ...r })));
    const r = await bootstrapDeclaredPositions(broken, null);
    expect(r.seeded).toBe(0);
    expect(r.unreadable).toBe(4);
    expect(broken.calls.insert).toBe(0);
    expect(broken.rows).toHaveLength(4);
  });

  it('an EMPTY result set is still trusted as "none exist" — the first boot depends on it', async () => {
    const ql = permissionQl(declaredSets(3));
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(3);
  });
});

/**
 * The batched oracle is a snapshot taken before the loop. Without the
 * `remember` write-back, a name declared twice in one batch would take the
 * INSERT branch the second time — and the loud ADR-0086 D4 refusal it used to
 * produce would become a unique-index rejection nobody reports.
 */
describe('#10946 — a name declared twice in one batch keeps its loud refusal', () => {
  it('still reports skippedForeign for a second package declaring the same name', async () => {
    const ql = permissionQl([
      { name: 'shared_name', label: 'A', objects: {}, _packageId: 'com.example.a' },
      { name: 'shared_name', label: 'B', objects: {}, _packageId: 'com.example.b' },
    ]);
    const warns: string[] = [];
    const r = await bootstrapDeclaredPermissions(ql, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });
    expect(r.seeded).toBe(1);
    expect(r.skippedForeign).toBe(1);
    expect(ql.rows).toHaveLength(1);
    expect(ql.rows[0].package_id).toBe('com.example.a');
    expect(warns.some((w) => w.includes('owned by another package'))).toBe(true);
  });
});

// ── #11096 — declared capabilities ─────────────────────────────────────────

/**
 * `scope` is typed rather than inferred: the "declared SCOPE changed" drift
 * fixture below widens `'platform'` to `'org'` to simulate a package version
 * bump, which an inferred `'platform'` literal type rejects — the same reason
 * `DeclaredSet` above types `objects` explicitly.
 */
interface DeclaredCapability {
  name: string;
  label: string;
  description: string;
  scope: 'platform' | 'org';
  _packageId: string;
}

const declaredCaps = (n: number): DeclaredCapability[] =>
  Array.from({ length: n }, (_, i) => ({
    // ⚠️ Never a curated `PLATFORM_CAPABILITY_NAMES` entry: those are refused
    // before the existence read is even consulted, so a curated fixture would
    // measure the refusal path and report zero round trips for the wrong reason.
    name: `crm.cap.${i}`,
    label: `Capability ${i}`,
    description: `desc ${i}`,
    scope: 'platform',
    _packageId: 'com.example.crm',
  }));

const capabilityQl = (declared: any[], behaviour = {}) =>
  makeCountingQl('sys_capability', 'capability', declared, behaviour);

describe('#11096 — steady-state rebuild is O(1) round trips (declared capabilities)', () => {
  it('does not grow the rebuild round-trip count with the number of declared capabilities', async () => {
    const measure = async (n: number) => {
      const ql = capabilityQl(declaredCaps(n));
      await bootstrapDeclaredCapabilities(ql, undefined);     // first boot: seeds
      ql.reset();
      const r = await bootstrapDeclaredCapabilities(ql, undefined);  // REBUILD
      expect(r.seeded).toBe(0);
      expect(r.updated).toBe(0);
      expect(r.unchanged).toBe(n);
      // The suppression list is the whole reason this seeder reports names, and
      // an unchanged row is still a materialized one (#4967 Part 1).
      expect(r.materializedNames).toHaveLength(n);
      return ql.roundTrips();
    };

    const [n1, n5, n20, n40] = [await measure(1), await measure(5), await measure(20), await measure(40)];
    // The count is asserted, never the wall time.
    expect([n1, n5, n20, n40]).toEqual([1, 1, 1, 1]);
  });

  it('issues ONE batched `$in` existence read for the whole declaration', async () => {
    const ql = capabilityQl(declaredCaps(12));
    await bootstrapDeclaredCapabilities(ql, undefined);
    ql.reset();
    await bootstrapDeclaredCapabilities(ql, undefined);
    expect(ql.calls.find).toBe(1);
    expect(ql.wheres[0]).toEqual({ name: { $in: declaredCaps(12).map((c) => c.name) } });
  });

  it('first boot costs one batched read plus one INSERT per genuinely new capability', async () => {
    const ql = capabilityQl(declaredCaps(10));
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.seeded).toBe(10);
    expect(ql.calls.find).toBe(1);
    expect(ql.calls.insert).toBe(10);
    expect(ql.calls.update).toBe(0);
    expect(ql.rows).toHaveLength(10);
  });
});

/**
 * ⚠️ LOAD-BEARING. Without these, an implementation that skipped every write
 * would pass every capability count above while reconciling nothing at all —
 * the exact failure shape a round-trip suite alone cannot see.
 */
describe('#11096 — drift STILL reconciles (declared capabilities)', () => {
  it('a capability row whose stored label/description differ still gets its UPDATE', async () => {
    const ql = capabilityQl(declaredCaps(20));
    await bootstrapDeclaredCapabilities(ql, undefined);

    // The package ships new copy for exactly ONE of the 20.
    const upgraded = declaredCaps(20);
    upgraded[7] = { ...upgraded[7], label: 'Renamed', description: 'new text' };
    (ql as any).registry = { listItems: (t: string) => (t === 'capability' ? upgraded : []) };

    ql.reset();
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(19);
    expect(ql.calls.update).toBe(1);
    const row = ql.rows.find((x) => x.name === 'crm.cap.7');
    expect(row.label).toBe('Renamed');
    expect(row.description).toBe('new text');
  });

  it('a capability whose declared SCOPE changed still gets its UPDATE', async () => {
    const ql = capabilityQl(declaredCaps(3));
    await bootstrapDeclaredCapabilities(ql, undefined);

    const upgraded = declaredCaps(3);
    upgraded[1] = { ...upgraded[1], scope: 'org' as const };
    (ql as any).registry = { listItems: (t: string) => (t === 'capability' ? upgraded : []) };

    ql.reset();
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.updated).toBe(1);
    expect(ql.rows.find((x) => x.name === 'crm.cap.1').scope).toBe('org');
  });

  it('a capability row a hand-edit drifted is healed back to the declaration', async () => {
    const ql = capabilityQl(declaredCaps(3));
    await bootstrapDeclaredCapabilities(ql, undefined);
    // Someone wrote straight at the row.
    ql.rows[1].description = 'hand-edited';

    ql.reset();
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(2);
    expect(ql.rows[1].description).toBe('desc 1');
  });

  it('a re-seed still never touches the provenance columns', async () => {
    const ql = capabilityQl([{
      name: 'crm.cap.0', label: 'Capability v2', description: 'new', scope: 'platform',
      _packageId: 'com.example.crm',
    }]);
    ql.rows.push({
      id: 'cap_1', name: 'crm.cap.0', label: 'Capability', description: 'old', scope: 'platform',
      active: false, managed_by: 'package', package_id: 'com.example.crm',
    });
    await bootstrapDeclaredCapabilities(ql, undefined);
    const row = ql.rows[0];
    expect(row.label).toBe('Capability v2');
    expect(row.active).toBe(false);
    expect(row.managed_by).toBe('package');
    expect(row.package_id).toBe('com.example.crm');
  });
});

describe('#11096 — a genuinely NEW declaration is still created', () => {
  it('the batched read does not turn "absent" into "present" (capabilities)', async () => {
    const ql = capabilityQl(declaredCaps(5));
    await bootstrapDeclaredCapabilities(ql, undefined);

    const grown = [...declaredCaps(5), {
      name: 'crm.cap.new', label: 'New', description: 'brand new', scope: 'platform' as const,
      _packageId: 'com.example.crm',
    }];
    (ql as any).registry = { listItems: (t: string) => (t === 'capability' ? grown : []) };

    ql.reset();
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.seeded).toBe(1);
    expect(r.unchanged).toBe(5);
    expect(ql.rows.map((x) => x.name)).toContain('crm.cap.new');
    // one batched read + one insert — the other five cost nothing at all
    expect(ql.roundTrips()).toBe(2);
  });
});

/**
 * ⛔ The provenance half of triage's clause ②: the refusal diagnostics at the
 * top of `upsertPackageCapability` state a DIFFERENT consequence depending on
 * whether a row was found, so the batched read has to preserve the found /
 * not-found distinction, not merely return rows.
 */
describe('#11096 — the batched read preserves the provenance branches', () => {
  it('still refuses a capability owned by ANOTHER package, loudly', async () => {
    const ql = capabilityQl([{
      name: 'crm.cap.0', label: 'Mine', description: 'd', scope: 'platform',
      _packageId: 'com.example.b',
    }]);
    ql.rows.push({
      id: 'cap_1', name: 'crm.cap.0', label: 'Theirs', description: 'd', scope: 'platform',
      managed_by: 'package', package_id: 'com.example.a', active: true,
    });
    const warns: string[] = [];
    const r = await bootstrapDeclaredCapabilities(ql, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });
    expect(r.skippedForeign).toBe(1);
    expect(r.materializedNames).toEqual(['crm.cap.0']);
    expect(ql.rows[0].package_id).toBe('com.example.a');   // untouched
    expect(warns.some((w) => w.includes('owned by another package'))).toBe(true);
  });

  it('still CLAIMS a derived platform placeholder for an explicit declaration', async () => {
    const ql = capabilityQl(declaredCaps(1));
    ql.rows.push({
      id: 'cap_1', name: 'crm.cap.0', label: 'Crm Cap 0', description: 'Capability crm.cap.0.',
      scope: 'platform', managed_by: 'platform', active: true,
    });
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.claimed).toBe(1);
    expect(ql.rows[0].managed_by).toBe('package');
    expect(ql.rows[0].package_id).toBe('com.example.crm');
  });

  it('never clobbers an admin-authored row', async () => {
    const ql = capabilityQl(declaredCaps(1));
    ql.rows.push({
      id: 'cap_1', name: 'crm.cap.0', label: 'Admin Copy', description: 'admin wrote this',
      scope: 'platform', managed_by: 'admin', active: true,
    });
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.skippedAdmin).toBe(1);
    expect(r.materializedNames).toEqual(['crm.cap.0']);
    expect(ql.rows[0].label).toBe('Admin Copy');
    expect(ql.calls.update).toBe(0);
  });

  it('an UNOWNED declaration still reports the consequence for a name WITH a row', async () => {
    const ql = capabilityQl([{ name: 'crm.cap.0', label: 'L', description: 'd', scope: 'platform' }]);
    ql.rows.push({
      id: 'cap_1', name: 'crm.cap.0', label: 'L', description: 'd', scope: 'platform',
      managed_by: 'platform', active: true,
    });
    const warns: string[] = [];
    const r = await bootstrapDeclaredCapabilities(ql, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });
    expect(r.skippedUnowned).toBe(1);
    // A row resolves it — so the derivation must be suppressed, and the
    // diagnostic must say so rather than promising a placeholder.
    expect(r.materializedNames).toEqual(['crm.cap.0']);
    expect(warns.some((w) => w.includes('already resolves it and is left as-is'))).toBe(true);
  });

  it('an UNOWNED declaration with NO row reports the OTHER consequence, and stays unsuppressed', async () => {
    const ql = capabilityQl([{ name: 'crm.cap.0', label: 'L', description: 'd', scope: 'platform' }]);
    const warns: string[] = [];
    const r = await bootstrapDeclaredCapabilities(ql, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
      permissionSets: [{ name: 'crm_rep', systemPermissions: ['crm.cap.0'] }],
    });
    expect(r.skippedUnowned).toBe(1);
    expect(r.materializedNames).toEqual([]);   // ⛔ #4967: no row ⇒ no suppression
    expect(warns.some((w) => w.includes('falls back to the back-compat derived placeholder'))).toBe(true);
    expect(warns.some((w) => w.includes('crm_rep'))).toBe(true);
  });

  it('a name declared twice in one batch keeps its loud refusal', async () => {
    const ql = capabilityQl([
      { name: 'crm.shared', label: 'A', description: 'a', scope: 'platform', _packageId: 'com.example.a' },
      { name: 'crm.shared', label: 'B', description: 'b', scope: 'platform', _packageId: 'com.example.b' },
    ]);
    const warns: string[] = [];
    const r = await bootstrapDeclaredCapabilities(ql, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });
    expect(r.seeded).toBe(1);
    expect(r.skippedForeign).toBe(1);
    expect(ql.rows).toHaveLength(1);
    expect(ql.rows[0].package_id).toBe('com.example.a');
    expect(warns.some((w) => w.includes('owned by another package'))).toBe(true);
  });
});

/**
 * ⛔ #3807's conflation class on the capability axis. Note the second half: a
 * name whose row could not be read must ALSO stay out of `materializedNames`,
 * because suppressing the back-compat derivation for a name that may have no
 * row is precisely the #4967 hole.
 */
describe('#11096 — a read that CANNOT ANSWER is not the answer "none exist"', () => {
  it('a throwing read does NOT re-create capabilities that are already seeded', async () => {
    const ql = capabilityQl(declaredCaps(4));
    await bootstrapDeclaredCapabilities(ql, undefined);
    expect(ql.rows).toHaveLength(4);

    const broken = capabilityQl(declaredCaps(4), { findThrows: true });
    broken.rows.push(...ql.rows.map((r) => ({ ...r })));
    const warns: string[] = [];
    const r = await bootstrapDeclaredCapabilities(broken, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });

    expect(r.seeded).toBe(0);
    expect(r.unreadable).toBe(4);
    expect(broken.calls.insert).toBe(0);        // ⛔ no blind insert
    expect(broken.rows).toHaveLength(4);        // ⛔ nothing re-created
    expect(r.materializedNames).toEqual([]);    // ⛔ unknown ⇒ never suppress
    expect(warns.some((w) => w.includes('batched seed existence read failed'))).toBe(true);
    expect(warns.some((w) => w.includes('could not be read'))).toBe(true);
  });

  it('a read returning a non-result (undefined) is not read as "none exist"', async () => {
    const ql = capabilityQl(declaredCaps(4), { findReturnsNonArray: true });
    ql.rows.push(...declaredCaps(4).map((c, i) => ({
      id: `cap_${i}`, name: c.name, label: c.label, description: c.description,
      scope: 'platform', managed_by: 'package', package_id: 'com.example.crm', active: true,
    })));
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.seeded).toBe(0);
    expect(r.unreadable).toBe(4);
    expect(ql.calls.insert).toBe(0);
    expect(ql.rows).toHaveLength(4);
  });

  it('an EMPTY result set is still trusted as "none exist" — the first boot depends on it', async () => {
    const ql = capabilityQl(declaredCaps(3));
    const r = await bootstrapDeclaredCapabilities(ql, undefined);
    expect(r.seeded).toBe(3);
  });
});

/**
 * [#11451] `bootstrapSystemCapabilities` — the OTHER capability seeder, whose
 * definition set is the union of every `systemPermissions[]` string rather than
 * the explicit `defineCapability` declarations.
 *
 * ## What is pinned, and what is deliberately NOT
 *
 * Two halves, and since #11520 BOTH are batched — as two SEPARATE reads asking
 * two different questions, which is the whole subtlety:
 *
 *  - the CURATED half (`KNOWN_CAPABILITIES`) costs ONE batched `$in` read
 *    carrying the #8470 predicate, and zero writes on a steady-state rebuild;
 *  - the DERIVED half costs ONE batched `$in` read carrying NO predicate. It
 *    stays wide because its question is cross-organization by construction and
 *    its counters are computed from the lowest-id row installation-wide (see the
 *    seeder's header). ⛔ A "simplification" that folds the two into one read —
 *    or that narrows the derived one to the platform bucket to make folding
 *    possible — reverses #8552 and #8751 by read shape; the predicate pin below
 *    and the `platformStampedInOrg` suite in `bootstrap-system-capabilities.test
 *    .ts` are what stop it.
 *
 * ⚠️ These counts MOVED in #11520, deliberately: this doc previously stated the
 * derived residue as `1 + derived` and said "a later card that batches it is
 * expected to move these numbers deliberately". #11518 removed the objection
 * that kept it per-item (the page cap became a measurement, so an unnarrowed
 * batched read that truncates degrades loudly instead of silently reading
 * `absent` and inserting), so the residue is now a second constant read rather
 * than a linear one.
 *
 * ⚠️ NO speedup is claimed. The hosted `bootstrap-curve.mjs` rig lives in
 * `objectstack-ai/cloud` and its axes are permission sets / positions / objects,
 * not this one. These tests count round trips and pin WHICH ROW each leg
 * touched; nothing here measures wall time.
 */
describe('#11451/#11520 — BOTH halves are O(1) round trips, as two differently-shaped reads', () => {
  const CURATED_NAMES = KNOWN_CAPABILITIES.map((c) => c.name);
  const derivedSets = (n: number) => [{ systemPermissions: Array.from({ length: n }, (_, i) => `app.cap.${i}`) }];
  const capQl = (behaviour = {}) => makeCountingQl('sys_capability', 'capability', [], behaviour);

  it('the existence reads are O(1) at every derived size — the residue is GONE', async () => {
    const measure = async (d: number) => {
      const ql = capQl();
      await bootstrapSystemCapabilities(ql, derivedSets(d));      // first boot: seeds
      ql.reset();
      const r = await bootstrapSystemCapabilities(ql, derivedSets(d));  // REBUILD
      expect(r.seeded).toBe(0);
      expect(r.updated).toBe(0);                                   // ⬅ the gate
      expect(r.unchanged).toBe(CURATED_NAMES.length + d);
      return { finds: ql.calls.find, updates: ql.calls.update, unchanged: r.unchanged, derived: d };
    };

    const rows = [await measure(0), await measure(5), await measure(20)];
    // [#11520] FLAT, not `1 + d`. One read for the curated half, one for the
    // derived half — and at d=0 the derived read is not issued at all, because
    // `buildExistingByName` returns before reading when no name survives its
    // filter. That asymmetry is the reason the expectation is written out per
    // size rather than as a single constant.
    expect(rows.map((x) => x.finds)).toEqual([1, 2, 2]);
    // ⭐ The anti-vacuity half lives in `measure` itself, and it has to: a
    // `finds` of 2 reached by SKIPPING the derived half would satisfy the line
    // above. `expect(r.unchanged).toBe(CURATED_NAMES.length + d)` there is what
    // rules that out — every derived name was looked up, judged ours, and found
    // already correct. Restated here so the count and the work are read together:
    expect(rows.map((x) => x.unchanged)).toEqual([
      CURATED_NAMES.length, CURATED_NAMES.length + 5, CURATED_NAMES.length + 20,
    ]);
    // ⬅ The unconditional UPDATE is gone from BOTH halves.
    expect(rows.map((x) => x.updates)).toEqual([0, 0, 0]);
  });

  it('the batched read carries the #8470 predicate IN the query, with no other keys', async () => {
    const ql = capQl();
    await bootstrapSystemCapabilities(ql, []);
    ql.reset();
    await bootstrapSystemCapabilities(ql, []);
    expect(ql.calls.find).toBe(1);
    expect(ql.wheres[0]).toEqual({
      name: { $in: CURATED_NAMES },
      managed_by: 'platform',
      organization_id: null,
    });
    // `toEqual` ignores `undefined`-valued properties, so the KEY SET is pinned
    // separately: a predicate leaking in as `key: undefined` would pass the
    // assertion above while changing what every other caller emits.
    expect(Object.keys(ql.wheres[0]).sort()).toEqual(['managed_by', 'name', 'organization_id']);
  });

  /**
   * ⭐ [#11520] The RULED pin on the derived read's SHAPE. `bootstrap-system-
   * capabilities.test.ts` pins the consequences (#8751's `platformStampedInOrg`,
   * #8552's untouched bucket); this pins the cause, because the cheap fix that
   * reverses both is a one-key edit right here.
   *
   * The derived question is "the lowest-id row for this name, installation-wide"
   * (`X`). Adding `organization_id: null` asks for the bucket occupant (`B`)
   * instead — a different row whenever an organization's row sorts lower — which
   * silently stops #8751's signal and turns #8552's deliberate decline-to-seed
   * into an insert. Neither has a maintainer ruling. So the derived read carries
   * `name` and NOTHING else.
   */
  it('⭐ the DERIVED read is UNNARROWED — `name` only, no bucket predicate (#8552/#8751)', async () => {
    const ql = capQl();
    await bootstrapSystemCapabilities(ql, derivedSets(3));
    ql.reset();
    await bootstrapSystemCapabilities(ql, derivedSets(3));

    // Two reads, in loop order: curated (predicated) then derived (wide).
    expect(ql.calls.find).toBe(2);
    const derivedWhere = ql.wheres[1];
    expect(derivedWhere).toEqual({ name: { $in: ['app.cap.0', 'app.cap.1', 'app.cap.2'] } });
    // The KEY SET separately, for the same reason the curated pin above does it:
    // `toEqual` ignores `undefined`-valued properties, so a leaked
    // `organization_id: undefined` would pass the assertion above while changing
    // the question the driver is asked.
    expect(Object.keys(derivedWhere).sort()).toEqual(['name']);
  });

  it('the existing callers still emit their exact key set — no predicate leaked in', async () => {
    // The measurement fence: `buildExistingByName` gained an optional predicate,
    // and a caller that passes none must emit the keys it emitted before, not
    // those keys plus `undefined`-valued ones.
    const ql = permissionQl(declaredSets(3));
    await bootstrapDeclaredPermissions(ql, undefined);
    ql.reset();
    await bootstrapDeclaredPermissions(ql, undefined);
    expect(Object.keys(ql.wheres[0])).toEqual(['name']);
  });

  it('⭐ pins IDENTITY, not just the count: the rebuild re-reads and re-writes the same rows', async () => {
    const ql = capQl();
    await bootstrapSystemCapabilities(ql, derivedSets(2));
    const idsAfterFirstBoot = ql.rows.map((r) => r.id).sort();
    expect(idsAfterFirstBoot).toHaveLength(CURATED_NAMES.length + 2);

    ql.reset();
    await bootstrapSystemCapabilities(ql, derivedSets(2));
    // Same rows, same ids — no row was re-created, and no offsetting pair of
    // "one dropped, one inserted" is hiding behind a constant count.
    expect(ql.rows.map((r) => r.id).sort()).toEqual(idsAfterFirstBoot);
    expect(ql.calls.insert).toBe(0);

    // …and when a curated row DRIFTS, the UPDATE lands on THAT row's id.
    const target = ql.rows.find((r) => r.name === CURATED_NAMES[0])!;
    target.label = 'Hand-edited';
    ql.reset();
    const r = await bootstrapSystemCapabilities(ql, derivedSets(2));
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(CURATED_NAMES.length + 1);
    expect(ql.calls.update).toBe(1);
    expect(ql.rows.find((x) => x.id === target.id)!.label)
      .toBe(KNOWN_CAPABILITIES.find((c) => c.name === CURATED_NAMES[0])!.label);
  });

  /**
   * ⚠️ LOAD-BEARING. Without this, an implementation that simply stopped writing
   * would satisfy every count above while reconciling nothing at all.
   */
  it('a curated row whose stored label/description drifted STILL gets its UPDATE', async () => {
    const ql = capQl();
    await bootstrapSystemCapabilities(ql, []);
    const row = ql.rows.find((r) => r.name === CURATED_NAMES[1])!;
    row.label = 'Renamed';
    row.description = 'new text';
    ql.reset();
    const r = await bootstrapSystemCapabilities(ql, []);
    expect(r.updated).toBe(1);
    expect(ql.calls.update).toBe(1);
    expect(row.label).toBe(KNOWN_CAPABILITIES.find((c) => c.name === CURATED_NAMES[1])!.label);
    expect(row.description).toBe(KNOWN_CAPABILITIES.find((c) => c.name === CURATED_NAMES[1])!.description);
  });

  it('a genuinely absent curated name is still created — "absent" is not turned into "present"', async () => {
    const ql = capQl();
    await bootstrapSystemCapabilities(ql, []);
    const dropped = ql.rows.findIndex((r) => r.name === CURATED_NAMES[2]);
    ql.rows.splice(dropped, 1);
    ql.reset();
    const r = await bootstrapSystemCapabilities(ql, []);
    expect(r.seeded).toBe(1);
    expect(r.unchanged).toBe(CURATED_NAMES.length - 1);
    expect(ql.roundTrips()).toBe(2);          // one batched read + one insert
    expect(ql.rows.find((x) => x.name === CURATED_NAMES[2])).toBeDefined();
  });

  it('a read that CANNOT ANSWER is not the answer "none exist" — nothing is re-created', async () => {
    const broken = capQl({ findThrows: true });
    broken.rows.push(...KNOWN_CAPABILITIES.map((c, i) => ({
      id: `cap_${i}`, name: c.name, label: c.label, description: c.description,
      scope: c.scope, managed_by: 'platform', organization_id: null, active: true,
    })));
    const warns: string[] = [];
    // No derived names here: this pin is about the CURATED half, and #11520 adds
    // the derived counterpart as its own test below rather than widening this one.
    const r = await bootstrapSystemCapabilities(broken, [], { logger: { warn: (m) => warns.push(m) } });
    expect(r.unreadable).toBe(KNOWN_CAPABILITIES.length);
    expect(r.seeded).toBe(0);
    expect(broken.calls.insert).toBe(0);      // ⛔ no blind insert
    expect(broken.rows).toHaveLength(KNOWN_CAPABILITIES.length);
    expect(warns.some((w) => w.includes('batched seed existence read failed'))).toBe(true);
    expect(warns.some((w) => w.includes('could not be read'))).toBe(true);
  });

  /**
   * ⭐ [#11520] The derived counterpart — and the one place this card changes
   * observable behaviour, pinned so the change is a decision rather than a
   * side effect.
   *
   * BEFORE: the derived half read through `tryFind`, which catches and returns
   * `[]`. An unreadable database therefore read as "absent" and routed every
   * derived name to its INSERT branch. Where the read failed but the write did
   * not — a transient read timeout, a lagging replica — that is a DUPLICATE
   * placeholder, refused only where the unique index happens to exist; and where
   * the insert failed too it was silent, because the `blockedCurated` diagnostic
   * is curated-only.
   *
   * AFTER: `unknown` is declined, exactly as the shared oracle's module header
   * requires of every other caller. Strictly stricter, in the direction #10946
   * chose deliberately for the curated half and #11518 extended to truncation.
   */
  it('⭐ [#11520] a DERIVED name whose read cannot answer is DECLINED, never blind-inserted', async () => {
    const DERIVED = 2;
    const broken = capQl({ findThrows: true });
    broken.rows.push(...KNOWN_CAPABILITIES.map((c, i) => ({
      id: `cap_${i}`, name: c.name, label: c.label, description: c.description,
      scope: c.scope, managed_by: 'platform', organization_id: null, active: true,
    })));
    const before = broken.rows.length;
    const warns: string[] = [];
    const r = await bootstrapSystemCapabilities(broken, derivedSets(DERIVED), {
      logger: { warn: (m) => warns.push(m) },
    });

    // BOTH halves decline — every definition is left entirely alone.
    expect(r.unreadable).toBe(KNOWN_CAPABILITIES.length + DERIVED);
    expect(r.seeded).toBe(0);
    // ⛔ LOAD-BEARING: the derived insert that used to happen here does not.
    expect(broken.calls.insert).toBe(0);
    expect(broken.rows).toHaveLength(before);
    // …and the summary warning covers both halves, so its total is the whole
    // definition set rather than the curated count it would otherwise exceed.
    expect(warns.some((w) => w.includes('capabilities left untouched'))).toBe(true);
  });
});
