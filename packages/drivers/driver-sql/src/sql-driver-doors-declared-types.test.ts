// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15267 — the five remaining `IDataDriver` doors on `SqlDriver` publish their
// declared return type, not `any`.
//
// #14438 (PR #15280) un-masked `update()` on this class and filed the census of
// what was left: `findOne`, `create`, `bulkCreate`, `execute` and `explain`
// each carried an EXPLICIT `Promise<any>` while
// `packages/spec/src/contracts/data-driver.ts` had already declared every one
// of them narrower — `findOne` and `create` and `bulkCreate` as their record
// shapes, `execute` and `explain` as `unknown`. An explicit `any` satisfies all
// five structurally, so `tsc` said nothing, the published `.d.ts` of
// `@objectstack/driver-sql` read `Promise<any>`, and no caller holding a
// `SqlDriver` (or a `SqliteWasmDriver`, which overrides none of them and
// inherits every one) was ever asked to narrow. The family was honest on the
// interface and masked on the class: a reader who had learned "the driver doors
// are narrowed now" was wrong on five of six.
//
// This file pins BOTH halves of each door at the type level, inside this
// package's own tsc program (`tsconfig.json` selects `src/**/*`, tests
// included, and the package carries no DEBT / TEST_DEBT entry in
// `scripts/check-type-check-coverage.mjs`):
//
//   1. the CONTRACT half — what `IDataDriver` declares, read through
//      `@objectstack/spec`'s BUILT `.d.ts`, so a revert of the contract alone
//      reds this file;
//   2. the DRIVER half — the class's door is not `any` and resolves to exactly
//      the contract's type. Putting any one annotation back to `Promise<any>`
//      reds this file twice for that door: `IsAny` flips to `true` and `Equals`
//      to `false`.
//
// Reverse verification, direction predicted BEFORE it was run: with the five
// source annotations back at `Promise<any>` and this file present,
// `pnpm --filter @objectstack/driver-sql typecheck` fails with TS2322 on the
// ten driver consts below (two per door) and on nothing else, while `pnpm test`
// stays green — the type-level facts are carried by consts vitest only
// compares. That split is the point: this defect has no runtime face for the
// four pure-annotation doors, which is why an assignability-only pin would pass
// against the very `any` being removed. `findOne`'s `null` arm is the one door
// that also has a runtime face, and it is exercised below.
//
// The typed-const form is `sql-driver-update-declared-null.test.ts`'s (#14438),
// which is `memory-update-declared-null.test.ts`'s (#13878). `TursoDriver`
// overrides four of these five doors and carries its own copy of the driver
// half in its own tsc program (`turso-driver-doors-declared-types.test.ts`);
// `SqliteWasmDriver` overrides none and reaches its consumers through this
// package's `.d.ts`.
//
// #17277 adds the SIXTH door, `aggregate()`, to this file. It belongs to the
// same family and was left out of #15267 for a reason that has to be recorded
// here, because the reason is a trap and not an oversight: #15267's census
// asked "is `aggregate` on the contract?" and answered from `SqlDriver`'s OWN
// CODE COMMENT, which asserted it was not. The comment was false —
// `IDataDriver` declares
// `aggregate?(object, query, options?): Promise<Record<string, unknown>[]>` —
// so a reading was carried as a measurement through a census, a card and a
// dispatch order before anyone compared it against the contract. The comment
// is corrected at the source site in the same change; this paragraph is the
// second copy, where the next person extending this family will read it.
//
// `aggregate()` is OPTIONAL on the contract (`aggregate?`), unlike the five
// above. That changes only how the contract half is spelled — the function
// type is read through `NonNullable`, exactly as `explain` already is — and
// not whether the door owes its declared type: optionality governs whether the
// member EXISTS, not what it returns once it does.
//
// #17690 adds four MORE doors of the same family — `find`, `upsert`,
// `bulkUpdate` and `temporalFilterValue` — and the reason they were not in
// #15267's repaired set nor in its deliberately-excluded set is worth one
// paragraph, because it is the transferable half of this card. #15267's census
// matched the LITERAL STRING `Promise<any>`. Every door it repaired is spelled
// exactly that way; every door it never named nests the `any` inside a wider
// type — `Promise<any[]>` (`find`), `Promise<Record<string, any>>`
// (`upsert`), `Promise<Record<string, any>[]>` (`bulkUpdate`), a bare `any`
// (`temporalFilterValue`). The characters were not there, so the instrument
// stayed silent, and the silence was read as coverage. An instrument's silence
// is only evidence if the instrument could have spoken: the census that found
// these parses `IDataDriver` out of `data-driver.ts` and compares each class's
// published annotation against the declaration, so the honest doors show up as
// EXACT rows and are shown to have been COVERED rather than skipped.
//
// `temporalFilterValue` is the one door in the family that is not a promise at
// all: it is a synchronous `unknown` on the contract, so its halves are read
// through `ReturnType` rather than `Resolved`. It is optional
// (`temporalFilterValue?`), read through `NonNullable` for the same reason
// `explain` and `aggregate` are.
//
// Out of scope, deliberately: `analyzeQuery()` (the helper behind `explain()`)
// is not pinned here — it is not on `IDataDriver` at all. And the PARAMETER
// annotations of these doors (`data: Record<string, any>` on `upsert`,
// `value: any` on `temporalFilterValue`) are deliberately NOT part of this
// family: a parameter typed `any` accepts exactly what one typed `unknown`
// accepts, so it erodes nothing on the CALLER's side — which is the whole
// axis this family is about.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { SqlDriver } from './index.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type Resolved<F> = F extends (...args: never[]) => PromiseLike<infer R> ? R : never;

