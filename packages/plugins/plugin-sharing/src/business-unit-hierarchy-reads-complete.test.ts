// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29655] The `sys_business_unit` hierarchy reads of
 * `BusinessUnitGraphService` answer EVERY unit, or refuse — never a shortened
 * or an invented empty subtree. #29606 closed the member table; this closes
 * the unit table those member reads are keyed by.
 *
 *   1. The seed check (`seedIsUsable`) answered `false` on a read that threw,
 *      and both widths cached that `[]` for the pass — so a business-unit
 *      graph write's recompute read "this rule reaches nobody" and revoked
 *      every grant the rule gave.
 *   2. The descent (`descendants`) read each parent's child units once at a
 *      1,000-row bound and answered `[]` on any failure: a child past the
 *      bound, or every child of a parent whose read failed, left the subtree
 *      with its members.
 *
 * Absence is the one failure that IS an answer — the object is not
 * registered, or its table was never created — checked by
 * `isObjectAbsentError` against `sys_business_unit`.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysBusinessUnit` and `SysBusinessUnitMember`, because
 * completion is a keyset read (`id > cursor`, ordered by `id`) that a double
 * ignoring the cursor cannot vouch for.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysBusinessUnit, SysBusinessUnitMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { BusinessUnitGraphService } from './business-unit-graph.js';

const ORG = 'org_tree';
const ROOT = 'bu_root';
const CHILD = 'bu_child';
/** The bound each child-unit read is paged at. */
const PAGE = 1000;

const pad = (n: number) => String(n).padStart(5, '0');

/** Which `sys_business_unit` read a fault targets. */
type UnitRead = 'seed' | 'descent';

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  /** Every unit of the tree under (and including) ROOT, sorted. */
  units: string[];
  /** Every member of the tree, sorted. */
  members: string[];
  /** The child-unit reads the driver ran for ROOT's children. */
  rootChildReads: () => number;
  /** Fail the next `times` reads of one kind; every other read runs as before. */
  failUnitReads: (which: UnitRead, times?: number) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * ROOT, its child CHILD, and `extra` more child units of ROOT, each with one
 * member. Unit ids are scrambled against creation order, so the 1,001st row by
 * id is not the 1,001st unit created.
 */
async function boot(extra: number, opts: { omit?: string[] } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.business-unit-hierarchy-reads-complete',
    name: 'business unit hierarchy reads complete',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysBusinessUnit, SysBusinessUnitMember].filter((o) => !omit.has(o.name)),
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'tree' }, { context: { isSystem: true } });
  const kids = Array.from({ length: extra }, (_, i) => `bu_kid_${pad((i * 7919) % 100003)}`);
  const units = [ROOT, CHILD, ...kids];
  if (!omit.has('sys_business_unit')) {
    const rows: Record<string, unknown>[] = [
      { id: ROOT, name: 'Root', kind: 'division', active: true, organization_id: ORG },
      { id: CHILD, name: 'Child', kind: 'department', active: true, parent_business_unit_id: ROOT, organization_id: ORG },
      ...kids.map((id) => ({ id, name: id, kind: 'department', active: true, parent_business_unit_id: ROOT, organization_id: ORG })),
    ];
    const d = e.getDriverForObject('sys_business_unit');
    for (let i = 0; i < rows.length; i += 250) await d.bulkCreate('sys_business_unit', rows.slice(i, i + 250));
  }
  const members = units.map((u) => `usr_of_${u}`);
  if (!omit.has('sys_business_unit_member')) {
    const rows = units.map((u, i) => ({
      id: `bum_${pad(i)}`, user_id: `usr_of_${u}`, business_unit_id: u, organization_id: ORG,
    }));
    const d = e.getDriverForObject('sys_business_unit_member');
    for (let i = 0; i < rows.length; i += 250) await d.bulkCreate('sys_business_unit_member', rows.slice(i, i + 250));
  }

  let rootChildReads = 0;
  (driver as any).knex.on('query', (q: { sql: string; bindings?: unknown[] }) => {
    if (/^select .* from [`"]sys_business_unit[`"]/i.test(q.sql) && /parent_business_unit_id/.test(q.sql)
      && (q.bindings ?? []).includes(ROOT)) rootChildReads += 1;
  });
  const failUnitReads = (which: UnitRead, times = Number.POSITIVE_INFINITY) => {
    const d = e.getDriverForObject('sys_business_unit');
    const real = d.find.bind(d);
    let left = times;
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) => {
      const descent = JSON.stringify(rest).includes('parent_business_unit_id');
      if (obj === 'sys_business_unit' && (which === 'descent') === descent && left > 0) {
        left -= 1;
        return Promise.reject(Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }));
      }
      return real(obj, ...rest);
    }) as never);
  };
  return {
    engine, driver, units: [...units].sort(), members: [...members].sort(),
    rootChildReads: () => rootChildReads, failUnitReads,
  };
}

