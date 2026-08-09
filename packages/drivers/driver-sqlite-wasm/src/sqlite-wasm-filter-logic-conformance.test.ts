// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for the wasm driver (#3774, #4405) —
 * the shared `@objectstack/spec/data` cases, run through this driver's own
 * pipeline.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the `$and` / `$or` / `$not`
 * compilation is inherited and nothing here re-implements it. What this pins is
 * the other half, the same half its temporal and pagination suites pin: the
 * compiled predicate has to survive a different **engine**. This driver swaps
 * knex's transport for a custom sql.js dialect (`Client_WasmSqlite`) that
 * compiles the statement, binds its parameters and marshals the rows back
 * through its own path. A dialect that mis-bound the parameters of a nested
 * `(… AND …) OR (… AND …)` would produce precisely the failure the shared
 * standard exists to rule out — a filter that looks applied and selects the
 * wrong rows — and it would fail in no other suite in the repo.
 *
 * "It inherits the compiler, therefore it is fine" is the assumption those two
 * suites exist to disprove; #4405 recorded this cell as DEBT rather than EXEMPT
 * for exactly that reason. This file clears it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

describe('driver-sqlite-wasm — filter logic conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: 'conformance',
        fields: {
          a: { type: 'string' },
          b: { type: 'string' },
          c: { type: 'string' },
          // [#5298] Nullable — the DDL this driver generates leaves a plain
          // string column nullable, which is what rows 3-4 need.
          d: { type: 'string' },
          owner: { type: 'string' },
          status: { type: 'string' },
          parent_object: { type: 'string' },
          parent_id: { type: 'string' },
        },
      },
    ]);
    for (const row of FILTER_LOGIC_ROWS) {
      await driver.create('conformance', { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      const rows = await driver.find(
        'conformance',
        { object: 'conformance', where: c.filter } as any,
        { bypassTenantAudit: true },
      );
      const got = (rows as any[])
        .map((r) => String(r.id))
        .sort((x, y) => x.localeCompare(y));
      expect(got, c.note).toEqual([...c.expected]);
    });
  }

  /**
   * The fixture as a whole, so a case that returns nothing because the seed
   * failed cannot read as a case that correctly excluded everything.
   */
  it('the fixture really is all four rows', async () => {
    const rows = await driver.find('conformance', {} as any, { bypassTenantAudit: true });
    expect((rows as any[]).map((r) => String(r.id)).sort()).toEqual(['1', '2', '3', '4']);
  });
});
