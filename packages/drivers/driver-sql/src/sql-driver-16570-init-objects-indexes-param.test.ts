// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16570] `initObjects` and `registerObjectMetadata` accept `indexes` — the
 * key they have always READ — spelled as a **fresh object literal**.
 *
 * ## The defect this pins
 *
 * Both entry points declared `Array<{ name; fields?; tenancy? }>`, with no
 * `indexes`. The key was read one call deep anyway, through an `as any`, in
 * `registerManagedObjectMetadata`:
 *
 * ```ts
 * this.managedObjectIndexes.set(tableName, (obj as any).indexes);
 * ```
 *
 * and `managedObjectIndexes` is what `syncDeclaredIndexes` renders every
 * declared UNIQUE from — so the driver's whole index-sync path was driven by a
 * key its own signature said did not exist. `detectManagedDrift`, on the same
 * class, had always declared `indexes?: any[]`: the two halves of one class
 * disagreed about the shape of the same input. That is the shape #4311 already
 * fixed for `tenancy`, and the comment it left above `initObjects` described
 * `indexes` word for word.
 *
 * ## Why the FORM of this pin is the whole point
 *
 * TypeScript's excess-property check fires on a **fresh object literal** and
 * not on one bound to a variable first, so the same object was accepted or
 * rejected by where it was spelled:
 *
 * ```ts
 * await driver.initObjects([{ ...bare, indexes: [] }]);   // TS2353
 * const withoutIndex = { ...bare, indexes: [] };
 * await driver.initObjects([withoutIndex]);               // accepted
 * ```
 *
 * Every existing caller in this package happened to bind first — one of them
 * (`sql-driver-11794-richtext-text-family.test.ts`) even wrote the workaround
 * down: *"Hoisted (not an inline literal) … `indexes` rides through
 * `initObjects` beyond its narrow parameter type"*. So the package typechecked
 * green for a reason unrelated to correctness, and a **variable-bound pin
 * cannot go red on this defect** — it measures nothing. Every call below is
 * therefore an inline literal in argument position, which is what makes
 * `tsc --noEmit` (this package's `typecheck` script) the instrument that
 * measures it: revert either signature and these lines stop compiling with
 *
 *   TS2353: Object literal may only specify known properties, and 'indexes'
 *   does not exist in type '{ name: string; fields?: Record<string, any>
 *   | undefined; tenancy?: any; }'.
 *
 * The runtime assertions are the other half: they prove the key is not merely
 * *admitted* by the type but still *read* — recorded in `managedObjectIndexes`
 * (§1), rendered into a physical UNIQUE (§2), and cleared when withdrawn (§3).
 * A signature relaxation that quietly stopped reading the key would pass the
 * compile leg alone.
 *
 * Runs on the always-available in-memory SQLite cell: the defect is in a
 * parameter type and in the registry it feeds, neither of which is
 * dialect-specific.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

const SQLITE = dialectCell('sqlite');

/**
 * The un-indexed base object, deliberately WITHOUT `indexes` — every call site
 * below spreads it and writes `indexes` inline, so the literal being checked is
 * fresh in argument position. `tenancy: { enabled: false }` keeps the declared
 * UNIQUE on the plain (non-tenant-scoped) path, and the bounded `maxLength`
 * keeps `v` a keyable varchar rather than an unbounded TEXT.
 */
const bareObject = (name: string) => ({
  name,
  tenancy: { enabled: false },
  fields: { v: { type: 'text', maxLength: 64 } },
});

/** What the driver recorded for `table`, read off the protected registry. */
const recordedIndexes = (driver: SqlDriver, table: string): unknown =>
  (driver as unknown as { managedObjectIndexes: Map<string, unknown> }).managedObjectIndexes.get(table);

describe('initObjects / registerObjectMetadata accept `indexes` as a fresh object literal (#16570)', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
    driver = undefined;
  });

  it('§1 registerObjectMetadata: the inline literal compiles AND the key is recorded', async () => {
    const T = 'os16570_register';
    driver = new SqlDriver(SQLITE.config());
    const declared = [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }];

    // Fresh literal in argument position — not hoisted to a variable first.
    driver.registerObjectMetadata([{ ...bareObject(T), indexes: declared }]);

    expect(recordedIndexes(driver, T)).toEqual(declared);
  });

  it('§2 initObjects: the inline literal compiles AND the declared UNIQUE is physically synced', async () => {
    const T = 'os16570_init';
    driver = new SqlDriver(SQLITE.config());

    // Fresh literal in argument position.
    await driver.initObjects([
      { ...bareObject(T), indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }] },
    ]);

    const knex = (driver as unknown as { knex: (t: string) => any }).knex;
    await knex(T).insert({ id: 'a', v: 'same' });
    // If `indexes` had been dropped at authoring time — the silent failure mode
    // this card is about — this second row would be accepted.
    await expect(knex(T).insert({ id: 'b', v: 'same' })).rejects.toThrow();
  });

  it('§3 initObjects: the exact `{ ...bare, indexes: [] }` spelling from the card compiles, and withdraws the entry', async () => {
    const T = 'os16570_withdraw';
    driver = new SqlDriver(SQLITE.config());
    const bare = bareObject(T);

    await driver.initObjects([{ ...bare, indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }] }]);
    expect(recordedIndexes(driver, T)).toHaveLength(1);

    // The spelling named in the card, verbatim: an empty array must CLEAR the
    // entry, not leave the previous one standing.
    await driver.initObjects([{ ...bare, indexes: [] }]);
    expect(recordedIndexes(driver, T)).toEqual([]);
  });
});

/**
 * The other half of the accept set. A variable-bound argument bypasses the
 * excess-property check and is judged by ordinary assignability, so `indexes`
 * must be an array — the two `@ts-expect-error`s ARE the assertion here: if
 * either line stops erroring, `tsc` fails it as TS2578. Compile-time only,
 * deliberately never called.
 */
export async function pinsTheNarrowingAxis(driver: SqlDriver): Promise<void> {
  const asRecord = { ...bareObject('os16570_narrow'), indexes: { uniq_v: { fields: ['v'] } } };
  // @ts-expect-error TS2322 — a record is not `any[]`, and never synced an index at run time.
  await driver.initObjects([asRecord]);

  const asNull = { ...bareObject('os16570_narrow'), indexes: null };
  // @ts-expect-error TS2322 — `null` is not `any[]`, and never synced an index at run time.
  await driver.initObjects([asNull]);
}
