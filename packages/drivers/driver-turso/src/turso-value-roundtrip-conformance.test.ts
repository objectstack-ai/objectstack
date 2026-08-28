// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12393] `driver-turso` held to `VALUE_ROUNDTRIP_CASES` — the shared
 * `@objectstack/spec/data` table, on **both transports**.
 *
 * This driver is dual-transport and the two halves share no value codec:
 *
 * - **Local / replica** — `TursoDriver extends SqlDriver`, so the `Field.json`
 *   codec #12380 made injective is inherited whole. This half is the twin of
 *   `sql-driver-value-roundtrip-conformance.test.ts`'s SQLite cell.
 * - **Remote** — does not go through knex at all. `RemoteTransport` carries its
 *   own `serializeValue` on the write path and its own `mapRows` on the read
 *   path. That is the independent Nth backend the shared tables exist for, and
 *   it is exactly the seam this table asks about: a driver can be perfectly
 *   correct about *which rows* come back while its own marshalling changes
 *   *what is in them*.
 *
 * Both are driven here for the reason the temporal, filter-logic, pagination
 * and aggregation cells are driven twice in this package: one green transport
 * says nothing about the other.
 *
 * ## Why a SQLite-backed client stub for the remote half
 *
 * Same reason as the remote aggregation and filter-logic suites next door:
 * libsql IS SQLite, so `makeLibsqlSqliteStub` gives the transport real value
 * semantics — TEXT/INTEGER storage classes and the binding rules that go with
 * them — with no network and no credentials. The suites that mock `execute` and
 * assert on the SQL string keep the network as their concern; a value that
 * comes back as the wrong TYPE leaves the SQL perfectly valid, so a string
 * assertion cannot see it.
 *
 * ## ⚠️ Green here does not mean the two halves are doing the same thing
 *
 * They are not. A declared `Field.json` is a `json` column on the local half
 * and a `TEXT` column on the remote one, so the same written value can land in
 * a different SQLite storage class on each while both `find()` calls answer
 * faithfully and every assertion below stays green. That asymmetry is recorded
 * and pinned separately, in `turso-json-column-type-asymmetry.test.ts` (#12586)
 * — this suite is deliberately blind to it, which is why the pin is its own
 * file rather than another case in here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  VALUE_ROUNDTRIP_CASES,
  VALUE_ROUNDTRIP_COLLISION_PAIRS,
  VALUE_ROUNDTRIP_FIELDS,
  VALUE_ROUNDTRIP_ROWS,
  valueRoundTripDivergence,
} from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const TABLE = 'conformance_value_roundtrip';
const OBJECT = { name: TABLE, fields: { ...VALUE_ROUNDTRIP_FIELDS } };

const caseOf = (name: string) => VALUE_ROUNDTRIP_CASES.find((c) => c.name === name)!;

/** The shared body, so the two transports are held to the SAME assertions. */
function declareRoundTrip(label: string, make: () => Promise<TursoDriver>, teardown: () => void): void {
  describe(`[#12393] TursoDriver — value storage round-trip conformance (${label})`, () => {
    let driver: TursoDriver;

    beforeAll(async () => {
      driver = await make();
    }, 60_000);

    afterAll(async () => {
      await driver.disconnect();
      teardown();
    });

    // The fixture read back rather than trusted: a seed that dropped or folded
    // a row would turn every assertion below into a test of the wrong table.
    it('the fixture is one row per case', async () => {
      const rows = (await driver.find(TABLE, {})) as Array<{ label: string }>;
      expect(rows.map((r) => r.label).sort()).toEqual(
        VALUE_ROUNDTRIP_CASES.map((c) => c.name).sort(),
      );
    });

    for (const c of VALUE_ROUNDTRIP_CASES) {
      it(`round-trips ${c.name} (${c.note})`, async () => {
        const rows = (await driver.find(TABLE, {
          where: { label: c.name },
        } as DriverQuery)) as any[];
        expect(rows).toHaveLength(1);
        const read = rows[0][c.column];
        // The type pin comes first: a wrong type carrying a right-looking value
        // survives every value-only comparison, which is how this class of
        // defect reached production more than once.
        expect(typeof read, `typeof for ${c.name}`).toBe(typeof c.wrote);
        expect(read, `value for ${c.name}`).toStrictEqual(c.wrote);
      });
    }

    it('every case in the table round-trips — the whole set at once', async () => {
      const rows = (await driver.find(TABLE, {})) as any[];
      const byLabel = new Map(rows.map((r) => [r.label, r]));
      const divergences = VALUE_ROUNDTRIP_CASES.map((c) =>
        valueRoundTripDivergence(c, byLabel.get(c.name)?.[c.column]),
      ).filter((d): d is string => d !== null);
      expect(
        divergences,
        `${VALUE_ROUNDTRIP_CASES.length - divergences.length}/${VALUE_ROUNDTRIP_CASES.length} faithful`,
      ).toEqual([]);
    });

    it('a string and the native value it looks like stay distinguishable', async () => {
      const rows = (await driver.find(TABLE, {})) as any[];
      const byLabel = new Map(rows.map((r) => [r.label, r]));
      for (const [strName, nativeName] of VALUE_ROUNDTRIP_COLLISION_PAIRS) {
        const s = byLabel.get(strName)?.[caseOf(strName).column];
        const n = byLabel.get(nativeName)?.[caseOf(nativeName).column];
        expect(typeof s, `${strName} must read back as a string`).toBe('string');
        expect(
          JSON.stringify(s) === JSON.stringify(n) && typeof s === typeof n,
          `${strName} and ${nativeName} read identically`,
        ).toBe(false);
      }
    });
  });
}

declareRoundTrip(
  'local mode — the inherited SqlDriver codec',
  async () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.transportMode).toBe('local');
    await driver.initObjects([OBJECT]);
    for (const row of VALUE_ROUNDTRIP_ROWS) {
      await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    }
    return driver;
  },
  () => {},
);

let remoteStub: LibsqlSqliteStub | undefined;
declareRoundTrip(
  'remote mode — the transport\'s own serializeValue/mapRows',
  async () => {
    remoteStub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({
      url: 'libsql://conformance.turso.io',
      client: remoteStub as never,
    });
    await driver.connect();
    // The mode this half is about — the one that inherits nothing.
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema(TABLE, OBJECT);
    for (const row of VALUE_ROUNDTRIP_ROWS) await driver.create(TABLE, { ...row });
    return driver;
  },
  () => remoteStub?.close(),
);
