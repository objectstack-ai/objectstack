// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16711] The object-definition parameters on `SqlDriver` accept every key
 * they READ, spelled as a **fresh object literal** — and still refuse a key
 * that is genuinely not one of them.
 *
 * ## What this pins, and why it is a CLASS card rather than a third key
 *
 * `SqlDriver` reads keys off caller objects through `(obj as any).<key>` while
 * the parameter's own inline literal declares none of them. Three instances
 * were carded and fixed one at a time before anyone called it a class:
 * `tenancy` (#4311), `indexes` (#16570), and `lifecycle` here. Each fix left
 * the next one standing, and each looked complete from inside its own card.
 *
 * The escape is silent by construction. TypeScript's excess-property check
 * fires on a **fresh object literal** and not on one bound to a variable first:
 *
 * ```ts
 * await driver.initObjects([{ ...bare, lifecycle: { storage: … } }]);   // TS2353
 * const hoisted = { ...bare, lifecycle: { storage: … } };
 * await driver.initObjects([hoisted]);                                 // accepted
 * ```
 *
 * so every existing caller happened to bind first and the package typechecked
 * green for a reason unrelated to correctness. ⇒ a **variable-bound pin cannot
 * go red on this defect**. Every call below is therefore an inline literal in
 * argument position, which is what makes `tsc --noEmit` (this package's
 * `typecheck` script) the instrument that measures it.
 *
 * ## §3 is the NEGATIVE CONTROL and it is the load-bearing section
 *
 * A "fix" that sets the parameter to `any`, or bolts an index signature onto
 * it, turns §1 and §2 green **while deleting the entire layer of type
 * protection they are about** — and nothing in a green run would say so. §3
 * asserts the other direction: a misspelling on a fresh literal still raises
 * TS2353. The `@ts-expect-error` comments ARE the assertion — if any of those
 * lines stops erroring, `tsc` fails the file with TS2578.
 *
 * ## The rotation chain is three links, not one
 *
 * `rotateShards` → `ensureRotation` → `ensureShardTable` all receive the SAME
 * caller object, and only the leaf reads `indexes` / `tenancy`. Declaring the
 * keys on the leaf alone would leave the two links above still narrowing the
 * value in flight, so a fresh literal handed to the public `rotateShards` would
 * still be refused. §2 calls the PUBLIC entry point for exactly that reason.
 *
 * Runs on the always-available in-memory SQLite cell — rotation is SQLite-only
 * (`supportsRotation`), and the parameter types are not dialect-specific.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

const SQLITE = dialectCell('sqlite');

/**
 * The base object, deliberately WITHOUT any of the keys under test — every call
 * site spreads it and writes the key inline, so the literal being checked is
 * fresh in argument position.
 */
const bareObject = (name: string) => ({
  name,
  fields: { v: { type: 'text', maxLength: 64 } },
});

const ROTATION = { storage: { strategy: 'rotation' as const, shards: 2, unit: 'day' as const } };

describe('SqlDriver object-definition parameters accept the keys they read (#16711)', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
    driver = undefined;
  });

  it('§1 initObjects: the inline `lifecycle` literal compiles AND arms ADR-0057 rotation', async () => {
    const T = 'os16711_lifecycle';
    driver = new SqlDriver(SQLITE.config());

    // Fresh literal in argument position — not hoisted to a variable first.
    await driver.initObjects([{ ...bareObject(T), lifecycle: ROTATION }]);

    // The runtime half: the key is not merely ADMITTED by the type, it is still
    // READ. Rotation replaces the base table with a read view over shard
    // tables, so the physical shape says whether the policy was armed. A
    // caller who dropped `lifecycle` at authoring time — the silent failure
    // this card is about — would get an ordinary table and no shards, with
    // nothing anywhere saying the declared policy went unimplemented.
    // ⚠️ Read the whole catalog and filter HERE. A `LIKE '…\\_\\_r%'` predicate
    // needs an explicit `ESCAPE` clause in SQLite, and without one it matches
    // nothing — a zero that reads exactly like "rotation was never armed".
    const knex = (driver as unknown as { knex: any }).knex;
    const objects: Array<{ name: string; type: string }> = await knex
      .raw(`SELECT name, type FROM sqlite_master`)
      .then((r: any) => (Array.isArray(r) ? r : r?.rows ?? []));

    expect(objects.find((o) => o.name === T)?.type).toBe('view');
    expect(objects.filter((o) => o.name.startsWith(`${T}__r`)).map((o) => o.name)).not.toHaveLength(0);
  });

  it('§2 rotateShards: the inline `indexes` + `tenancy` literals compile AND reach the shard', async () => {
    const T = 'os16711_rotate';
    driver = new SqlDriver(SQLITE.config());

    // The PUBLIC entry point of the rotation chain, with a fresh literal
    // carrying both keys the chain's leaf (`ensureShardTable`) reads. Before
    // #16711 this call did not compile: `rotateShards` declared neither key,
    // and the two casts that read them sat three links down.
    const state = await driver.rotateShards({
      ...bareObject(T),
      tenancy: { enabled: false },
      indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }],
      lifecycle: ROTATION,
    });

    expect(state.shards.length).toBeGreaterThan(0);

    // The runtime half: the declared UNIQUE physically landed on the shard the
    // chain created. Dropping `indexes` leaves it unsynced — silently.
    const knex = (driver as unknown as { knex: any }).knex;
    await knex(state.current).insert({ id: 'a', v: 'same' });
    await expect(knex(state.current).insert({ id: 'b', v: 'same' })).rejects.toThrow();
  });

  it('§3 detectManagedDrift still reads `indexes` off its own declared parameter', async () => {
    const T = 'os16711_drift';
    driver = new SqlDriver(SQLITE.config());
    await driver.initObjects([{ ...bareObject(T) }]);

    // `detectManagedDrift` declared `indexes?: any[]` all along and read it
    // through an `as any` anyway — the residue of the same class. Removing the
    // cast must not change what it sees.
    const drift = await driver.detectManagedDrift([
      { ...bareObject(T), indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }] },
    ]);

    expect(drift.some((d) => d.table === T)).toBe(true);
  });
});

