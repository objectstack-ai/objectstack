// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14438 — `TursoDriver.update()`'s declared return type is the contract's, not
// `any`, and it carries the not-found arm.
//
// `TursoDriver` does not merely inherit `SqlDriver.update()` — it OVERRIDES it
// (a local branch that forwards to `super.update`, a remote branch that passes
// `RemoteTransport.update()`'s result through the generic `formatRemoteRow`),
// and the override was written out with its own explicit `Promise<any>`. Both
// branches already carried the honest type: `SqlDriver.update()` is narrowed
// by #14438 and `RemoteTransport.update()` declared
// `Promise<Record<string, unknown> | null>` with #14428. The override's
// annotation was the one place the family's honest type was re-erased, so
// this package's published `.d.ts` re-declared the door as `any` on its own —
// which is why "TursoDriver inherits the fix" would have been wrong, and why
// this pin lives in THIS package's tsc program rather than in driver-sql's.
//
// Pinned here, at the type level (`tsconfig.json` selects `src/**/*`, tests
// included; no DEBT / TEST_DEBT entry for this package):
//
//   1. the CONTRACT: `IDataDriver.update()` resolves to
//      `Record<string, unknown> | null`;
//   2. the DRIVER: `TursoDriver.update()` is not `any` and resolves to exactly
//      the contract's type — putting the override's annotation back to
//      `Promise<any>` reds this file: `IsAny` flips to `true`, `Equals` to
//      `false`.
//
// Reverse verification, direction predicted BEFORE it was run: with the
// override at `Promise<any>`, `pnpm --filter @objectstack/driver-turso typecheck`
// fails with TS2322 on `tursoUpdateIsAny` and on `tursoUpdateIsContract`; `pnpm
// test` stays green either way (type-level facts carried by consts). Measured
// as predicted: 2 × TS2322 on this file with the override at `Promise<any>`;
// with the override narrowed, this file is clean and the package's remaining
// errors are the consumer sites the narrowing was written to surface.
//
// The runtime case below drives the LOCAL face (`:memory:`); the remote face's
// `null` on a miss is pinned by the `RemoteTransport` suites (#14428).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type ContractUpdate = Awaited<ReturnType<IDataDriver['update']>>;
type TursoUpdate = Awaited<ReturnType<TursoDriver['update']>>;

// 1. The contract declares the not-found arm.
const contractUpdateDeclaresNull: Equals<ContractUpdate, Record<string, unknown> | null> = true;

// 2. The override is un-masked and reads exactly as the contract does.
const tursoUpdateIsAny: IsAny<TursoUpdate> = false;
const tursoUpdateIsContract: Equals<TursoUpdate, Record<string, unknown> | null> = true;

/**
 * The slice of the inherited (protected) Knex instance this fixture touches.
 * `knex` is not a dependency of this package, so its types are not imported;
 * naming the members reached keeps the harness of a file about "the door is
 * no longer `any`" free of `any` itself.
 */
type TableBuilder = { string(name: string): { primary(): unknown } };
type KnexSlice = {
  schema: { createTable(name: string, build: (t: TableBuilder) => void): Promise<unknown> };
} & ((table: string) => { insert(row: Record<string, unknown>): Promise<unknown> });

describe('TursoDriver.update() declared return type (#14438)', () => {
  let driver: TursoDriver;

  beforeEach(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    const k = (driver as unknown as { knex: KnexSlice }).knex;
    await k.schema.createTable('t', (t) => {
      t.string('id').primary();
      t.string('name');
    });
    await k('t').insert({ id: '1', name: 'before' });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('pins the contract and the override at the type level', () => {
    expect([contractUpdateDeclaresNull, tursoUpdateIsAny, tursoUpdateIsContract]).toEqual([true, false, true]);
  });

  it('update() on a missing id resolves to null on the local face, and the declared type makes the caller narrow', async () => {
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