/**
 * [#17690] `IsAny<T>` answers about T ITSELF, which is honestly `false` for
 * `any[]` and for `Record<string, any>` — and those are exactly the two shapes
 * every door on this card had regressed to. Used as the "is not `any`" half of
 * a nested-`any` door it is a PHANTOM CHECK: it evaluates, it is green, and it
 * is green against the very mask it is supposed to name. Measured: with
 * `find()` put back to `Promise<any[]>`, `IsAny<Resolved<SqlDriver['find']>>`
 * stayed `false` and only the `Equals` leg red — one half, not the two this
 * family requires.
 *
 * That is the card's own lesson turning up inside its own instrument: an
 * instrument's silence is only evidence if the instrument could have spoken.
 * `ContainsAny` looks one and two levels in — the ROW of an array-shaped door
 * and the CELL of a record row — so `any[]`, `Record<string, any>` and
 * `Record<string, any>[]` all answer `true` while the contract's own
 * `Record<string, unknown>[]` / `Record<string, unknown>` / `unknown` answer
 * `false`. The branch order matters: `IsAny<T>` is asked FIRST so a bare `any`
 * never reaches a distributive conditional, where it would split across both
 * arms and answer `boolean`.
 */
type ContainsAny<T> = IsAny<T> extends true
  ? true
  : T extends readonly (infer Row)[]
    ? ContainsAny<Row>
    : T extends Record<string, infer Cell>
      ? IsAny<Cell>
      : false;


// `explain` is optional on the contract (`explain?(...)`), so its function type
// is read through `NonNullable` — the door is the member, not its presence.
type ContractFindOne = Resolved<IDataDriver['findOne']>;
type ContractCreate = Resolved<IDataDriver['create']>;
type ContractBulkCreate = Resolved<IDataDriver['bulkCreate']>;
type ContractExecute = Resolved<IDataDriver['execute']>;
type ContractExplain = Resolved<NonNullable<IDataDriver['explain']>>;
// `aggregate` is optional too (`aggregate?(...)`), read the same way (#17277).
type ContractAggregate = Resolved<NonNullable<IDataDriver['aggregate']>>;
// [#17690] Four more doors. `temporalFilterValue` is synchronous, so it is read
// through `ReturnType` — `Resolved` would answer `never` and pin nothing.
type ContractFind = Resolved<IDataDriver['find']>;
type ContractUpsert = Resolved<IDataDriver['upsert']>;
type ContractBulkUpdate = Resolved<IDataDriver['bulkUpdate']>;
type ContractTemporalFilterValue = ReturnType<NonNullable<IDataDriver['temporalFilterValue']>>;

type SqlFindOne = Resolved<SqlDriver['findOne']>;
type SqlCreate = Resolved<SqlDriver['create']>;
type SqlBulkCreate = Resolved<SqlDriver['bulkCreate']>;
type SqlExecute = Resolved<SqlDriver['execute']>;
type SqlExplain = Resolved<SqlDriver['explain']>;
type SqlAggregate = Resolved<SqlDriver['aggregate']>;
type SqlFind = Resolved<SqlDriver['find']>;
type SqlUpsert = Resolved<SqlDriver['upsert']>;
type SqlBulkUpdate = Resolved<SqlDriver['bulkUpdate']>;
type SqlTemporalFilterValue = ReturnType<SqlDriver['temporalFilterValue']>;

