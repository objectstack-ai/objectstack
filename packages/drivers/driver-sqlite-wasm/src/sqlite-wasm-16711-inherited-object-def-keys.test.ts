// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16711 — the INHERITING half of the subclass-shadowing class, asserted rather
// than assumed.
//
// `SqliteWasmDriver extends SqlDriver` and overrides NEITHER `initObjects` nor
// `registerObjectMetadata`, so its published surface re-declares no parameter
// type of its own: the door it exposes is `SqlDriver`'s, read through
// `@objectstack/driver-sql`'s built `.d.ts`. That is the OPPOSITE direction of
// the defect this card is about — `TursoDriver` overrides `initObjects` with a
// narrower literal and shadowed #4311's `tenancy` fix for five weeks — and the
// card's 验收口径 item 3 is explicit that this side must be MEASURED, not
// assumed: 「driver-sqlite-wasm(继承,应自动跟随 —— 断言它确实跟随了,
// ⛔ 不要假定)」.
//
// The assertion lives in this package's own tsc program (`tsconfig.json`
// selects `src/**/*`, tests included), so it is answered by the same `.d.ts`
// resolution a downstream consumer of `@objectstack/driver-sqlite-wasm` gets.
//
// Two ways this file goes red, both by design:
//   - `@objectstack/driver-sql` narrows one of these parameters again — the
//     inline literal below stops compiling here, in the package that would
//     otherwise have gone on silently exposing the old shape;
//   - a future override appears in `sqlite-wasm-driver.ts` that re-declares
//     `initObjects` with a narrower literal — the same line goes red, naming
//     the drift here rather than at a consumer, which is exactly the reading
//     nobody had for `TursoDriver` between August and this card.
//
// The negative control at the bottom is what keeps that green from being free:
// a `SqlDriver` parameter relaxed to `any`, or given an index signature, would
// satisfy every line above while deleting the protection they are about.

import { describe, it, expect, afterEach } from 'vitest';
import { SqliteWasmDriver } from './index.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;

type InitObjectsArg = Parameters<SqliteWasmDriver['initObjects']>[0];
type InitObjectsElement = InitObjectsArg extends Array<infer E> ? E : never;

// 1. The inherited door is not masked. `any` would make every assertion below
//    vacuous, so this is asserted before anything is read off the type.
const initObjectsArgIsAny: IsAny<InitObjectsArg> = false;
const initObjectsElementIsAny: IsAny<InitObjectsElement> = false;

// 2. Every key SqlDriver declares is visible on the INHERITED element type.
//    `Pick` fails to compile if the key is absent, so these four consts are the
//    assertion; the `true`s are only how they reach a runtime expectation.
const inheritsTenancy: Pick<InitObjectsElement, 'tenancy'> extends object ? true : never = true;
const inheritsIndexes: Pick<InitObjectsElement, 'indexes'> extends object ? true : never = true;
const inheritsLifecycle: Pick<InitObjectsElement, 'lifecycle'> extends object ? true : never = true;
const inheritsFields: Pick<InitObjectsElement, 'fields'> extends object ? true : never = true;

describe('SqliteWasmDriver inherits SqlDriver object-definition parameters (#16711)', () => {
  let driver: SqliteWasmDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
    driver = undefined;
  });

  it('pins the inherited parameter shape at the type level', () => {
    expect([initObjectsArgIsAny, initObjectsElementIsAny]).toEqual([false, false]);
    expect([inheritsTenancy, inheritsIndexes, inheritsLifecycle, inheritsFields]).toEqual([true, true, true, true]);
  });

  it('accepts a FRESH object literal carrying the inherited keys, and reads them', async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    const T = 'os16711_wasm';

    // Fresh literal in argument position — the only spelling that can go red on
    // this defect, since TypeScript's excess-property check does not fire on a
    // value bound to a variable first.
    await driver.initObjects([
      {
        name: T,
        fields: { v: { type: 'text', maxLength: 64 }, organization_id: { type: 'text', maxLength: 64 } },
        tenancy: { enabled: false },
        indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }],
      },
    ]);

    // The runtime half: `tenancy: { enabled: false }` is READ, not merely
    // admitted — the explicit opt-out beats the implicit `organization_id`
    // heuristic, which is the reading that would silently flip if an author hit
    // a TS2353 and dropped the key.
    const tenantField =
      (driver as unknown as { tenantFieldByTable: Record<string, string | null> }).tenantFieldByTable[T] ?? null;
    expect(tenantField).toBeNull();

    // And `indexes` reached the physical schema.
    const knex = (driver as unknown as { knex: any }).knex;
    await knex(T).insert({ id: 'a', v: 'same' });
    await expect(knex(T).insert({ id: 'b', v: 'same' })).rejects.toThrow();
  });
});

/**
 * ⭐ THE NEGATIVE CONTROL (#16711 验收口径 item 4), on the INHERITED door.
 *
 * The `@ts-expect-error` IS the assertion: `tsc` fails this file with TS2578
 * the moment the base parameter starts accepting anything, which is what a
 * relaxation to `any` or an index signature upstream would do — and this
 * package would otherwise be the last place anyone looked. Compile-time only,
 * deliberately never called.
 */
export async function refusesKeysThatAreNotDeclared(driver: SqliteWasmDriver): Promise<void> {
  // @ts-expect-error TS2353 — `tenancyy` is a misspelling; nothing reads it.
  await driver.initObjects([{ name: 't', tenancyy: { enabled: false } }]);

  // @ts-expect-error TS2353 — a key nobody declares anywhere on either class.
  await driver.initObjects([{ name: 't', notAKeyAnyoneReads: 1 }]);
}
