// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12393] `driver-sqlite-wasm` held to `VALUE_ROUNDTRIP_CASES` — the shared
 * `@objectstack/spec/data` table, run through this driver's own pipeline.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the `Field.json` codec #12380 made
 * injective is INHERITED and nothing here re-implements it. What this cell pins
 * is the other half, the same half its filter-logic, temporal, pagination and
 * aggregation suites pin: the values have to survive a different **engine**.
 * This driver swaps knex's transport for a custom sql.js dialect
 * (`Client_WasmSqlite`) that compiles the statement, binds its parameters and
 * marshals the rows back through its own path.
 *
 * That marshalling step is exactly why this cell is not a formality for THIS
 * table in particular. Every case here turns on the JS type a value arrives
 * back as, and a dialect that binds or marshals through a different type path —
 * sql.js hands back its own value objects — can change a type while every row
 * count and every filter result stays correct. "It inherits the codec,
 * therefore it is fine" is the assumption these suites exist to disprove: the
 * judgement #4405 recorded for this driver's filter-logic cell, applied to the
 * stored value.
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
import { SqliteWasmDriver } from './index.js';

const TABLE = 'conformance_value_roundtrip';

const caseOf = (name: string) => VALUE_ROUNDTRIP_CASES.find((c) => c.name === name)!;

describe('[#12393] driver-sqlite-wasm — value storage round-trip conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
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
