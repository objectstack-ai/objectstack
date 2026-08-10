// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#6320 — `SqlDriver.distinct`'s third argument is a bare
 * `FilterCondition`, never `any`.
 *
 * `distinct` is not declared on `IDataDriver`, so #5181's narrowing and
 * #6075's follow-through never reached it; it kept `filters?: any` while its
 * body said something much more specific — `applyFilters(builder, filters)`
 * takes the argument ITSELF, so what it wants is the value `find()` carries
 * under `query.where`, not a query envelope. This file holds the type to that
 * sentence, and — just as important — records the two places the type provably
 * CANNOT help, so the next reader does not assume a guard that is not there.
 *
 * **Why the compile-time pins here are real.** They are resolved by `tsc`, not
 * by vitest: reverting the signature to `any` makes each `@ts-expect-error`
 * directive unused, and an unused directive is itself an error, so
 * `pnpm --filter @objectstack/driver-sql typecheck` goes red. That works here
 * only because this package's `tsconfig.json` does NOT exclude the test glob
 * and the package carries no DEBT / TEST_DEBT entry in
 * `scripts/check-type-check-coverage.mjs` — it reports zero errors, which is
 * the baseline these pins move away from. Every pin sits on a REAL CALL to
 * `distinct`, never on a `const x: FilterCondition = …` literal: an
 * alias-scoped pin stays green through a revert of the signature, which is the
 * dead-pin shape #5018/#4984 paid for.
 *
 * **Measured before writing any of this** (three rows: `Laptop`/`Mouse` are
 * `completed`, `Ghost` is `pending`), on `distinct('orders', 'product', …)`:
 *
 * ```
 * bare filter { status: 'completed' }        => RESOLVED ["Laptop","Mouse"]
 * no filter                                  => RESOLVED ["Laptop","Mouse","Ghost"]
 * envelope { object, where }                 => THREW  INVALID_FILTER / 400
 * envelope { where } only                    => THREW  INVALID_FILTER / 400
 * array ['status','=','completed']           => THREW  INVALID_FILTER / 400  (#5158)
 * scalar 'completed'                         => RESOLVED ["Laptop","Mouse","Ghost"]   ← silent widening
 * ```
 *
 * The last line is what the narrowing removes: a truthy non-object `where`
 * emits no predicate at all (see the closing comment of `applyFilters`), so a
 * call meaning "distinct products among completed orders" type-checked and
 * answered with EVERY product. That is #6320's "the direction is widening", on
 * this driver, and it is now a compile error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';

/** `true` for `any` and for nothing else — `0 extends 1 & T` holds only there. */
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('SqlDriver.distinct takes a bare FilterCondition (#6320)', () => {
  let driver: SqlDriver;
  let knexInstance: Knex;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // `knex` is `protected` on SqlDriver, so a fixture outside the class cannot
    // read it without a cast. Sibling suites in this package spell that
    // `(driver as any).knex`, which erases EVERY member of the driver to reach
    // one; this names the single member being reached instead (#6204 spelling).
    // A file whose whole subject is "this parameter stopped being `any`" should
    // not introduce `any` in its own harness.
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
    await knexInstance.destroy();
  });

  describe('the signature', () => {
    it('no longer erases the filter to `any`', () => {
      // Read off the METHOD, not off the `FilterCondition` alias. A revert that
      // puts `any` back on the signature while leaving the alias imported would
      // sail past any alias-scoped assertion; here the slot resolves to `never`
      // and this line goes red.
      type DistinctFilters = Parameters<SqlDriver['distinct']>[2];
      const narrowed: IsAny<DistinctFilters> extends true ? never : 'narrowed' = 'narrowed';
      expect(narrowed).toBe('narrowed');
    });
  });

  describe('what still compiles, unchanged', () => {
    it('takes the bare filter its body has always read', async () => {
      // No cast, no envelope. This is the spelling `applyFilters` consumes and
      // the one both driver-sql and driver-sqlite-wasm already used.
      const products = await driver.distinct('orders', 'product', { status: 'completed' });
      expect(products.sort()).toEqual(['Laptop', 'Mouse']);
    });

    it('still means "no constraint" when the filter is omitted', async () => {
      const products = await driver.distinct('orders', 'product');
      expect(products.sort()).toEqual(['Ghost', 'Laptop', 'Mouse']);
    });
  });

  describe('what the narrowing now rejects', () => {
    it('refuses a truthy scalar — the spelling that silently returned everything', async () => {
      await driver.distinct(
        'orders',
        'product',
        // @ts-expect-error - a bare scalar is not a FilterCondition (#6320)
        'completed',
      );
    });

    it('refuses a number in the same slot', async () => {
      await driver.distinct(
        'orders',
        'product',
        // @ts-expect-error - a bare scalar is not a FilterCondition (#6320)
        42,
      );
    });

    it('measures WHY: forced through a cast, that shape still answers unfiltered', async () => {
      // `as unknown as FilterCondition` — the #6204 spelling for deliberately
      // off-contract input: it names the contract being bypassed instead of
      // erasing the whole call with `as any`.
      //
      // `applyFilters` emits NO predicate for a truthy non-object, non-array
      // filter and says so in its closing comment; widening that refusal is a
      // separate change with its own blast radius (#5158 scoped it out), so
      // what #6320 buys on this driver is the compile-time door above. This
      // assertion is the reason that door is worth having — delete the door and
      // this answer is what a plain call gets.
      const products = await driver.distinct(
        'orders',
        'product',
        'completed' as unknown as FilterCondition,
      );
      expect(products.sort()).toEqual(['Ghost', 'Laptop', 'Mouse']);
    });
  });

  describe('what NO type here can reject — pinned at runtime instead', () => {
    it('admits a query envelope at compile time, then refuses it loudly at runtime', async () => {
      // ⚠️ Deliberately NOT a `@ts-expect-error`. `FilterCondition` is an open
      // map (`[key: string]: any`) because a filter key IS a field name, so
      // `{ object, where }` is a structurally valid filter — one constraining
      // columns literally named `object` and `where`. No annotation can
      // separate that from a legitimate filter, so #6320's "pin the reverse
      // mismatch as a compile error" is not achievable on this parameter, by
      // any type. Writing `@ts-expect-error` here would go red TODAY.
      //
      // The guarantee that IS available is that this driver never answers such
      // a call silently, which is the half of #6320's asymmetry driver-sql
      // owns: the envelope's `where` value is an object, and no comparand may
      // be one.
      //
      // Written INLINE at the call site on purpose. A `const envelope:
      // FilterCondition = …` would prove only that the alias admits the shape;
      // the claim being pinned is that it reaches THIS PARAMETER uncast, which
      // only an argument position can show.
      await expect(
        driver.distinct('orders', 'product', { object: 'orders', where: { status: 'completed' } }),
      ).rejects.toMatchObject({
        code: 'INVALID_FILTER',
        status: 400,
      });
    });

    it('admits an array at compile time, then refuses it as a FilterArray (#5158)', async () => {
      // Same reason, and MEASURED rather than assumed: an array satisfies the
      // string index signature, so the FilterArray authoring form reaches
      // `distinct` type-checked. No cast here, deliberately — a cast would make
      // this case survive a `FilterCondition` that had stopped admitting arrays
      // while the sentence above quietly became false. It is refused by the
      // shared `applyFilters` door, which `distinct` inherits rather than
      // carrying its own copy of.
      await expect(
        driver.distinct('orders', 'product', ['status', '=', 'completed']),
      ).rejects.toMatchObject({
        code: 'INVALID_FILTER',
        status: 400,
      });
    });
  });
});