// 1. The contract half — what `IDataDriver` already declared before this change.
const contractFindOne: Equals<ContractFindOne, Record<string, unknown> | null> = true;
const contractCreate: Equals<ContractCreate, Record<string, unknown>> = true;
const contractBulkCreate: Equals<ContractBulkCreate, Record<string, unknown>[]> = true;
const contractExecute: Equals<ContractExecute, unknown> = true;
const contractExplain: Equals<ContractExplain, unknown> = true;
const contractAggregate: Equals<ContractAggregate, Record<string, unknown>[]> = true;
const contractFind: Equals<ContractFind, Record<string, unknown>[]> = true;
const contractUpsert: Equals<ContractUpsert, Record<string, unknown>> = true;
const contractBulkUpdate: Equals<ContractBulkUpdate, Record<string, unknown>[]> = true;
const contractTemporalFilterValue: Equals<ContractTemporalFilterValue, unknown> = true;

// 2. The driver half — un-masked, and reading exactly as the contract reads.
//    `unknown` needs the `IsAny` leg most of all: `Equals<any, unknown>` is
//    already `false`, but a door that regressed to `any` must be named as `any`
//    rather than merely "not `unknown`".
const sqlFindOneIsAny: IsAny<SqlFindOne> = false;
const sqlFindOneIsContract: Equals<SqlFindOne, Record<string, unknown> | null> = true;
const sqlCreateIsAny: IsAny<SqlCreate> = false;
const sqlCreateIsContract: Equals<SqlCreate, Record<string, unknown>> = true;
const sqlBulkCreateIsAny: IsAny<SqlBulkCreate> = false;
const sqlBulkCreateIsContract: Equals<SqlBulkCreate, Record<string, unknown>[]> = true;
const sqlExecuteIsAny: IsAny<SqlExecute> = false;
const sqlExecuteIsContract: Equals<SqlExecute, unknown> = true;
const sqlExplainIsAny: IsAny<SqlExplain> = false;
const sqlExplainIsContract: Equals<SqlExplain, unknown> = true;
const sqlAggregateIsAny: IsAny<SqlAggregate> = false;
const sqlAggregateIsContract: Equals<SqlAggregate, Record<string, unknown>[]> = true;
const sqlFindHasAny: ContainsAny<SqlFind> = false;
const sqlFindIsContract: Equals<SqlFind, Record<string, unknown>[]> = true;
const sqlUpsertHasAny: ContainsAny<SqlUpsert> = false;
const sqlUpsertIsContract: Equals<SqlUpsert, Record<string, unknown>> = true;
const sqlBulkUpdateHasAny: ContainsAny<SqlBulkUpdate> = false;
const sqlBulkUpdateIsContract: Equals<SqlBulkUpdate, Record<string, unknown>[]> = true;
// `temporalFilterValue` lands on `unknown`, so the `IsAny` leg carries most of
// the weight here: `Equals<any, unknown>` is already `false`, and without it a
// regression to `any` would be reported only as "not `unknown`".
const sqlTemporalFilterValueHasAny: ContainsAny<SqlTemporalFilterValue> = false;
const sqlTemporalFilterValueIsContract: Equals<SqlTemporalFilterValue, unknown> = true;

