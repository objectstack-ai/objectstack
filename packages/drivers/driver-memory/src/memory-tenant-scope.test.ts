// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-side tenant scoping on the in-memory driver (#16589).
 *
 * ## The control has to be able to fail, and this is what it takes
 *
 * The defect being closed is precisely a suite that could not fail: an app
 * asserting "tenant A cannot see tenant B's rows" passed on this driver not
 * because isolation worked but because every tenant's rows came back to
 * everyone and the assertion had been written against a SINGLE tenant's
 * fixture. Reproducing that shape here would be self-parody, so the fixture is
 * built the other way round and every case asserts BOTH directions:
 *
 *  - **two organizations are always seeded**, so "returns nothing" and
 *    "returns everything" are distinguishable answers;
 *  - **an org-less row is always seeded**, so the #2734 global-row carve-out
 *    has something to be right or wrong about — a fixture without one cannot
 *    tell correct scoping from `WHERE org = :tenant`, which would hide every
 *    platform row from every tenant;
 *  - every scoped case asserts the caller's OWN rows are still returned, so a
 *    scope that simply answers empty fails here rather than reading as a pass.
 *
 * ⚠️ What the fixture DROPS, stated rather than implied: it is a driver-level
 * fixture, so it exercises `DriverOptions` and not the engine that fills them
 * (`Engine.buildDriverOptions` — the producer half is `packages/objectql`'s),
 * and it never boots a walled posture, because the boot guard refuses one and
 * that refusal has its own suite (`memory-tenancy-guard.test.ts`). `distinct()`
 * is absent for a structural reason named in its own case below.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { tenantScopePredicate } from './memory-tenant-scope.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';

/** The card's case exactly: a tenant column, and NO `tenancy` block at all. */
const EMPLOYER_SCHEMA = {
  name: 'ats_employer',
  fields: {
    id: { type: 'string' },
    name: { type: 'string' },
    // The column `applySystemFields` injects into every object it registers.
    organization_id: { type: 'string' },
  },
};

/** ADR-0066's platform-global posture — the objects that AGREED across drivers. */
const LICENSE_SCHEMA = {
  name: 'sys_license',
  fields: {
    id: { type: 'string' },
    organization_id: { type: 'string' },
  },
  tenancy: { enabled: false },
};

/** No tenant column at all: nothing to scope by, on any driver. */
const NOTE_SCHEMA = {
  name: 'note',
  fields: { id: { type: 'string' }, body: { type: 'string' } },
};

/** A wall drawn by a column that deliberately is not the platform's. */
const WORKSPACE_ITEM_SCHEMA = {
  name: 'workspace_item',
  fields: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    organization_id: { type: 'string' },
  },
  tenancy: { tenantField: 'workspace_id' },
};

/**
 * Two organizations plus one org-less row, on every object.
 *
 * `a1`/`a2` belong to A, `b1` to B, `g1` to nobody. A correct scope for A
 * answers `[a1, a2, g1]`; the pre-#16589 driver answered all four; a scope
 * without the global carve-out answers `[a1, a2]`; a broken scope answers `[]`.
 * All four are distinguishable, which is the point.
 */
async function seed(driver: InMemoryDriver, schema: Record<string, unknown> = EMPLOYER_SCHEMA) {
  const object = schema.name as string;
  await driver.syncSchema(object, schema);
  const tenantField = (schema as any).tenancy?.tenantField ?? 'organization_id';
  await driver.bulkCreate(object, [
    { id: 'a1', name: 'A one', [tenantField]: ORG_A },
    { id: 'a2', name: 'A two', [tenantField]: ORG_A },
    { id: 'b1', name: 'B one', [tenantField]: ORG_B },
    { id: 'g1', name: 'global' },
  ]);
  return object;
}

function ids(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((r) => String(r.id)).sort();
}

function makeDriver() {
  return new InMemoryDriver({ persistence: false });
}

