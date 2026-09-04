// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14435 — the published return types of `find()` / `findOne()` / `create()`
// are the contract's, not `any`.
//
// `IDataDriver` has always declared `Promise<Record<string, unknown>[]>`,
// `Promise<Record<string, unknown> | null>` and
// `Promise<Record<string, unknown>>` on these three doors. The driver's
// emitted `.d.ts` published `Promise<any[]>`, `Promise<any>` and
// `Promise<Record<string, any>>` instead, because the return types were
// INFERRED through the backing store's `any[]` rows (`private db:
// Record<string, any[]>` -> `getTable()` -> every row read is `any`), and on
// `create` because the annotation that existed spelled `Record<string, any>`.
// A consumer reading `findOne()`'s result was therefore never asked to narrow
// the `null` arm the contract declares, and every field read off any of the
// three was unchecked.
//
// The repair is route (a) of the card, the shape #14434 landed one door over
// on `update` / `upsert`: one explicit contract-typed return annotation per
// door. ⛔ NOT route (b), re-typing the store — measured to cascade (19 errors)
// and to make the write doors infer a too-narrow literal, "a second lie, not
// an honest type".
//
// This file pins BOTH halves at the type level, inside the package's tsc
// program (`tsconfig.json` selects `src/**/*`, tests included):
//
//   1. the CONTRACT: `IDataDriver`'s three doors resolve to the declared
//      types — read through `@objectstack/spec`'s built `.d.ts`, so a
//      regression in the declaration reds this file;
//   2. the DRIVER: `InMemoryDriver`'s three doors are not `any` and resolve to
//      exactly the contract's types — reverting the explicit annotations alone
//      reds this file too (the `any` mask returns and `IsAny` flips).
//
// `update` / `upsert` are deliberately NOT re-pinned here: they carry their own
// pin in `memory-update-declared-null.test.ts` (#13878).

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type ContractFind = Awaited<ReturnType<IDataDriver['find']>>;
type ContractFindOne = Awaited<ReturnType<IDataDriver['findOne']>>;
type ContractCreate = Awaited<ReturnType<IDataDriver['create']>>;

type MemoryFind = Awaited<ReturnType<InMemoryDriver['find']>>;
type MemoryFindOne = Awaited<ReturnType<InMemoryDriver['findOne']>>;
type MemoryCreate = Awaited<ReturnType<InMemoryDriver['create']>>;

// 1. The contract declares row-shaped returns, and the not-found arm on findOne.
const contractFindIsRows: Equals<ContractFind, Record<string, unknown>[]> = true;
const contractFindOneDeclaresNull: Equals<ContractFindOne, Record<string, unknown> | null> = true;
const contractCreateIsRow: Equals<ContractCreate, Record<string, unknown>> = true;

// 2. The driver's doors are un-masked and read exactly as the contract does.
const memoryFindIsAny: IsAny<MemoryFind> = false;
const memoryFindIsContract: Equals<MemoryFind, Record<string, unknown>[]> = true;
const memoryFindOneIsAny: IsAny<MemoryFindOne> = false;
const memoryFindOneIsContract: Equals<MemoryFindOne, Record<string, unknown> | null> = true;
const memoryCreateIsAny: IsAny<MemoryCreate> = false;
const memoryCreateIsContract: Equals<MemoryCreate, Record<string, unknown>> = true;

// The element type is the half `Promise<any[]>` hid: an array whose ROWS are
// `any` is still an array, so an arity-only check would have passed throughout.
const memoryFindRowIsAny: IsAny<MemoryFind[number]> = false;

describe('InMemoryDriver.find()/findOne()/create() declared return types (#14435)', () => {
  it('pins the contract and the driver at the type level', () => {
    expect([
      contractFindIsRows,
      contractFindOneDeclaresNull,
      contractCreateIsRow,
      memoryFindIsAny,
      memoryFindIsContract,
      memoryFindOneIsAny,
      memoryFindOneIsContract,
      memoryCreateIsAny,
      memoryCreateIsContract,
      memoryFindRowIsAny,
    ]).toEqual([true, true, true, false, true, false, true, false, true, false]);
  });

  it('findOne() on a query that matches nothing resolves to null, and the declared type makes the caller narrow', async () => {
    const driver = new InMemoryDriver();
    await driver.connect();
    await driver.create('t', { id: '1', name: 'present' });

    const miss = await driver.findOne('t', { where: { id: 'absent' } });
    expect(miss).toBeNull();

    // The narrowing the declared type now demands of every caller: a field
    // read is only reachable behind the `null` check.
    const name = miss === null ? 'absent' : miss.name;
    expect(name).toBe('absent');

    const hit = await driver.findOne('t', { where: { id: '1' } });
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe('present');
  });

  it('find() returns rows the caller must narrow before reading, and create() answers a whole row', async () => {
    const driver = new InMemoryDriver();
    await driver.connect();
    const created = await driver.create('t', { id: '1', name: 'a', keep: 'kept' });

    // `create()` answers the WHOLE stored row, not just the literal the
    // implementation builds — the #4311 guarantee, now typed honestly.
    expect(created.name).toBe('a');
    expect(created.keep).toBe('kept');

    const rows = await driver.find('t', {});
    expect(rows).toHaveLength(1);
    // `Array.prototype.find` can miss, and the row type no longer hides it.
    const row = rows.find((r) => r.id === '1');
    expect(row).toBeDefined();
    expect(row!.name).toBe('a');
  });
});
