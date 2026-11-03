// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29606] The `sys_business_unit_member` reads answer EVERY member, or refuse
 * — never a shortened or an invented empty set. The family #29362 and #29503
 * closed for the team, role and position reads.
 *
 *   1. `BusinessUnitGraphService.expandUnitMembers` (the `business_unit`
 *      recipient) and `expandUsers` (`unit_and_subordinates`) read once at a
 *      10,000-row bound and answered `[]` on any failure. The set feeds
 *      sharing GRANTS the reconcilers diff against it: a member past the bound
 *      lost the grant, and a failed read revoked every member's.
 *   2. The boot backfill of `sys_user.primary_business_unit_id` scanned the
 *      `is_primary` rows once at the same bound, so a stack with more primary
 *      memberships never projected the rest, with no signal.
 *
 * Absence is the one failure that IS an answer — the object is not
 * registered, or its table was never created — checked by
 * `isObjectAbsentError` against the object read.
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
import { backfillPrimaryBu } from './primary-bu-projection.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const ROOT = 'bu_root';
const CHILD = 'bu_child';
const OTHER = 'bu_other';
/** The bound each member read is paged at. */
const PAGE = 10000;

const pad = (n: number) => String(n).padStart(6, '0');

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  /** Every seeded member, sorted. */
  holders: string[];
  /** The `sys_business_unit_member` reads the driver ran. */
  reads: () => number;
  /** Make every driver read of `object` throw; other objects read as before. */
  failReadsOf: (object: string) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `n` members in {@link ORG}, every one flagged `is_primary`: the even ones on
 * {@link ROOT}, the odd ones on its child {@link CHILD} — or all on ROOT with
 * `split: false`. Plus the rows the predicates must keep out: a member of
 * another unit, and a member of ROOT stamped with another organization. Row
 * ids are scrambled against user ids, so the 10,001st row by id is not the
 * 10,001st user.
 */
async function boot(n: number, opts: { omit?: string[]; split?: boolean } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.business-unit-member-reads-complete',
    name: 'business unit member reads complete',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysBusinessUnit, SysBusinessUnitMember].filter((o) => !omit.has(o.name)),
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'large' }, { context: { isSystem: true } });
  await e.insert('sys_organization', { id: ELSEWHERE, name: ELSEWHERE, slug: 'elsewhere' }, { context: { isSystem: true } });
  const units = e.getDriverForObject('sys_business_unit');
  await units.bulkCreate('sys_business_unit', [
    { id: ROOT, name: 'Root', kind: 'division', active: true, organization_id: ORG },
    { id: CHILD, name: 'Child', kind: 'department', active: true, parent_business_unit_id: ROOT, organization_id: ORG },
    { id: OTHER, name: 'Other', kind: 'department', active: true, organization_id: ORG },
  ]);

  const holders = Array.from({ length: n }, (_, i) => `usr_${pad(i)}`);
  if (!omit.has('sys_business_unit_member')) {
    const id = (i: number) => `bum_${pad((i * 7919) % 1000003)}`;
    const split = opts.split ?? true;
    const rows: Record<string, unknown>[] = holders.map((user_id, i) => ({
      id: id(i), user_id, business_unit_id: split && i % 2 ? CHILD : ROOT, is_primary: true, organization_id: ORG,
    }));
    rows.push({ id: 'bum_other_unit', user_id: 'usr_other_unit', business_unit_id: OTHER, is_primary: false, organization_id: ORG });
    rows.push({ id: 'bum_elsewhere', user_id: 'usr_elsewhere', business_unit_id: ROOT, is_primary: false, organization_id: ELSEWHERE });
    const d = e.getDriverForObject('sys_business_unit_member');
    for (let i = 0; i < rows.length; i += 250) await d.bulkCreate('sys_business_unit_member', rows.slice(i, i + 250));
  }

  let count = 0;
  (driver as any).knex.on('query', (q: { sql: string }) => {
    if (/^select .* from [`"]sys_business_unit_member[`"]/i.test(q.sql)) count += 1;
  });
  const failReadsOf = (object: string) => {
    const d = e.getDriverForObject(object);
    const real = d.find.bind(d);
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) =>
      obj === object
        ? Promise.reject(Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }))
        : real(obj, ...rest)) as never);
  };
  return { engine, driver, holders: [...holders].sort(), reads: () => count, failReadsOf };
}

const graph = (rig: Rig) => new BusinessUnitGraphService({ engine: rig.engine as never, organizationId: ORG });