const graph = (rig: Rig) => new BusinessUnitGraphService({ engine: rig.engine as never, organizationId: ORG });

describe('[#29655] a failed seed read refuses, and nothing is cached for it', () => {
  it('⛔ both widths and the descent refuse — none answers an invented empty set', async () => {
    const rig = await boot(0);
    rig.failUnitReads('seed');
    const g = graph(rig);

    await expect(g.expandUnitMembers(ROOT)).rejects.toThrow(/\[sharing\] business unit 'bu_root' could not be read: SQLITE_IOERR/);
    await expect(g.expandUsers(ROOT)).rejects.toThrow(/\[sharing\] business unit 'bu_root' could not be read: SQLITE_IOERR/);
    await expect(g.descendants(ROOT)).rejects.toThrow(/business unit 'bu_root' could not be read/);
  });

  it('⛔ a failed seed read is not cached: the next read on the same pass answers the real set', async () => {
    const rig = await boot(0);
    rig.failUnitReads('seed', 1);
    const g = graph(rig);

    await expect(g.expandUnitMembers(ROOT)).rejects.toThrow(/could not be read/);
    expect(await g.expandUnitMembers(ROOT)).toEqual([`usr_of_${ROOT}`]);

    rig.failUnitReads('seed', 1);
    await expect(g.expandUsers(ROOT)).rejects.toThrow(/could not be read/);
    expect([...(await g.expandUsers(ROOT))].sort()).toEqual(rig.members);
  });
});

describe('[#29655] a failed descent read refuses, and nothing is cached for it', () => {
  it('⛔ the subtree width and the descent refuse — the subtree never shrinks to the seed', async () => {
    const rig = await boot(0);
    rig.failUnitReads('descent');
    const g = graph(rig);

    await expect(g.descendants(ROOT)).rejects.toThrow(
      /\[sharing\] the child units of business unit 'bu_root' could not be read: SQLITE_IOERR/,
    );
    await expect(g.expandUsers(ROOT)).rejects.toThrow(/the child units of business unit 'bu_root' could not be read/);
  });

  it('control — the single-unit width reads no child units, so a failed descent does not touch it', async () => {
    const rig = await boot(0);
    rig.failUnitReads('descent');

    expect(await graph(rig).expandUnitMembers(ROOT)).toEqual([`usr_of_${ROOT}`]);
  });

  it('⛔ a failed descent read is not cached: the next read on the same pass answers the whole subtree', async () => {
    const rig = await boot(0);
    rig.failUnitReads('descent', 1);
    const g = graph(rig);

    await expect(g.descendants(ROOT)).rejects.toThrow(/could not be read/);
    expect([...(await g.descendants(ROOT))].sort()).toEqual(rig.units);
    expect([...(await g.expandUsers(ROOT))].sort()).toEqual(rig.members);
  });
});

describe('[#29655] the descent reads every child unit past the 1,000-row bound', () => {
  it('⭐ 1,001 child units: every unit is in the subtree and every member is in the set', async () => {
    // CHILD plus 1,000 more: 1,001 children of ROOT.
    const rig = await boot(PAGE);
    const g = graph(rig);

    expect([...(await g.descendants(ROOT))].sort()).toEqual(rig.units);
    expect([...(await g.expandUsers(ROOT))].sort()).toEqual(rig.members);
    expect(rig.units).toHaveLength(PAGE + 2);
    expect(rig.rootChildReads()).toBe(2);
  }, 60_000);

  it('control — under the bound: one child-unit read, the same subtree as before', async () => {
    // CHILD plus 998 more: 999 children of ROOT.
    const rig = await boot(PAGE - 2);
    const g = graph(rig);

    expect([...(await g.descendants(ROOT))].sort()).toEqual(rig.units);
    expect(rig.rootChildReads()).toBe(1);
  }, 60_000);
});

describe('[#29655] absence still answers nobody', () => {
  it('a composition that never registers sys_business_unit has no units: [] as before', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit'] });
    const g = graph(rig);

    expect(await g.descendants(ROOT)).toEqual([]);
    expect(await g.expandUnitMembers(ROOT)).toEqual([]);
    expect(await g.expandUsers(ROOT)).toEqual([]);
  });

  it('a stack whose sys_business_unit table was never created has no units: [] as before', async () => {
    const rig = await boot(0);
    await (rig.driver as any).knex.schema.dropTable('sys_business_unit');
    const g = graph(rig);

    expect(await g.descendants(ROOT)).toEqual([]);
    expect(await g.expandUnitMembers(ROOT)).toEqual([]);
    expect(await g.expandUsers(ROOT)).toEqual([]);
  });
});
