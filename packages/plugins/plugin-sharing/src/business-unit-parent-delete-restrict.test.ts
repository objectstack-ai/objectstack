// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24939] Deleting a business unit that still has child units is REFUSED.
 *
 * `sys_business_unit.parent_business_unit_id` used to declare no
 * `deleteBehavior`, so it took the lookup default `set_null`: deleting a unit
 * answered 200 and silently made each child a root of the tenant. The tree is
 * what a `unit_and_subordinates` sharing rule walks
 * (`BusinessUnitGraphService.descendants`), so a grant anchored above the
 * deleted unit stopped reaching the former subtree, with no word to the
 * administrator. The field now declares `restrict`.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the SHIPPED `SysBusinessUnit` from `@objectstack/platform-objects`,
 * because the refusal is the engine's referential pass reading the built
 * declaration — a fake engine would pin only itself. It lives here rather than
 * in `platform-objects`, which has no engine or driver among its dependencies;
 * plugin-sharing has both, and owns the subtree walk the refusal protects.
 *
 * Every platform deleter of this object is pinned to still complete on a tree:
 *   - by id (`DELETE /api/v1/data/sys_business_unit/:id`): a leaf deletes;
 *   - in bulk (`deleteManyData` and `batchData`'s delete case, a per-id loop in
 *     the caller's order, its `atomic` arm one transaction): leaf to root
 *     completes, root first refuses the root alone;
 *   - an organization's delete: [#24948] a business unit is a record the
 *     organization owns, so the organization is refused while its units remain
 *     (`DELETE_RESTRICTED`, every unit counted) and the tree is left whole;
 *     once the units are deleted, leaf to root, the organization deletes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysBusinessUnit, SysOrganization } from '@objectstack/platform-objects/identity';

const SYS = { isSystem: true, userId: 'usr_admin' } as any;
const ORG = 'org_qa';

const openEngines: ObjectQL[] = [];
afterEach(async () => {
  while (openEngines.length) {
    try { await openEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** A real engine carrying the shipped business-unit (and organization) objects. */
async function boot(): Promise<ObjectQL> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();
  const engine = new ObjectQL();
  openEngines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const def of [SysOrganization, SysBusinessUnit]) {
    engine.registry.registerObject(def as never, 'platform-objects', 'sys');
  }
  await engine.syncSchemas();
  // The organization every unit belongs to: with `sys_organization` registered,
  // a system write on a tenant-scoped object must carry one.
  await engine.insert('sys_organization', { id: ORG, name: 'QA Org', slug: 'qa-org' }, { context: SYS });
  return engine;
}

/** The card's tree, one level deeper: QA EMEA → QA EMEA Office → QA EMEA Desk. */
async function seedTree(engine: ObjectQL): Promise<void> {
  for (const [id, name, parent] of [
    ['bu_emea', 'QA EMEA', null],
    ['bu_office', 'QA EMEA Office', 'bu_emea'],
    ['bu_desk', 'QA EMEA Desk', 'bu_office'],
  ] as const) {
    await engine.insert(
      'sys_business_unit',
      { id, name, kind: 'department', parent_business_unit_id: parent, organization_id: ORG },
      { context: SYS },
    );
  }
}

/** `id → parent id` for every unit still present. */
async function tree(engine: ObjectQL): Promise<Record<string, string | null>> {
  const rows = (await engine.find('sys_business_unit', { where: {}, context: SYS })) as Array<Record<string, any>>;
  return Object.fromEntries(rows.map((r) => [r.id, r.parent_business_unit_id ?? null]));
}

const del = (engine: ObjectQL, id: string, context: any = SYS) =>
  engine.delete('sys_business_unit', { where: { id }, context });

describe('#24939 a business unit with child units refuses its delete (real engine, shipped object)', () => {
  it('declares restrict on the parent link', () => {
    expect((SysBusinessUnit.fields as any).parent_business_unit_id.deleteBehavior).toBe('restrict');
  });

  it('refuses a unit with children with 409 DELETE_RESTRICTED, and its children keep their parent', async () => {
    const engine = await boot();
    await seedTree(engine);

    const err: any = await del(engine, 'bu_emea').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    // What tells the administrator to re-parent first: the blocking object
    // and how many of its rows hold the link.
    expect(err.dependentObject).toBe('sys_business_unit');
    expect(err.dependentCount).toBe(1);

    expect(await tree(engine)).toEqual({ bu_emea: null, bu_office: 'bu_emea', bu_desk: 'bu_office' });
  });

  it('deletes a leaf unit', async () => {
    const engine = await boot();
    await seedTree(engine);

    await expect(del(engine, 'bu_desk')).resolves.toBe(true);
    expect(await tree(engine)).toEqual({ bu_emea: null, bu_office: 'bu_emea' });
  });

  it('a unit whose children were re-parented deletes, and the children keep their new parent', async () => {
    const engine = await boot();
    await seedTree(engine);
    await engine.update(
      'sys_business_unit',
      { id: 'bu_desk', parent_business_unit_id: 'bu_emea' },
      { where: { id: 'bu_desk' }, context: SYS } as any,
    );

    await expect(del(engine, 'bu_office')).resolves.toBe(true);
    expect(await tree(engine)).toEqual({ bu_emea: null, bu_desk: 'bu_emea' });
  });

  it('bulk, leaf to root (the per-id loop of deleteManyData / batchData) completes on the tree', async () => {
    const engine = await boot();
    await seedTree(engine);

    for (const id of ['bu_desk', 'bu_office', 'bu_emea']) await expect(del(engine, id)).resolves.toBe(true);
    expect(await tree(engine)).toEqual({});
  });

  it('bulk, leaf to root, in one transaction (the atomic arm) completes on the tree', async () => {
    const engine = await boot();
    await seedTree(engine);

    await engine.transaction(async (trxCtx: any) => {
      for (const id of ['bu_desk', 'bu_office', 'bu_emea']) await del(engine, id, trxCtx);
    }, SYS);
    expect(await tree(engine)).toEqual({});
  });

  it('bulk, root first: the root alone is refused, and its subtree is left whole', async () => {
    const engine = await boot();
    await seedTree(engine);

    const first: any = await del(engine, 'bu_emea').catch((e) => e);
    expect(first.code).toBe('DELETE_RESTRICTED');
    expect(first.status).toBe(409);
    expect(await tree(engine)).toEqual({ bu_emea: null, bu_office: 'bu_emea', bu_desk: 'bu_office' });
  });

  it("[#24948] an organization's delete is refused while it owns units, and the tree is left whole", async () => {
    const engine = await boot();
    await seedTree(engine);

    const err: any = await engine.delete('sys_organization', { where: { id: ORG }, context: SYS }).catch((e) => e);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependents).toEqual([{ object: 'sys_business_unit', count: 3 }]);
    expect(await tree(engine)).toEqual({ bu_emea: null, bu_office: 'bu_emea', bu_desk: 'bu_office' });
  });

  it('[#24948] CONTROL: once its units are deleted, leaf to root, the organization deletes', async () => {
    const engine = await boot();
    await seedTree(engine);

    for (const id of ['bu_desk', 'bu_office', 'bu_emea']) await expect(del(engine, id)).resolves.toBe(true);
    await expect(engine.delete('sys_organization', { where: { id: ORG }, context: SYS })).resolves.toBe(true);
    expect(await tree(engine)).toEqual({});
  });
});