/**
 * ⭐ THE NEGATIVE CONTROL (#16711 验收口径 item 4).
 *
 * Widening is only a fix while the accept set still has a boundary. A parameter
 * relaxed to `any`, or given an index signature, makes every assertion above
 * green and every one of the lines below stop erroring — which is the one
 * failure mode a green run cannot otherwise distinguish from a repair.
 *
 * Each `@ts-expect-error` is the assertion: `tsc` fails the file with TS2578
 * ("Unused '@ts-expect-error' directive") the moment the key starts being
 * accepted. Compile-time only, deliberately never called.
 */
export async function refusesKeysThatAreNotDeclared(driver: SqlDriver): Promise<void> {
  const T = 'os16711_negative';

  // @ts-expect-error TS2353 — `lifecycl` is a misspelling; nothing reads it.
  await driver.initObjects([{ ...bareObject(T), lifecycl: ROTATION }]);

  // @ts-expect-error TS2353 — `indexs` is a misspelling; nothing reads it.
  await driver.initObjects([{ ...bareObject(T), indexs: [] }]);

  // @ts-expect-error TS2353 — `tenancyy` is a misspelling; nothing reads it.
  await driver.rotateShards({ ...bareObject(T), tenancyy: { enabled: false } });

  // @ts-expect-error TS2353 — a key nobody ever declared anywhere on this class.
  await driver.rotateShards({ ...bareObject(T), notAKeyAnyoneReads: 1 });

  // @ts-expect-error TS2353 — the same, one method over, so the boundary is
  // pinned on BOTH widened entry points and not just on the first.
  driver.registerObjectMetadata([{ ...bareObject(T), alsoNotAKey: 1 }]);
}

/**
 * The narrowing axis, unchanged from #16570 and re-pinned here because the
 * `lifecycle` widening touches the same literal: a variable-bound argument
 * bypasses the excess-property check and is judged by ordinary assignability,
 * so the declared TYPES still bind. Compile-time only.
 */
export async function pinsTheNarrowingAxis(driver: SqlDriver): Promise<void> {
  const asRecord = { ...bareObject('os16711_narrow'), indexes: { uniq_v: { fields: ['v'] } } };
  // @ts-expect-error TS2322 — a record is not `any[]`.
  await driver.initObjects([asRecord]);
}
