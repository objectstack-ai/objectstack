// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13878 — the declared return type of `update()` carries its not-found arm,
// and the driver's published type is the contract's, not `any`.
//
// `InMemoryDriver.update()` has always answered a missing id with `null` when
// `strictMode` is off (the behaviour pin in `memory-driver.test.ts` holds it),
// while `IDataDriver.update()` declared `Promise<Record<string, unknown>>` —
// a contract violated by 4 of 6 shipped drivers and never seen by `tsc`,
// because the driver's return type was INFERRED through the backing store's
// `any[]` rows: the union collapsed to `any`, the published `.d.ts` read
// `Promise<any>`, and no caller was ever asked to narrow. The maintainer's
// ruling (2026-09-01) declares the arm — `Promise<Record<string, unknown> |
// null>`, the shape `findOne` already carries — and un-masks the driver.
//
// This file pins BOTH halves at the type level, inside the package's tsc
// program (`tsconfig.json` selects `src/**/*`, tests included):
//
//   1. the CONTRACT: `IDataDriver.update()` resolves to
//      `Record<string, unknown> | null` — read through `@objectstack/spec`'s
//      built `.d.ts`, so reverting the declaration alone reds this file;
//   2. the DRIVER: `InMemoryDriver.update()` / `upsert()` are not `any` and
//      resolve to exactly the contract's types — reverting the driver's
//      explicit annotations alone reds this file too (the `any` mask
//      returns and `IsAny` flips).
//
// The `satisfies`-free typed-const form is the one the sibling drivers use
// (`turso-driver-options-door.test.ts`, `sql-driver-distinct-filter-
// narrowing.test.ts`); the runtime cases below make the consts observable so
// the file is a test and not a declaration.

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type ContractUpdate = Awaited<ReturnType<IDataDriver['update']>>;
type MemoryUpdate = Awaited<ReturnType<InMemoryDriver['update']>>;
type MemoryUpsert = Awaited<ReturnType<InMemoryDriver['upsert']>>;

// 1. The contract declares the not-found arm.
const contractUpdateDeclaresNull: Equals<ContractUpdate, Record<string, unknown> | null> = true;

// 2. The driver's doors are un-masked and read exactly as the contract does.
const memoryUpdateIsAny: IsAny<MemoryUpdate> = false;
const memoryUpdateIsContract: Equals<MemoryUpdate, Record<string, unknown> | null> = true;
const memoryUpsertIsAny: IsAny<MemoryUpsert> = false;
const memoryUpsertIsContract: Equals<MemoryUpsert, Record<string, unknown>> = true;

describe('InMemoryDriver.update()/upsert() declared return types (#13878)', () => {
  it('pins the contract and the driver at the type level', () => {
    expect([
      contractUpdateDeclaresNull,
      memoryUpdateIsAny,
      memoryUpdateIsContract,
      memoryUpsertIsAny,
      memoryUpsertIsContract,
    ]).toEqual([true, false, true, false, true]);
  });

  it('update() on a missing id resolves to null, and the declared type makes the caller narrow', async () => {
    const driver = new InMemoryDriver();
    await driver.connect();

    const result = await driver.update('t', 'missing', { name: 'x' });
    expect(result).toBeNull();

    // The narrowing the declared type now demands of every caller: a field
    // read is only reachable behind the `null` check.
    const name = result === null ? 'absent' : result.name;
    expect(name).toBe('absent');
  });

  it('upsert() over an existing id returns the merged record and never the not-found arm', async () => {
    const driver = new InMemoryDriver();
    await driver.connect();
    await driver.create('t', { id: '1', name: 'before', keep: 'kept' });

    const merged = await driver.upsert('t', { id: '1', name: 'after' });
    expect(merged.id).toBe('1');
    expect(merged.name).toBe('after');
    expect(merged.keep).toBe('kept');
  });
});
