// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12393] `driver-sql` held to `VALUE_ROUNDTRIP_CASES` — the shared
 * `@objectstack/spec/data` table, run across **every dialect this driver
 * speaks**.
 *
 * ## Why this file is matrix-routed and not SQLite-only
 *
 * The defect that produced the table (#12380) was a *dialect* defect: SQLite's
 * `Field.json` codec was not injective while Postgres and MySQL were faithful,
 * and the difference was invisible to a suite pinned to one client. So the
 * dialect axis is the whole point here, not a formality — this cell is the one
 * `MATRIXED` (#12136) exists to make real, and a SQLite-only version of this
 * file would restate exactly the coverage that let #12380 survive.
 *
 * PG and MySQL are also the **regression control**: they were faithful before
 * #12380's fix and must stay faithful after it. If a future change to the codec
 * moves the defect onto them instead of closing it, it goes red here first.
 *
 * ## Its relationship to `sql-driver-12380-json-roundtrip.test.ts`
 *
 * That file is the *instance* pin: it owns the mechanism evidence — the
 * NUMERIC-affinity interrogation, the on-disk storage classes read through a
 * separate raw query, and the legacy-row migration. None of that is portable to
 * another driver, so none of it belongs in a cross-driver table.
 *
 * This file is the *census* cell: the same value classes, asserted through the
 * public driver boundary only, in the vocabulary four other drivers are held to
 * as well. The overlap in values is deliberate and is the point — it is what
 * makes "SQLite now agrees with Postgres" and "every driver agrees with the
 * standard" the same measurement rather than two.
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
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'conformance_value_roundtrip';

const caseOf = (name: string) => VALUE_ROUNDTRIP_CASES.find((c) => c.name === name)!;

function declareRoundTrip(cell: DialectCell): void {
  describe(`[#12393] driver-sql — value storage round-trip conformance (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([{ name: TABLE, fields: { ...VALUE_ROUNDTRIP_FIELDS } }]);
      for (const row of VALUE_ROUNDTRIP_ROWS) {
        await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
      }
    }, 60_000);

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
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
        // The type pin comes first: `'123'` read back as `123` is #12380's
        // exact before-state, and it survives every value-only comparison.
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

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#12393] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'value storage round-trip', declareRoundTrip);
}
