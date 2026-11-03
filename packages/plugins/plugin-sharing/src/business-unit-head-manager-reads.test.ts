// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29713] `BusinessUnitGraphService.headOf` and the standalone `managerOf`
 * fallback answer the real head or manager, or refuse — never an invented
 * "nobody" on a read that failed. #29606 and #29655 closed the member, seed
 * and descent reads of the same service; these were the two left.
 *
 *   1. `headOf` caught any error from its `sys_business_unit` read to `null`
 *      and cached that `null` for the pass, so the head stayed missing after
 *      the read recovered.
 *   2. The standalone `managerOf` (no `TeamGraphService` wired) caught any
 *      error from its `sys_user` read to `null`. It caches nothing.
 *   3. [#29792] `TeamGraphService.managerOf` — the wired limb, and the
 *      `manager` arm of `expandPrincipal` — caught any error from its own
 *      `sys_user` read to `null` and cached that `null` under `org::userId`
 *      for the pass, so the manager stayed missing after the read recovered.
 *
 * Absence is the one failure that IS an answer — the object is not
 * registered, or its table was never created — judged by `isObjectAbsentError`
 * through `readMembershipToCompletion`, the walk `seedIsUsable` reads with.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped identity objects, so "absent" is what a real driver
 * answers for a missing object or table, not what a double guesses.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysBusinessUnit, SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { BusinessUnitGraphService } from './business-unit-graph.js';
import { TeamGraphService, expandPrincipal } from './team-graph.js';

const ORG = 'org_head';
const UNIT = 'bu_sales';
const HEADLESS = 'bu_headless';
const HEAD = 'usr_head';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  /** Fail the next `times` reads of `object`; every other read runs as before. */
  failReads: (object: 'sys_business_unit' | 'sys_user' | 'sys_member', times?: number) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** UNIT headed by HEAD, HEADLESS with no head; ALICE managed by BOB, both members of ORG. */
async function boot(opts: { omit?: string[] } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.business-unit-head-manager-reads',
    name: 'business unit head and manager reads',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysBusinessUnit, SysUser, SysMember].filter((o) => !omit.has(o.name)),
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'head' }, { context: { isSystem: true } });
  if (!omit.has('sys_business_unit')) {
    await e.getDriverForObject('sys_business_unit').bulkCreate('sys_business_unit', [
      { id: UNIT, name: 'Sales', kind: 'department', active: true, manager_user_id: HEAD, organization_id: ORG },
      { id: HEADLESS, name: 'Headless', kind: 'department', active: true, organization_id: ORG },
    ]);
  }
  if (!omit.has('sys_user')) {
    await e.getDriverForObject('sys_user').bulkCreate('sys_user', [
      { id: ALICE, name: 'Alice', email: 'alice@example.test', manager_id: BOB },
      { id: BOB, name: 'Bob', email: 'bob@example.test' },
    ]);
  }
  await e.getDriverForObject('sys_member').bulkCreate('sys_member', [
    { id: 'mem_alice', user_id: ALICE, organization_id: ORG, role: 'member' },
    { id: 'mem_bob', user_id: BOB, organization_id: ORG, role: 'member' },
  ]);

  // The driver's own `find`, taken once: a second fault wraps it again rather
  // than wrapping the first fault's spy.
  const d = e.getDriverForObject('sys_organization');
  const real = d.find.bind(d);
  const failReads: Rig['failReads'] = (object, times = Number.POSITIVE_INFINITY) => {
    let left = times;
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) => {
      if (obj === object && left > 0) {
        left -= 1;
        return Promise.reject(Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }));
      }
      return real(obj, ...rest);
    }) as never);
  };
  return { engine, driver, failReads };
}

const graph = (rig: Rig, extra: { teamGraph?: TeamGraphService } = {}) =>
  new BusinessUnitGraphService({ engine: rig.engine as never, organizationId: ORG, ...extra });

const team = (rig: Rig) => new TeamGraphService({ engine: rig.engine as never, organizationId: ORG });

/** An answer or a refusal, as one comparable value. */
const settled = (p: Promise<unknown>) =>
  p.then((value) => ({ value }), (err: unknown) => ({ refused: err instanceof Error ? err.message : String(err) }));

describe('[#29713] headOf: a failed unit read refuses, and nothing is cached for it', () => {
  it('control — a healthy read answers the head, and a unit with no head answers null', async () => {
    const g = graph(await boot());

    expect(await g.headOf(UNIT)).toBe(HEAD);
    expect(await g.headOf(HEADLESS)).toBeNull();
  });

  it('⛔ a failed read refuses — it never answers an invented null', async () => {
    const rig = await boot();
    rig.failReads('sys_business_unit');

    await expect(graph(rig).headOf(UNIT)).rejects.toThrow(
      /\[sharing\] the head of business unit 'bu_sales' could not be read: SQLITE_IOERR/,
    );
  });

  it('⛔ a failed read is not cached: the next read on the same pass answers the real head', async () => {
    const rig = await boot();
    rig.failReads('sys_business_unit', 1);
    const g = graph(rig);

    await expect(g.headOf(UNIT)).rejects.toThrow(/could not be read/);
    expect(await g.headOf(UNIT)).toBe(HEAD);
  });

  it('absence — a composition that never registers sys_business_unit has no head: null', async () => {
    const g = graph(await boot({ omit: ['sys_business_unit'] }));

    expect(await g.headOf(UNIT)).toBeNull();
  });

  it('absence — a stack whose sys_business_unit table was never created has no head: null', async () => {
    const rig = await boot();
    await (rig.driver as any).knex.schema.dropTable('sys_business_unit');

    expect(await graph(rig).headOf(UNIT)).toBeNull();
  });
});

