// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#6320, the wasm side — the narrowed `distinct` signature survives
 * the `dist/*.d.ts` boundary.
 *
 * `SqliteWasmDriver extends SqlDriver` and `distinct` is not overridden here,
 * so nothing in this package re-implements the narrowing. What this file pins
 * is that the narrowing actually ARRIVES: this package does not compile
 * driver-sql's `src`, it reads the `.d.ts` tsup emits, so a signature that is
 * correct in the source but not re-built is invisible from here. That is a
 * known gate blind spot — `turbo`'s `typecheck` task depends on `^build`, so CI
 * rebuilds driver-sql first, but a local run in a stale worktree does not, and
 * "driver-sql is green so the consumer is green" is exactly the assumption
 * #4405 exists to disprove.
 *
 * Verified by deletion during implementation: with an impossible member
 * temporarily added to the parameter type in driver-sql's SOURCE and the
 * package rebuilt, every third-argument call site in THIS package went red —
 * proof that the `.d.ts` being read is the freshly built one and not a stale
 * copy. See the PR for the counts.
 *
 * The `@ts-expect-error` pins are resolved by `tsc`
 * (`pnpm --filter @objectstack/driver-sqlite-wasm typecheck`), not by vitest;
 * this package excludes no test glob and carries no DEBT / TEST_DEBT entry in
 * `scripts/check-type-check-coverage.mjs`, so its measured baseline is zero
 * errors. Both pins sit on real calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { SqliteWasmDriver } from './index.js';

/** `true` for `any` and for nothing else. */
type IsAny<T> = 0 extends 1 & T ? true : false;

describe("SqliteWasmDriver inherits distinct's bare-FilterCondition parameter (#6320)", () => {
  let driver: SqliteWasmDriver;
  let knexInstance: Knex;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    // Inherited `protected knex`, reached by naming the one member rather than
    // erasing the driver with `as any` — see the note in driver-sql's twin.
    knexInstance = (driver as unknown as { knex: Knex }).knex;

    await knexInstance.schema.createTable('orders', (t: Knex.CreateTableBuilder) => {
      t.string('id').primary();
      t.string('product');
      t.string('status');
    });
    await knexInstance('orders').insert([
      { id: '1', product: 'Laptop', status: 'completed' },
      { id: '2', product: 'Mouse', status: 'completed' },
      { id: '3', product: 'Ghost', status: 'pending' },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('reads a narrowed filter slot off the inherited method', () => {
    type DistinctFilters = Parameters<SqliteWasmDriver['distinct']>[2];
    const narrowed: IsAny<DistinctFilters> extends true ? never : 'narrowed' = 'narrowed';
    expect(narrowed).toBe('narrowed');
  });

  it('still takes the bare filter both drivers already used', async () => {
    const products = await driver.distinct('orders', 'product', { status: 'completed' });
    expect(products.sort()).toEqual(['Laptop', 'Mouse']);
  });

  it('refuses the truthy scalar that silently returned the unfiltered set', async () => {
    await driver.distinct(
      'orders',
      'product',
      // @ts-expect-error - a bare scalar is not a FilterCondition (#6320)
      'completed',
    );
  });
});
