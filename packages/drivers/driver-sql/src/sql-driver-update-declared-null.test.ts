// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14438 — `SqlDriver.update()`'s declared return type is the contract's, not
// `any`, and it carries the not-found arm.
//
// `SqlDriver.update()` has always answered a missing id with `null`
// (`return this.formatOutput(object, updated) || null` on the un-rotated path;
// the rotation path's `return null` once every shard has been probed), while
// its signature was written out as an EXPLICIT `Promise<any>`.
// `IDataDriver.update()` declares `Promise<Record<string, unknown> | null>`
// (the arm landed with #13878 / PR #14434 under the maintainer's 2026-09-01
// ruling), and an explicit `any` satisfies that structurally — so `tsc` said
// nothing, the published `.d.ts` of `@objectstack/driver-sql` read
// `Promise<any>`, and no caller holding a `SqlDriver` (or a `SqliteWasmDriver`,
// which inherits the door) was ever asked to narrow. It is the mask
// `InMemoryDriver` carried, inferred there and written out here.
//
// This file pins BOTH halves at the type level, inside this package's tsc
// program (`tsconfig.json` selects `src/**/*`, tests included, and the package
// carries no DEBT / TEST_DEBT entry in `scripts/check-type-check-coverage.mjs`):
//
//   1. the CONTRACT: `IDataDriver.update()` resolves to
//      `Record<string, unknown> | null` — read through `@objectstack/spec`'s
//      built `.d.ts`, so reverting the declaration alone reds this file;
//   2. the DRIVER: `SqlDriver.update()` is not `any` and resolves to exactly
//      the contract's type — putting the annotation back to `Promise<any>` reds
//      this file too: `IsAny` flips to `true` and `Equals` to `false`.
//
// Reverse verification, direction predicted BEFORE it was run: with the source
// annotation at `Promise<any>`, `pnpm --filter @objectstack/driver-sql typecheck`
// fails with TS2322 on `sqlUpdateIsAny` and on `sqlUpdateIsContract` (two
// errors, both in this file), while `pnpm test` stays green — the type-level
// facts are carried by consts vitest only compares. That split is the point:
// this defect has no runtime face, which is why an assignability-only pin
// would have passed against the very `any` being removed. Measured as
// predicted: 2 × TS2322 (this file, the two driver consts) with the annotation
// at `Promise<any>`, 0 errors with it at the contract's type.
//
// The typed-const form is the one `memory-update-declared-null.test.ts`
// (driver-memory, #13878) and `sql-driver-distinct-filter-narrowing.test.ts`
// use; the runtime cases below make the consts observable so the file is a
// test and not a declaration. `SqliteWasmDriver` and `TursoDriver` carry their
// own copies of the driver half in their own tsc programs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { SqlDriver } from './index.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type ContractUpdate = Awaited<ReturnType<IDataDriver['update']>>;
type SqlUpdate = Awaited<ReturnType<SqlDriver['update']>>;

// 1. The contract declares the not-found arm.
const contractUpdateDeclaresNull: Equals<ContractUpdate, Record<string, unknown> | null> = true;

// 2. The driver's door is un-masked and reads exactly as the contract does.
const sqlUpdateIsAny: IsAny<SqlUpdate> = false;
const sqlUpdateIsContract: Equals<SqlUpdate, Record<string, unknown> | null> = true;

describe('SqlDriver.update() declared return type (#14438)', () => {
  let driver: SqlDriver;
  let knexInstance: Knex;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // `knex` is `protected` on SqlDriver; name the single member being reached
    // rather than erasing the driver with `as any` (#6204 spelling).
    knexInstance = (driver as unknown as { knex: Knex }).knex;
    await knexInstance.schema.createTable('t', (t: Knex.CreateTableBuilder) => {
      t.string('id').primary();
      t.string('name');
    });
    await knexInstance('t').insert({ id: '1', name: 'before' });
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  it('pins the contract and the driver at the type level', () => {
    expect([contractUpdateDeclaresNull, sqlUpdateIsAny, sqlUpdateIsContract]).toEqual([true, false, true]);
  });

  it('update() on a missing id resolves to null, and the declared type makes the caller narrow', async () => {
    const result = await driver.update('t', 'missing', { name: 'x' });
    expect(result).toBeNull();

    // The narrowing the declared type now demands of every caller: a field
    // read is only reachable behind the `null` check.
    const name = result === null ? 'absent' : result.name;
    expect(name).toBe('absent');
  });

  it('update() on an existing id resolves to the updated record, behind the same narrowing', async () => {
    const result = await driver.update('t', '1', { name: 'after' });
    expect(result).not.toBeNull();
    expect(result === null ? 'absent' : result.name).toBe('after');
  });
});