describe('#16589 — the in-memory driver honours DriverOptions.tenantId', () => {
  describe('the binding control: a cross-organization read', () => {
    it('returns ONLY this organization plus org-less rows — never the other organization', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      const scoped = await driver.find(object, {}, { tenantId: ORG_A });

      // The half that fails when the fix is absent: B's row must not be here.
      expect(ids(scoped)).not.toContain('b1');
      // The half that fails when the scope is merely "return nothing": A's own
      // rows, and the org-less platform row, must still be here.
      expect(ids(scoped)).toEqual(['a1', 'a2', 'g1']);

      // And the mirror image, so a scope hard-wired to one organization fails.
      const other = await driver.find(object, {}, { tenantId: ORG_B });
      expect(ids(other)).toEqual(['b1', 'g1']);
    });

    it('leaves an unscoped caller reading everything — the seed / admin path', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      expect(ids(await driver.find(object, {}))).toEqual(['a1', 'a2', 'b1', 'g1']);
      // An empty tenantId is the same "no tenant supplied" fact, spelled the
      // way `applyTenantScope` early-outs on it.
      expect(ids(await driver.find(object, {}, { tenantId: '' }))).toEqual(['a1', 'a2', 'b1', 'g1']);
    });

    it('composes with the caller\'s own filter instead of replacing it', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      const rows = await driver.find(
        object,
        { where: { type: 'comparison', field: 'name', operator: '!=', value: 'global' } },
        { tenantId: ORG_A },
      );
      expect(ids(rows)).toEqual(['a1', 'a2']);
    });
  });

  describe('the declaration decides, exactly as it does on driver-sql', () => {
    it('scopes an object that OMITS the tenancy block — the case the engine scopes', async () => {
      const driver = makeDriver();
      const object = await seed(driver, EMPLOYER_SCHEMA);
      expect(ids(await driver.find(object, {}, { tenantId: ORG_A }))).toEqual(['a1', 'a2', 'g1']);
    });

    it('does NOT scope an explicit `tenancy.enabled: false` (ADR-0066 platform-global)', async () => {
      const driver = makeDriver();
      const object = await seed(driver, LICENSE_SCHEMA);
      expect(ids(await driver.find(object, {}, { tenantId: ORG_A }))).toEqual(['a1', 'a2', 'b1', 'g1']);
    });

    it('does NOT scope an object with no tenant column', async () => {
      const driver = makeDriver();
      await driver.syncSchema('note', NOTE_SCHEMA);
      await driver.bulkCreate('note', [
        { id: 'n1', body: 'one', organization_id: ORG_A },
        { id: 'n2', body: 'two', organization_id: ORG_B },
      ]);
      // `organization_id` is present in the DATA but not in the DECLARED
      // fields, so there is no tenant column and nothing to scope by — the same
      // answer `SqlDriver.computeTenantField` gives.
      expect(ids(await driver.find('note', {}, { tenantId: ORG_A }))).toEqual(['n1', 'n2']);
    });

    it('honours a declared `tenancy.tenantField` over the implicit organization_id', async () => {
      const driver = makeDriver();
      const object = await seed(driver, WORKSPACE_ITEM_SCHEMA);
      // Rows were stamped on `workspace_id`; `organization_id` is absent from
      // all of them. Scoping by the declared column answers A's rows; scoping
      // by the implicit one would answer all four (every row org-less).
      expect(ids(await driver.find(object, {}, { tenantId: ORG_A }))).toEqual(['a1', 'a2', 'g1']);
    });

    it('keeps a sticky opt-out across a PARTIAL re-registration (#3249)', async () => {
      const driver = makeDriver();
      const object = await seed(driver, LICENSE_SCHEMA);
      // The lifecycle archive path re-syncs with `{ name, fields }` and no
      // `tenancy`. Letting the implicit heuristic re-scope here would hide
      // every org-less platform row from every tenant.
      await driver.syncSchema(object, { name: object, fields: LICENSE_SCHEMA.fields });
      expect(ids(await driver.find(object, {}, { tenantId: ORG_A }))).toEqual(['a1', 'a2', 'b1', 'g1']);
    });

    it('re-scopes when a later schema DECLARES tenancy again', async () => {
      const driver = makeDriver();
      const object = await seed(driver, LICENSE_SCHEMA);
      await driver.syncSchema(object, { ...LICENSE_SCHEMA, tenancy: {} });
      expect(ids(await driver.find(object, {}, { tenantId: ORG_A }))).toEqual(['a1', 'a2', 'g1']);
    });
  });

  describe('ADR-0105 D2 union scope (`group` posture)', () => {
    it('widens to the whole membership set instead of ANDing the active org', async () => {
      const driver = makeDriver();
      const object = await seed(driver);
      const rows = await driver.find(object, {}, { tenantId: ORG_A, tenantIds: [ORG_A, ORG_B] });
      expect(ids(rows)).toEqual(['a1', 'a2', 'b1', 'g1']);
    });

    it('falls back to equality on a malformed or empty set — toward isolation', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      expect(ids(await driver.find(object, {}, { tenantId: ORG_A, tenantIds: [] })))
        .toEqual(['a1', 'a2', 'g1']);
      expect(
        ids(await driver.find(object, {}, { tenantId: ORG_A, tenantIds: ['', ''] as string[] })),
      ).toEqual(['a1', 'a2', 'g1']);
    });
  });

  describe('every door that takes DriverOptions', () => {
    it('findOne cannot reach another organization row by id', async () => {
      const driver = makeDriver();
      const object = await seed(driver);
      const where = { type: 'comparison', field: 'id', operator: '=', value: 'b1' } as const;

      expect(await driver.findOne(object, { where }, { tenantId: ORG_A })).toBeNull();
      expect(await driver.findOne(object, { where }, { tenantId: ORG_B })).toMatchObject({ id: 'b1' });
    });

    it('count counts only what this organization can read', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      expect(await driver.count(object, {}, { tenantId: ORG_A })).toBe(3);
      expect(await driver.count(object, {}, { tenantId: ORG_B })).toBe(2);
      expect(await driver.count(object, {})).toBe(4);
    });

    it('aggregate answers over the scoped rows on BOTH of its arms', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      // AST arm — what objectql's engine sends.
      const ast = await driver.aggregate(
        object,
        { aggregations: [{ function: 'count', field: 'id', alias: 'n' }] } as any,
        { tenantId: ORG_A },
      );
      expect(ast[0]?.n).toBe(3);

      // Pipeline arm — what `memory-analytics.ts` sends.
      const pipeline = await driver.aggregate(
        object,
        [{ $group: { _id: null, n: { $sum: 1 } } }],
        { tenantId: ORG_A },
      );
      expect(pipeline[0]?.n).toBe(3);
    });

    it('update by id treats another organization row as not found', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      expect(await driver.update(object, 'b1', { name: 'hijacked' }, { tenantId: ORG_A })).toBeNull();
      const [b1] = await driver.find(
        object,
        { where: { type: 'comparison', field: 'id', operator: '=', value: 'b1' } },
      );
      expect(b1.name).toBe('B one');

      // Positive control: the same call inside the organization still works.
      expect(await driver.update(object, 'a1', { name: 'renamed' }, { tenantId: ORG_A }))
        .toMatchObject({ id: 'a1', name: 'renamed' });
    });

    it('delete by id treats another organization row as not found', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      expect(await driver.delete(object, 'b1', { tenantId: ORG_A })).toBe(false);
      expect(await driver.delete(object, 'a1', { tenantId: ORG_A })).toBe(true);
      expect(ids(await driver.find(object, {}))).toEqual(['a2', 'b1', 'g1']);
    });

    it('updateMany rewrites only this organization', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      expect(await driver.updateMany(object, {}, { name: 'stamped' }, { tenantId: ORG_A })).toBe(3);
      const all = await driver.find(object, {});
      expect(all.find((r) => r.id === 'b1')?.name).toBe('B one');
      expect(all.find((r) => r.id === 'a1')?.name).toBe('stamped');
    });

    it('deleteMany with no filter empties only this organization', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      // The worst-shaped case of the old silence: "delete all" scoped to one
      // organization used to empty the table for every organization.
      expect(await driver.deleteMany(object, {}, { tenantId: ORG_A })).toBe(3);
      expect(ids(await driver.find(object, {}))).toEqual(['b1']);
    });

    it('bulkUpdate and bulkDelete skip ids belonging to another organization', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      const updated = await driver.bulkUpdate(
        object,
        [{ id: 'a1', data: { name: 'mine' } }, { id: 'b1', data: { name: 'theirs' } }],
        { tenantId: ORG_A },
      );
      expect(ids(updated)).toEqual(['a1']);

      await driver.bulkDelete(object, ['a2', 'b1'], { tenantId: ORG_A });
      expect(ids(await driver.find(object, {}))).toEqual(['a1', 'b1', 'g1']);
    });

    it('upsert inserts rather than rewriting a row it cannot see', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      await driver.upsert(object, { name: 'A three' }, ['name'], { tenantId: ORG_A });
      expect((await driver.find(object, {})).length).toBe(5);

      // Conflicting on B's row from inside A does not touch it.
      await driver.upsert(object, { name: 'B one', organization_id: ORG_A }, ['name'], { tenantId: ORG_A });
      const b1 = (await driver.find(object, {})).find((r) => r.id === 'b1');
      expect(b1).toMatchObject({ organization_id: ORG_B });
    });

    it('distinct() is NOT scoped — the one door with no DriverOptions to scope by', async () => {
      const driver = makeDriver();
      const object = await seed(driver);

      // Pinned as a KNOWN unscoped face rather than left to be discovered:
      // `distinct(object, field, query?)` accepts no `DriverOptions`, so a
      // caller has nowhere to pass a tenant. `driver-sql`'s `distinct` DOES
      // scope. Nothing in this repository calls `driver.distinct()`; if a
      // producer ever appears, this expectation is the thing that has to change
      // with it.
      const values = await driver.distinct(object, 'organization_id');
      expect([...values].sort()).toEqual([ORG_A, ORG_B]);
    });
  });

  describe('the predicate itself', () => {
    it('is null — no per-row work at all — on every unscoped arm', () => {
      expect(tenantScopePredicate('organization_id', undefined)).toBeNull();
      expect(tenantScopePredicate('organization_id', {})).toBeNull();
      expect(tenantScopePredicate('organization_id', { tenantId: '' })).toBeNull();
      expect(tenantScopePredicate(null, { tenantId: ORG_A })).toBeNull();
    });

    it('reads an absent key and an explicit null as the same global row', () => {
      const predicate = tenantScopePredicate('organization_id', { tenantId: ORG_A });
      expect(predicate).not.toBeNull();
      expect(predicate!({ id: 'x' })).toBe(true);
      expect(predicate!({ id: 'x', organization_id: null })).toBe(true);
      expect(predicate!({ id: 'x', organization_id: ORG_A })).toBe(true);
      expect(predicate!({ id: 'x', organization_id: ORG_B })).toBe(false);
      // An empty string is NOT null — it is a value, and it is not this org.
      expect(predicate!({ id: 'x', organization_id: '' })).toBe(false);
    });
  });
});