describe('SqlDriver declared return types on the five remaining IDataDriver doors (#15267)', () => {
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

  it('pins the contract half of all five doors', () => {
    expect([contractFindOne, contractCreate, contractBulkCreate, contractExecute, contractExplain]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('pins the driver half of all five doors: none is `any`, each is the contract type', () => {
    expect([sqlFindOneIsAny, sqlCreateIsAny, sqlBulkCreateIsAny, sqlExecuteIsAny, sqlExplainIsAny]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([
      sqlFindOneIsContract,
      sqlCreateIsContract,
      sqlBulkCreateIsContract,
      sqlExecuteIsContract,
      sqlExplainIsContract,
    ]).toEqual([true, true, true, true, true]);
  });

  it('findOne() on a query that matches nothing resolves to null, and the declared type makes the caller narrow', async () => {
    const result = await driver.findOne('t', { where: { id: 'missing' } }, { bypassTenantAudit: true });
    expect(result).toBeNull();

    // The narrowing the declared type now demands of every caller: a field read
    // is only reachable behind the `null` check.
    const name = result === null ? 'absent' : result.name;
    expect(name).toBe('absent');
  });

  it('findOne() on a match resolves to the row, behind the same narrowing', async () => {
    const result = await driver.findOne('t', { where: { id: '1' } }, { bypassTenantAudit: true });
    expect(result).not.toBeNull();
    expect(result === null ? 'absent' : result.name).toBe('before');
  });

  it('findOne() answers null for a non-object query — the other arm of the same declared null', async () => {
    const result = await driver.findOne('t', undefined as unknown as Parameters<SqlDriver['findOne']>[1], {
      bypassTenantAudit: true,
    });
    expect(result).toBeNull();
  });

  // [#17277] The sixth door of the same family. Both halves, same two legs:
  // put the annotation back to `Promise<any>` and `sqlAggregateIsAny` flips to
  // `true` while `sqlAggregateIsContract` flips to `false`, reding this file
  // twice at `tsc` time.
  it('pins both halves of the sixth door, aggregate(): declared on the contract, published by the class', () => {
    expect(contractAggregate).toBe(true);
    expect(sqlAggregateIsAny).toBe(false);
    expect(sqlAggregateIsContract).toBe(true);
  });

  it('aggregate() resolves to rows the declared record type describes, and the caller narrows to read one', async () => {
    const rows = await driver.aggregate(
      't',
      { aggregations: [{ function: 'count', alias: 'n' }] },
      { bypassTenantAudit: true },
    );
    expect(rows).toHaveLength(1);

    // The narrowing the declared type now demands of every caller: an
    // aggregate cell arrives as `unknown`, so the count is typed before it is
    // compared. Through the old `Promise<any>` this read compiled unchecked.
    const cell: unknown = rows[0].n;
    expect(Number(cell)).toBe(1);
  });

  // [#17690] The four doors a literal-string census could not see. Both halves
  // each: put any one annotation back and `ContainsAny` flips to `true` while
  // `Equals` flips to `false`, reding this file twice for that door — verified
  // by ablating all four, two errors apiece and nothing else.
  it('pins both halves of find(), upsert(), bulkUpdate() and temporalFilterValue()', () => {
    expect([contractFind, contractUpsert, contractBulkUpdate, contractTemporalFilterValue]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([sqlFindHasAny, sqlUpsertHasAny, sqlBulkUpdateHasAny, sqlTemporalFilterValueHasAny]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect([
      sqlFindIsContract,
      sqlUpsertIsContract,
      sqlBulkUpdateIsContract,
      sqlTemporalFilterValueIsContract,
    ]).toEqual([true, true, true, true]);
  });

  it('find() resolves to rows the declared record type describes, and the caller narrows to read a cell', async () => {
    const rows = await driver.find('t', { where: { id: '1' } }, { bypassTenantAudit: true });
    expect(rows).toHaveLength(1);

    // The narrowing the declared type now demands of every caller: a cell
    // arrives as `unknown` and is typed before it is used. Through the old
    // `Promise<any[]>` this read compiled unchecked — and `find()` is the
    // hottest read door in the repo, which is what made this one worth the card.
    const first = rows[0];
    const name: unknown = first.name;
    expect(String(name)).toBe('before');
  });

  it('upsert() resolves to a record shape the declared type describes, behind the same narrowing', async () => {
    const row = await driver.upsert('t', { id: '9', name: 'upserted' }, ['id'], { bypassTenantAudit: true });
    const id: unknown = row.id;
    expect(String(id)).toBe('9');
  });

  it('bulkUpdate() resolves to record shapes the declared type describes, behind the same narrowing', async () => {
    await driver.create('t', { id: '7', name: 'seven' }, { bypassTenantAudit: true });
    const rows = await driver.bulkUpdate('t', [{ id: '7', data: { name: 'seven-updated' } }], {
      bypassTenantAudit: true,
    });
    expect(rows).toHaveLength(1);
    const name: unknown = rows[0].name;
    expect(String(name)).toBe('seven-updated');
  });

  it('temporalFilterValue() answers unknown, so a caller types the coerced comparand before emitting it', () => {
    const coerced = driver.temporalFilterValue('t', 'name', 'plain');
    // Not a temporal field: the contract says such values come back unchanged.
    // The declared `unknown` is what forces this line to exist at all.
    expect(typeof coerced === 'string' ? coerced : null).toBe('plain');
  });

  it('create() and bulkCreate() resolve to record shapes the declared types describe', async () => {
    const created = await driver.create('t', { id: '2', name: 'via create' }, { bypassTenantAudit: true });
    expect(created.id).toBe('2');

    const batch = await driver.bulkCreate(
      't',
      [
        { id: '3', name: 'a' },
        { id: '4', name: 'b' },
      ],
      { bypassTenantAudit: true },
    );
    expect(batch).toHaveLength(2);
    expect(batch.map((row) => row.id)).toEqual(['3', '4']);
  });
});
