// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14438 — `SqliteWasmDriver.update()` reads as the contract declares it, not
// as `any`, and it carries the not-found arm.
//
// `SqliteWasmDriver extends SqlDriver` and does NOT override `update()`, so its
// published `.d.ts` re-declares no `update` member of its own: the door it
// exposes is `SqlDriver.update()`'s, read through `@objectstack/driver-sql`'s
// built `.d.ts`. That is exactly the case that is easy to get wrong in both
// directions — a reader assumes the sibling "must have its own copy", or
// assumes inheritance and never measures it. This pin makes the inheritance a
// measured fact inside THIS package's tsc program (`tsconfig.json` selects
// `src/**/*`, tests included; no DEBT / TEST_DEBT entry): the door is not
// `any` and resolves to exactly `Record<string, unknown> | null`.
//
// Two ways this file goes red, both by design:
//   - `@objectstack/driver-sql` puts its `update()` annotation back to
//     `Promise<any>` (the pre-#14438 state) — this package inherits the mask
//     again and `IsAny` flips;
//   - a future override in `sqlite-wasm-driver.ts` re-declares the door with a
//     widened type — `Equals` flips, naming the drift here rather than at a
//     consumer.
//
// Reverse verification, direction predicted BEFORE it was run: against the
// pre-change `@objectstack/driver-sql` `.d.ts`, `pnpm --filter
// @objectstack/driver-sqlite-wasm typecheck` fails with TS2322 on
// `wasmUpdateIsAny` and on `wasmUpdateIsContract`; `pnpm test` is green
// either way (type-level facts carried by consts). Measured as predicted:
// 2 × TS2322 against the pre-change `.d.ts`, 0 against the narrowed one — and
// the built `dist/index.d.ts` of this package declares no `update(` member
// (0 matches), confirming the door is inherited, not re-declared.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { SqliteWasmDriver } from './index.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type ContractUpdate = Awaited<ReturnType<IDataDriver['update']>>;
type WasmUpdate = Awaited<ReturnType<SqliteWasmDriver['update']>>;

// 1. The contract declares the not-found arm.
const contractUpdateDeclaresNull: Equals<ContractUpdate, Record<string, unknown> | null> = true;

// 2. The inherited door is un-masked and reads exactly as the contract does.
const wasmUpdateIsAny: IsAny<WasmUpdate> = false;
const wasmUpdateIsContract: Equals<WasmUpdate, Record<string, unknown> | null> = true;

describe('SqliteWasmDriver.update() declared return type (#14438)', () => {
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    // `knex` is `protected` on the base; name the single member being reached.
    const k = (driver as unknown as { knex: Knex }).knex;
    await k.schema.createTable('t', (t: Knex.CreateTableBuilder) => {
      t.string('id').primary();
      t.string('name');
    });
    await k('t').insert({ id: '1', name: 'before' });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('pins the contract and the inherited door at the type level', () => {
    expect([contractUpdateDeclaresNull, wasmUpdateIsAny, wasmUpdateIsContract]).toEqual([true, false, true]);
  });

  it('update() on a missing id resolves to null, and the declared type makes the caller narrow', async () => {
    const result = await driver.update('t', 'missing', { name: 'x' });
    expect(result).toBeNull();

    // The narrowing the declared type now demands of every caller.
    const name = result === null ? 'absent' : result.name;
    expect(name).toBe('absent');
  });

  it('update() on an existing id resolves to the updated record, behind the same narrowing', async () => {
    const result = await driver.update('t', '1', { name: 'after' });
    expect(result).not.toBeNull();
    expect(result === null ? 'absent' : result.name).toBe('after');
  });
});
