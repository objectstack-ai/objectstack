// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16711] `TursoDriver.initObjects` — the override that shadowed a base-class
 * fix in a separately published package for five weeks.
 *
 * ## The defect this pins, which no gate scoped to `sql-driver.ts` could see
 *
 * `TursoDriver extends SqlDriver` and OVERRIDES `initObjects`. An `override`
 * does **not** inherit the base's parameter type, so this class's own literal —
 * `Array<{ name: string; fields?: Record<string, any> }>` — is what every
 * caller of `@objectstack/driver-turso` saw. Consequences, both measured:
 *
 *   - #4311 declared `tenancy` on `SqlDriver.initObjects` in August. From
 *     outside this package that fix did not exist: a fresh literal carrying
 *     `tenancy` was still TS2353 here, for five weeks, and nothing was red.
 *   - #16570's `indexes` fix would have escaped by the identical route.
 *
 * ⭐ And the type face was the ONLY thing refusing them. The remote arm below
 * forwards the whole object through as `schema`
 * (`syncSchemasBatch(objects.map((obj) => ({ object: obj.name, schema: obj })))`),
 * and `registerRemoteFieldMetadata` reads `tenancy` straight back off it — so
 * the runtime carried both keys the entire time. That is this card's cleanest
 * instance of "the type contradicts the runtime", and it lives in a different
 * published package from the class it contradicts.
 *
 * ## Why the pin is an inline literal
 *
 * TypeScript's excess-property check fires on a **fresh object literal** and
 * not on one bound to a variable first, so a variable-bound pin cannot go red
 * on this defect at all. Every call below is inline in argument position, which
 * makes this package's `typecheck` script the instrument.
 *
 * §3 is the negative control: a misspelling must still be refused. A "fix" that
 * relaxed this parameter to `any` or gave it an index signature would turn §1
 * and §2 green while deleting the whole protection — and §3 is what says so.
 */

import { describe, it, expect } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/**
 * The base object, deliberately WITHOUT any key under test. `organization_id`
 * is present as a field so the implicit-tenancy heuristic has something to find
 * — which is what makes §2's opt-out reading non-vacuous.
 */
const bareObject = (name: string) => ({
  name,
  fields: {
    v: { type: 'text', maxLength: 64 },
    organization_id: { type: 'text', maxLength: 64 },
  },
});

/** The tenant column this driver resolved for `object`, read off the registry. */
const tenantFieldFor = (driver: TursoDriver, object: string): string | null =>
  (driver as unknown as { tenantFieldByTable: Record<string, string | null> }).tenantFieldByTable[object] ?? null;

async function remoteDriver() {
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: makeLibsqlSqliteStub() as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return driver;
}

describe('TursoDriver.initObjects declares every key SqlDriver.initObjects does (#16711)', () => {
  it('§1 the inline literal carrying all four base keys compiles and is accepted', async () => {
    const driver = await remoteDriver();
    const T = 'os16711_turso_all';

    // Fresh literal in argument position. Before #16711 this did not compile:
    // `tenancy`, `indexes` and `lifecycle` were all TS2353 against this
    // override's own narrower literal, while the base declared the first two.
    await driver.initObjects([
      {
        ...bareObject(T),
        tenancy: { enabled: true },
        indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${T}_v` }],
        lifecycle: { storage: { strategy: 'rotation' as const, shards: 2, unit: 'day' as const } },
      },
    ]);

    // The remote path registers read-coercion metadata for the object; that it
    // did so is the evidence the call reached the driver rather than merely
    // typechecking.
    expect(tenantFieldFor(driver, T)).toBe('organization_id');
  });

  it('§2 `tenancy` is READ, not merely admitted — the opt-out changes the tenant column', async () => {
    const driver = await remoteDriver();
    const T = 'os16711_turso_optout';

    // ⭐ The ruling's own example of why this key is not decoration:
    // `tenancy.enabled: false` is what decides whether a UNIQUE partitions
    // globally or per organization. An author who hit the old TS2353 and
    // DROPPED the key would silently get the other answer.
    await driver.initObjects([{ ...bareObject(T), tenancy: { enabled: false } }]);

    expect(tenantFieldFor(driver, T)).toBeNull();
  });
});

/**
 * ⭐ THE NEGATIVE CONTROL (#16711 验收口径 item 4). Each `@ts-expect-error` IS
 * the assertion: `tsc` fails the file with TS2578 the moment the key starts
 * being accepted, which is precisely what a relaxation to `any` or an index
 * signature would do. Compile-time only, deliberately never called.
 */
export async function refusesKeysThatAreNotDeclared(driver: TursoDriver): Promise<void> {
  const T = 'os16711_turso_negative';

  // @ts-expect-error TS2353 — `tenancyy` is a misspelling; nothing reads it.
  await driver.initObjects([{ ...bareObject(T), tenancyy: { enabled: false } }]);

  // @ts-expect-error TS2353 — `indexs` is a misspelling; nothing reads it.
  await driver.initObjects([{ ...bareObject(T), indexs: [] }]);

  // @ts-expect-error TS2353 — a key nobody declares anywhere on either class.
  await driver.initObjects([{ ...bareObject(T), notAKeyAnyoneReads: 1 }]);
}
