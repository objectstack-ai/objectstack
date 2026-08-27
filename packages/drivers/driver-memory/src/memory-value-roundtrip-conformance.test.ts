// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12393] `driver-memory` held to `VALUE_ROUNDTRIP_CASES` — the shared
 * `@objectstack/spec/data` table: what you wrote is what you read back.
 *
 * This driver runs in process, so every case here is a REAL execution — no
 * server-free half in the shape `driver-mongodb` needs (#5517), and no
 * emitted-shape assertion standing in for a value.
 *
 * ## Why an in-process store is not exempt from this table
 *
 * "It keeps the object you handed it, so of course it round-trips" is the
 * assumption the census exists to disprove, and this driver has broken it
 * before on the neighbouring axis: `computeAggregate` had no `count_distinct`
 * arm and answered `null` silently (#6814). A store that clones, normalises,
 * indexes or re-serialises a written value on the way in or out has exactly the
 * seam every other driver has — and if it ever grows one, this is the file that
 * says so. Its being green today is the measurement, not a reason to skip it.
 *
 * The reverse-verification leg below is what keeps it from being a test that
 * cannot fail.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  VALUE_ROUNDTRIP_CASES,
  VALUE_ROUNDTRIP_COLLISION_PAIRS,
  VALUE_ROUNDTRIP_FIELDS,
  VALUE_ROUNDTRIP_ROWS,
  valueRoundTripDivergence,
} from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { InMemoryDriver } from './memory-driver.js';

const TABLE = 'conformance_value_roundtrip';

describe('[#12393] driver-memory — value storage round-trip conformance', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver();
    // `syncSchema` rather than `initObjects`: this driver is SCHEMALESS and has
    // no `initObjects` at all. Declaring the object anyway is the point — it is
    // what makes the declaration reachable if this driver ever grows a
    // declared-type write path, and it is the same declaration every sibling
    // suite hands its own driver.
    await driver.syncSchema(TABLE, { fields: { ...VALUE_ROUNDTRIP_FIELDS } });
    for (const row of VALUE_ROUNDTRIP_ROWS) {
      await driver.create(TABLE, { ...row });
    }
  });

  // The fixture read back rather than trusted: a seed that dropped or folded a
  // row would turn every assertion below into a test of the wrong table.
  it('the fixture is one row per case', async () => {
    const rows = (await driver.find(TABLE, {})) as Array<{ label: string }>;
    expect(rows.map((r) => r.label).sort()).toEqual(VALUE_ROUNDTRIP_CASES.map((c) => c.name).sort());
  });

  for (const c of VALUE_ROUNDTRIP_CASES) {
    it(`round-trips ${c.name} (${c.note})`, async () => {
      const rows = (await driver.find(TABLE, {
        where: { label: c.name },
      } as DriverQuery)) as any[];
      expect(rows).toHaveLength(1);
      const read = rows[0][c.column];
      // The type pin comes first: a wrong type carrying a right-looking value
      // is the before-state of every card this table was written from, and it
      // survives every value-only comparison.
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
    const caseOf = (name: string) => VALUE_ROUNDTRIP_CASES.find((c) => c.name === name)!;
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
