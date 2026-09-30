// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20760] For a day in 0001..0999, `SqlDriver` on SQLite and the in-memory
// face answer the same bucket key at every granularity SQLite buckets in SQL.
//
// The in-memory side is `@objectstack/core`'s `bucketDateKey`, the labeller the
// engine's in-memory `groupBy` and the memory cube face both delegate to (their
// own pins: objectql `in-memory-aggregation-four-digit-year.test.ts`,
// driver-memory `memory-analytics-four-digit-year.test.ts`). SQLite's
// `strftime('%Y')` pads the year to four digits; before the card the helper
// did not, so 0050-06-15 keyed `0050-06` here and `50-06` in memory. `week` is
// not bucketed in SQL on SQLite (the driver refuses it and the engine buckets
// it in memory), so both paths already share the helper there.
//
// The rows are written through `initObjects` + `create`, the path a real
// object takes: a `date` column (`0001..9999`) and a `datetime` column holding
// a stored instant on the same day. Every expected key is also spelled
// literally, so the pin fails if both sides drift together.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bucketDateKey } from '@objectstack/core';
import { SqlDriver } from '../src/index.js';

type Granularity = 'day' | 'month' | 'quarter' | 'year';

const TABLE = 'year_spelling_events';

const FIXTURE = [
  { id: 'r1', iso: '0050-06-15T10:00:00.000Z' },
  { id: 'r2', iso: '0999-06-15T10:00:00.000Z' },
  // The control.
  { id: 'r3', iso: '2026-06-15T10:00:00.000Z' },
];

const EXPECTED: Record<Granularity, string[]> = {
  year: ['0050', '0999', '2026'],
  quarter: ['0050-Q2', '0999-Q2', '2026-Q2'],
  month: ['0050-06', '0999-06', '2026-06'],
  day: ['0050-06-15', '0999-06-15', '2026-06-15'],
};

describe('[#20760] SqlDriver on SQLite and the in-memory face key a year below 1000 alike', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: TABLE, fields: { happened_at: { type: 'datetime' }, happened_on: { type: 'date' } } },
    ]);
    for (const { id, iso } of FIXTURE) {
      await driver.create(
        TABLE,
        { id, happened_at: new Date(iso), happened_on: iso.slice(0, 10) },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  async function sqlKeys(field: string, g: Granularity): Promise<string[]> {
    const rows = await driver.aggregate(TABLE, {
      groupBy: [{ field, dateGranularity: g }],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    return rows.map((r: Record<string, unknown>) => String(r[field])).sort();
  }

  for (const g of Object.keys(EXPECTED) as Granularity[]) {
    describe(`at ${g}`, () => {
      it('the in-memory face spells the key the test expects', () => {
        expect(FIXTURE.map((r) => bucketDateKey(r.iso, g)).sort()).toEqual(EXPECTED[g]);
        expect(FIXTURE.map((r) => bucketDateKey(r.iso.slice(0, 10), g)).sort()).toEqual(EXPECTED[g]);
      });

      it('the datetime column keys the same in SQL', async () => {
        expect(await sqlKeys('happened_at', g)).toEqual(EXPECTED[g]);
      });

      it('the date column keys the same in SQL', async () => {
        expect(await sqlKeys('happened_on', g)).toEqual(EXPECTED[g]);
      });
    });
  }
});