describe('[#29713] standalone managerOf: a failed user read refuses', () => {
  it('control — a healthy read answers the manager, and a user with none answers null', async () => {
    const g = graph(await boot());

    expect(await g.managerOf(ALICE, ORG)).toBe(BOB);
    expect(await g.managerOf(BOB, ORG)).toBeNull();
  });

  it('⛔ a failed read refuses — it never answers an invented null', async () => {
    const rig = await boot();
    rig.failReads('sys_user');

    await expect(graph(rig).managerOf(ALICE, ORG)).rejects.toThrow(
      /\[sharing\] the manager of user 'usr_alice' could not be read: SQLITE_IOERR/,
    );
  });

  it('⛔ a failed read is not cached: the next read on the same pass answers the real manager', async () => {
    const rig = await boot();
    rig.failReads('sys_user', 1);
    const g = graph(rig);

    await expect(g.managerOf(ALICE, ORG)).rejects.toThrow(/could not be read/);
    expect(await g.managerOf(ALICE, ORG)).toBe(BOB);
  });

  it('absence — a composition that never registers sys_user has no manager on file: null', async () => {
    const g = graph(await boot({ omit: ['sys_user'] }));

    expect(await g.managerOf(ALICE, ORG)).toBeNull();
  });

  it('absence — a stack whose sys_user table was never created has no manager on file: null', async () => {
    const rig = await boot();
    await (rig.driver as any).knex.schema.dropTable('sys_user');

    expect(await graph(rig).managerOf(ALICE, ORG)).toBeNull();
  });
});

describe('[#29713] CONTROL — the wired limb answers what TeamGraphService.managerOf answers', () => {
  it('a wired managerOf answers exactly what TeamGraphService.managerOf answers, on a healthy and on a failed read', async () => {
    const rig = await boot();
    const g = graph(rig, { teamGraph: team(rig) });

    expect(await g.managerOf(ALICE, ORG)).toBe(BOB);
    expect(await g.managerOf(ALICE, ORG)).toBe(await new TeamGraphService({ engine: rig.engine as never }).managerOf(ALICE, ORG));

    // The wired limb passes TeamGraphService's answer through, its refusal
    // included: the two outcomes are equal, whatever that outcome is.
    rig.failReads('sys_user');
    const failed = graph(rig, { teamGraph: team(rig) });
    expect(await settled(failed.managerOf(ALICE, ORG))).toEqual(await settled(team(rig).managerOf(ALICE, ORG)));
  });
});

describe('[#29792] TeamGraphService.managerOf: a failed user read refuses, and nothing is cached for it', () => {
  it('control — a healthy read answers the manager, and a user with none answers null', async () => {
    const t = team(await boot());

    expect(await t.managerOf(ALICE, ORG)).toBe(BOB);
    expect(await t.managerOf(BOB, ORG)).toBeNull();
  });

  it('⛔ a failed read refuses — it never answers an invented null', async () => {
    const rig = await boot();
    rig.failReads('sys_user');

    const refusal = team(rig).managerOf(ALICE, ORG);
    await expect(refusal).rejects.toThrow(/\[sharing\] the manager of user 'usr_alice' could not be read: SQLITE_IOERR/);
    await expect(refusal).rejects.toMatchObject({ cause: { code: 'SQLITE_IOERR' } });
  });

  it('⛔ a failed read is not cached: the next read on the same pass answers the real manager', async () => {
    const rig = await boot();
    rig.failReads('sys_user', 1);
    const t = team(rig);

    await expect(t.managerOf(ALICE, ORG)).rejects.toThrow(/could not be read/);
    expect(await t.managerOf(ALICE, ORG)).toBe(BOB);
  });

  it('⛔ expandPrincipal\'s manager arm refuses with it, rather than answering nobody', async () => {
    const rig = await boot();
    const principal = { type: 'manager', value: 'owner_id', record: { owner_id: ALICE } };

    expect(await expandPrincipal(principal, { team: team(rig), organizationId: ORG })).toEqual([BOB]);
    rig.failReads('sys_user');
    await expect(expandPrincipal(principal, { team: team(rig), organizationId: ORG })).rejects.toThrow(
      /the manager of user 'usr_alice' could not be read/,
    );
  });

  it('absence — a composition that never registers sys_user has no manager on file: null', async () => {
    const t = team(await boot({ omit: ['sys_user'] }));

    expect(await t.managerOf(ALICE, ORG)).toBeNull();
  });

  it('absence — a stack whose sys_user table was never created has no manager on file: null', async () => {
    const rig = await boot();
    await (rig.driver as any).knex.schema.dropTable('sys_user');

    expect(await team(rig).managerOf(ALICE, ORG)).toBeNull();
  });

  it('control — the organization screen stays fail-open: an unreadable sys_member keeps the manager', async () => {
    const rig = await boot();
    rig.failReads('sys_member');

    expect(await team(rig).managerOf(ALICE, ORG)).toBe(BOB);
  });
});