describe('[#29606] site 1 — BusinessUnitGraphService.expandUnitMembers reads every member of the unit', () => {
  it('⭐ past the 10,000-row bound: every member is in the set, and no one else', async () => {
    const rig = await boot(PAGE + 1, { split: false });
    const users = await graph(rig).expandUnitMembers(ROOT);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_other_unit');
    expect(users).not.toContain('usr_elsewhere');
    expect(rig.reads()).toBe(2);
  }, 30_000);

  it('control — under the bound: one read, the same set as before', async () => {
    const rig = await boot(PAGE - 1, { split: false });
    const users = await graph(rig).expandUnitMembers(ROOT);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads()).toBe(1);
  }, 30_000);

  it('⛔ a read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot(3, { split: false });
    rig.failReadsOf('sys_business_unit_member');

    await expect(graph(rig).expandUnitMembers(ROOT)).rejects.toThrow(
      /members of business unit 'bu_root' could not be read: SQLITE_IOERR/,
    );
  });

  it('⛔ a failed read is not cached: the next read answers the real members', async () => {
    const rig = await boot(3, { split: false });
    // One driver serves every object, so the fault is keyed to the member read
    // and fires once: the unit's seed check before it reads as normal.
    const d = (rig.engine as any).getDriverForObject('sys_business_unit_member');
    const real = d.find.bind(d);
    let faults = 1;
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) =>
      obj === 'sys_business_unit_member' && faults-- > 0
        ? Promise.reject(new Error('SQLITE_BUSY: database is locked'))
        : real(obj, ...rest)) as never);
    const g = graph(rig);

    await expect(g.expandUnitMembers(ROOT)).rejects.toThrow(/could not be read/);
    expect([...(await g.expandUnitMembers(ROOT))].sort()).toEqual(rig.holders);
  });

  it('a composition that never registers sys_business_unit_member has no members: [] as before', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit_member'] });

    expect(await graph(rig).expandUnitMembers(ROOT)).toEqual([]);
  });

  it('a stack whose sys_business_unit_member table was never created has no members: [] as before', async () => {
    const rig = await boot(0);
    await (rig.driver as any).knex.schema.dropTable('sys_business_unit_member');

    expect(await graph(rig).expandUnitMembers(ROOT)).toEqual([]);
  });
});

describe('[#29606] site 2 — BusinessUnitGraphService.expandUsers reads every member of the subtree', () => {
  it('⭐ past the 10,000-row bound: every member of the unit and its child is in the set, and no one else', async () => {
    const rig = await boot(PAGE + 1);
    const users = await graph(rig).expandUsers(ROOT);

    expect([...users].sort()).toEqual(rig.holders);
    expect(users).not.toContain('usr_other_unit');
    expect(users).not.toContain('usr_elsewhere');
    expect(rig.reads()).toBe(2);
  }, 30_000);

  it('control — under the bound: one read, the same set as before', async () => {
    const rig = await boot(PAGE - 1);
    const users = await graph(rig).expandUsers(ROOT);

    expect([...users].sort()).toEqual(rig.holders);
    expect(rig.reads()).toBe(1);
  }, 30_000);

  it('⛔ a read that fails refuses — it never answers an invented empty set', async () => {
    const rig = await boot(3);
    rig.failReadsOf('sys_business_unit_member');

    await expect(graph(rig).expandUsers(ROOT)).rejects.toThrow(
      /members of business unit 'bu_root' and its descendant units could not be read: SQLITE_IOERR/,
    );
  });

  it('a composition that never registers sys_business_unit_member has no members: [] as before', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit_member'] });

    expect(await graph(rig).expandUsers(ROOT)).toEqual([]);
  });
});

describe('[#29606] site 3 — the primary-business-unit backfill scans every primary membership', () => {
  /** The real engine's reads; the `sys_user` writes counted, not performed. */
  const backfillEngine = (rig: Rig) => {
    const update = vi.fn(async (_object: string, data: Record<string, unknown>) => data);
    const engine = {
      registerHook: vi.fn(),
      unregisterHooksByPackage: vi.fn(() => 0),
      find: (object: string, query?: unknown) => (rig.engine as any).find(object, query),
      update,
    };
    return { engine, update };
  };
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  it('⭐ past the 10,000-row bound: every primary membership is projected', async () => {
    const rig = await boot(PAGE + 1);
    const { engine, update } = backfillEngine(rig);
    const log = logger();

    expect(await backfillPrimaryBu(engine, log)).toEqual({ updated: PAGE + 1, refused: 0 });
    const projected = update.mock.calls.map(([, data]) => String(data.id)).sort();
    expect(projected).toEqual(rig.holders);
    expect(rig.reads()).toBe(2);
    expect(log.warn).not.toHaveBeenCalled();
  }, 30_000);

  it('control — under the bound: one read, every primary membership projected', async () => {
    const rig = await boot(PAGE - 1);
    const { engine, update } = backfillEngine(rig);

    expect(await backfillPrimaryBu(engine, logger())).toEqual({ updated: PAGE - 1, refused: 0 });
    expect(update).toHaveBeenCalledTimes(PAGE - 1);
    expect(rig.reads()).toBe(1);
  }, 30_000);

  it('⛔ a scan that fails writes nothing and says so, carrying the error', async () => {
    const rig = await boot(3);
    rig.failReadsOf('sys_business_unit_member');
    const { engine, update } = backfillEngine(rig);
    const log = logger();

    expect(await backfillPrimaryBu(engine, log)).toEqual({ updated: 0, refused: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = log.warn.mock.calls[0];
    expect(message).toMatch(/backfill scan of sys_business_unit_member failed/);
    expect(meta.error).toMatch(/SQLITE_IOERR/);
  });

  it('a composition that never registers sys_business_unit_member has nothing to project, and says nothing', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit_member'] });
    const { engine, update } = backfillEngine(rig);
    const log = logger();

    expect(await backfillPrimaryBu(engine, log)).toEqual({ updated: 0, refused: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
