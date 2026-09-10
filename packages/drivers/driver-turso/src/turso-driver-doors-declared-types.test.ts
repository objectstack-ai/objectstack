// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15267 — the `IDataDriver` doors `TursoDriver` OVERRIDES publish their
// declared return type, not `any`.
//
// The same shape #14438 fixed on this class's `update()` override, and for the
// same reason it had to be fixed here rather than inherited: `TursoDriver`
// overrides `findOne`, `create`, `bulkCreate` and `execute` with its own
// explicit `Promise<any>` on each, so this package's published `.d.ts`
// re-declares four of the five doors as `any` on its own and picks up NOTHING
// from the `@objectstack/driver-sql` narrowing. A driver-sql-only fix would
// have left this package's consumers exactly as mis-declared as before while
// the census read clean.
//
// Both branches of every one of the four already carried the honest type
// before this change:
//
//   - the LOCAL branch forwards to `super.<door>` — narrowed in driver-sql by
//     this same card;
//   - the REMOTE branch passes `RemoteTransport.<door>()` through the generic
//     `formatRemoteRow` / `formatRemoteRows` (`<T>(object, row: T): T`), and
//     `RemoteTransport` already declares `findOne` as
//     `Record<string, unknown> | null`, `create` as `Record<string, unknown>`,
//     `bulkCreate` as `Record<string, unknown>[]` and `execute` as `unknown`.
//
// So each override's annotation was pure erasure with nothing behind it — the
// one place the family's honest type was re-masked.
//
// Pinned here, at the type level, inside THIS package's tsc program
// (`tsconfig.json` selects `src/**/*`, tests included; no DEBT / TEST_DEBT
// entry for this package):
//
//   1. the CONTRACT half — what `IDataDriver` declares for each door;
//   2. the DRIVER half — the override is not `any` and resolves to exactly the
//      contract's type. Putting any one annotation back to `Promise<any>` reds
//      this file twice for that door: `IsAny` flips to `true`, `Equals` to
//      `false`.
//
// Reverse verification, direction predicted BEFORE it was run: with the four
// overrides at `Promise<any>`, `pnpm --filter @objectstack/driver-turso
// typecheck` fails with TS2322 on the eight driver consts below (two per door)
// and on nothing else; `pnpm test` stays green either way — the type-level
// facts are carried by consts vitest only compares.
//
// `explain()` is deliberately absent from the driver half: `TursoDriver` does
// NOT override it, so this package has no second declaration of that door to
// pin — it reaches these consumers through `@objectstack/driver-sql`'s `.d.ts`,
// where `sql-driver-doors-declared-types.test.ts` pins it. `upsert()`,
// `aggregate()` and `beginTransaction()` are out of this card's scope by
// ruling and are not asserted here; their annotations did not move.
//
// The runtime cases below drive the LOCAL face (`:memory:`); the remote face's
// shapes are pinned by the `RemoteTransport` suites.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type Resolved<F> = F extends (...args: never[]) => PromiseLike<infer R> ? R : never;

type ContractFindOne = Resolved<IDataDriver['findOne']>;
type ContractCreate = Resolved<IDataDriver['create']>;
type ContractBulkCreate = Resolved<IDataDriver['bulkCreate']>;
type ContractExecute = Resolved<IDataDriver['execute']>;

type TursoFindOne = Resolved<TursoDriver['findOne']>;
type TursoCreate = Resolved<TursoDriver['create']>;
type TursoBulkCreate = Resolved<TursoDriver['bulkCreate']>;
type TursoExecute = Resolved<TursoDriver['execute']>;

// 1. The contract half — what `IDataDriver` already declared before this change.
const contractFindOne: Equals<ContractFindOne, Record<string, unknown> | null> = true;
const contractCreate: Equals<ContractCreate, Record<string, unknown>> = true;
const contractBulkCreate: Equals<ContractBulkCreate, Record<string, unknown>[]> = true;
const contractExecute: Equals<ContractExecute, unknown> = true;

// 2. The driver half — each override un-masked, reading exactly as the
//    contract reads. `execute` needs the `IsAny` leg most of all:
//    `Equals<any, unknown>` is already `false`, so without it a door that
//    regressed to `any` would be reported only as "not `unknown`".
const tursoFindOneIsAny: IsAny<TursoFindOne> = false;
const tursoFindOneIsContract: Equals<TursoFindOne, Record<string, unknown> | null> = true;
const tursoCreateIsAny: IsAny<TursoCreate> = false;
const tursoCreateIsContract: Equals<TursoCreate, Record<string, unknown>> = true;
const tursoBulkCreateIsAny: IsAny<TursoBulkCreate> = false;
const tursoBulkCreateIsContract: Equals<TursoBulkCreate, Record<string, unknown>[]> = true;
const tursoExecuteIsAny: IsAny<TursoExecute> = false;
const tursoExecuteIsContract: Equals<TursoExecute, unknown> = true;

/**
 * The slice of the inherited (protected) Knex instance this fixture touches.
 * `knex` is not a dependency of this package, so its types are not imported;
 * naming the members reached keeps a file about "the door is no longer `any`"
 * free of `any` itself.
 */
type TableBuilder = { string(name: string): { primary(): unknown } };
type KnexSlice = {
  schema: { createTable(name: string, build: (t: TableBuilder) => void): Promise<unknown> };
} & ((table: string) => { insert(row: Record<string, unknown>): Promise<unknown> });

describe('TursoDriver declared return types on the doors it overrides (#15267)', () => {
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

  it('pins the contract half of the four overridden doors', () => {
    expect([contractFindOne, contractCreate, contractBulkCreate, contractExecute]).toEqual([true, true, true, true]);
  });

  it('pins the driver half: no override is `any`, each is the contract type', () => {
    expect([tursoFindOneIsAny, tursoCreateIsAny, tursoBulkCreateIsAny, tursoExecuteIsAny]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect([
      tursoFindOneIsContract,
      tursoCreateIsContract,
      tursoBulkCreateIsContract,
      tursoExecuteIsContract,
    ]).toEqual([true, true, true, true]);
  });

  it('findOne() on a query that matches nothing resolves to null on the local face, and the declared type makes the caller narrow', async () => {
    const result = await driver.findOne('t', { where: { id: 'missing' } });
    expect(result).toBeNull();

    // The narrowing the declared type now demands of every caller.
    const name = result === null ? 'absent' : result.name;
    expect(name).toBe('absent');
  });

  it('findOne() on a match resolves to the row, behind the same narrowing', async () => {
    const result = await driver.findOne('t', { where: { id: '1' } });
    expect(result).not.toBeNull();
    expect(result === null ? 'absent' : result.name).toBe('before');
  });

  it('create() and bulkCreate() resolve to record shapes the declared types describe', async () => {
    const created = await driver.create('t', { id: '2', name: 'via create' });
    expect(created.id).toBe('2');

    const batch = await driver.bulkCreate('t', [
      { id: '3', name: 'a' },
      { id: '4', name: 'b' },
    ]);
    expect(batch).toHaveLength(2);
    expect(batch.map((row) => row.id)).toEqual(['3', '4']);
  });
});
