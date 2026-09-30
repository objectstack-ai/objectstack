// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20822 · ADR-0053 D-D1 items 5 and 7, as amended] With no field guard, the
 * RLS compile seam lowers a policy filter TYPE-BLIND.
 *
 * The guard is absent when the security plugin cannot resolve the object's
 * declared fields (`getObjectFieldNames` answered `null`: neither ObjectQL's
 * registry nor the metadata service held a field map; its own comment says
 * that can be a boot-time state). The seam then cannot read which columns are
 * `datetime`, and item 7 says what such a seam does: "A seam that cannot
 * applies the rewrite type-blind." It used to read "no column is `datetime`"
 * instead, which left a bare-day upper bound to each driver's own copy of the
 * rule. #20822 deletes those copies, and a `using` filter reaches the driver
 * after the engine's `where` seam has run (the security middleware ANDs it
 * into the query inside the middleware chain), so nothing else lowers it: the
 * reading here decides the rows.
 *
 * - §A the compile seam, both clauses: the bare-day bound becomes `$lt` the
 *   next day on every column, the last supported day keeps `{ $null: false }`,
 *   and an unresolved `'{today}'` is left as written.
 * - §B through `SecurityPlugin.getReadFilter` with a schema it cannot resolve,
 *   and the resulting `using` filter handed to `SqlDriver.find` exactly as the
 *   engine hands a composed `where` to its driver: the whole named day is kept.
 *
 * The in-memory driver answers the same lowered filter with the whole day too;
 * that half is pinned in `driver-memory` (`memory-driver-20822-comparison-as-written.test.ts`
 * §C, a type-blind lowered filter), because a new test consumer of
 * `@objectstack/driver-memory` here is outside the driver-memory census ledger.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { SqlDriver } from '@objectstack/driver-sql';
import { RLSCompiler } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';

const CTX = { userId: 'u1', tenantId: 'org-1', positions: [] } as any;

const policy = (clause: 'using' | 'check', predicate: string): RowLevelSecurityPolicy =>
  ({ name: 'p', object: 'contract', operation: 'all', [clause]: predicate }) as unknown as RowLevelSecurityPolicy;

/** A compile with NO field guard — the fourth argument omitted, as `getReadFilter` passes it. */
const compileWithoutGuard = (clause: 'using' | 'check', predicate: string) =>
  new RLSCompiler().compileFilter([policy(clause, predicate)], CTX, clause);

describe('[#20822] §A the RLS compile seam with no guard lowers type-blind (item 7)', () => {
  for (const clause of ['using', 'check'] as const) {
    it(`${clause}: a bare-day upper bound becomes $lt the next day`, () => {
      expect(compileWithoutGuard(clause, "record.signed_on <= '2026-01-05'"))
        .toEqual({ signed_on: { $lt: '2026-01-06' } });
    });

    it(`${clause}: the last supported day keeps only { $null: false }`, () => {
      expect(compileWithoutGuard(clause, "record.signed_on <= '9999-12-31'"))
        .toEqual({ signed_on: { $null: false } });
    });

    it(`${clause}: an unresolved '{today}' is not a bare day, so it is left as written`, () => {
      expect(compileWithoutGuard(clause, "record.signed_on <= '{today}'"))
        .toEqual({ signed_on: { $lte: '{today}' } });
    });

    it(`${clause}: an instant bound is never widened`, () => {
      expect(compileWithoutGuard(clause, "record.signed_on <= '2026-01-05T12:00:00.000Z'"))
        .toEqual({ signed_on: { $lte: '2026-01-05T12:00:00.000Z' } });
    });
  }
});

const MEMBER_WITH_POLICY: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    { name: 'signed_through_jan_5', object: 'contract', operation: 'all', using: "record.signed_on <= '2026-01-05'" },
  ],
} as unknown as PermissionSet;

/** A plugin whose schema lookups answer nothing — so it compiles `using` with no guard. */
async function bootWithoutSchema() {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: vi.fn(), getSchema: () => undefined, findOne: vi.fn(async () => null) },
    metadata: { get: async () => undefined, list: async () => [MEMBER_WITH_POLICY] },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
  };
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  return plugin;
}

describe('[#20822] §B an RLS using policy on an object whose guard is absent keeps the whole named day', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    // The DRIVER knows `signed_on` is a datetime; the security plugin could not
    // resolve the object's declaration, which is the absent-guard state.
    // `organization_id` is the column the plugin's tenant wall (Layer 0) ANDs
    // beside the policy: `{ $and: [{ organization_id: 'org-1' }, USING] }`.
    await driver.initObjects([
      { name: 'contract', fields: { signed_on: { type: 'datetime' }, organization_id: { type: 'text' } } },
    ] as never);
    for (const [id, at] of [
      ['c_prev', '2026-01-04T10:00:00.000Z'],
      ['c_midnight', '2026-01-05T00:00:00.000Z'],
      ['c_evening', '2026-01-05T21:40:00.000Z'],
      ['c_next', '2026-01-06T00:00:00.000Z'],
    ] as const) {
      await driver.create('contract', { id, signed_on: at, organization_id: 'org-1' }, { bypassTenantAudit: true } as never);
    }
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('getReadFilter compiles the policy with no guard and lowers its bound type-blind', async () => {
    const plugin = await bootWithoutSchema();
    const filter = await (plugin as any).getReadFilter('contract', CTX);
    expect(JSON.stringify(filter)).toContain(JSON.stringify({ signed_on: { $lt: '2026-01-06' } }));
    expect(JSON.stringify(filter)).not.toContain('$lte');
  });

  it('SqlDriver, handed that using filter as its where, answers every row of the named day', async () => {
    const plugin = await bootWithoutSchema();
    const filter = await (plugin as any).getReadFilter('contract', CTX);
    const rows = (await driver.find('contract', { where: filter } as never)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(['c_evening', 'c_midnight', 'c_prev']);
  });
});
