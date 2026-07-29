// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Temporal values leaving `aggregate()` / `distinct()` (#3797).
 *
 * Both return `await builder` directly, without the `formatOutput` pass every
 * `find()` row gets — so on SQLite, where a `Field.datetime` is stored as
 * INTEGER epoch milliseconds, the raw storage form leaked straight to the
 * caller while the same column read through `find()` came back as canonical
 * ISO-`Z`. Same root cause as #3773, different exit.
 *
 * The contract asserted here: **a datetime that leaves the driver is a datetime
 * in the same shape, whichever call produced it** — and the in-memory
 * `applyInMemoryAggregation` fallback (which consumes already-formatted
 * `find()` rows) has to agree, or a dataset changes key type depending on which
 * path served it.
 *
 * The two shapes that must NOT be normalized are covered too: a date-bucketed
 * column is a LABEL (`'2026-01'`), not an instant, and a numeric aggregate over
 * a datetime is a number.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from '../src/legacy-datetime-storage.testkit.js';

const TABLE = 'deal';

/** The canonical presentation `find()` has always produced. */
const ISO = '2026-01-10T09:00:00.000Z';
const ISO_LATER = '2026-02-14T09:00:00.000Z';

describe('temporal values leaving aggregate()/distinct() (#3797)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          closed_at: { type: 'datetime' }, // canonical ISO-Z TEXT since #3912
          closed_on: { type: 'date' },     // YYYY-MM-DD TEXT
          region: { type: 'string' },
          amount: { type: 'number' },
        },
      },
    ]);

    for (const [id, iso, region, amount] of [
      ['d1', ISO, 'east', 1],
      ['d2', ISO, 'east', 2],       // duplicate instant — distinct() must collapse it
      ['d3', ISO_LATER, 'west', 4],
    ] as const) {
      await driver.create(
        TABLE,
        { id, closed_at: new Date(iso), closed_on: iso.slice(0, 10), region, amount },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  /** What the same column looks like through the path that always formatted it. */
  const viaFind = async (field: string) => {
    const rows = await driver.find(TABLE, { orderBy: [['id', 'asc']] } as any);
    return rows.map((r: any) => r[field]);
  };

  describe('distinct()', () => {
    it('presents a datetime the same way find() does', async () => {
      const values = await driver.distinct(TABLE, 'closed_at');
      expect(values.sort()).toEqual([ISO, ISO_LATER]);
      // Not the raw storage form.
      expect(values.some((v: any) => typeof v === 'number')).toBe(false);
    });

    it('agrees with find() on the same column', async () => {
      const [distinctValues, foundValues] = await Promise.all([
        driver.distinct(TABLE, 'closed_at'),
        viaFind('closed_at'),
      ]);
      expect(new Set(distinctValues)).toEqual(new Set(foundValues));
    });

    it('leaves a date column as YYYY-MM-DD', async () => {
      const values = await driver.distinct(TABLE, 'closed_on');
      expect(values.sort()).toEqual(['2026-01-10', '2026-02-14']);
    });

    it('leaves a non-temporal column alone', async () => {
      expect((await driver.distinct(TABLE, 'region')).sort()).toEqual(['east', 'west']);
    });

    it('collapses two storage forms of the same instant into one value', async () => {
      // SQL `DISTINCT` compares STORED values. A pre-#3912 SQLite
      // `Field.datetime` column held both forms — `formatInput` passed datetime
      // values through, so a `Date` landed as INTEGER epoch ms and an ISO string
      // as TEXT. Two rows recording the SAME instant therefore survived
      // `DISTINCT` as two rows and then presented identically: a duplicate
      // unless the presented values are re-deduplicated.
      //
      // Canonical storage means new writes can no longer produce that pair, so
      // the fixture is an UN-MIGRATED database — where this dedup is still what
      // stands between a legacy row and a duplicated chart axis label.
      const legacy = new LegacyStorageDriver({
        client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
      });
      try {
        await legacy.initObjects([
          { name: TABLE, fields: { closed_at: { type: 'datetime' }, region: { type: 'string' } } },
        ]);
        await legacy.seedLegacyRows(TABLE, 'closed_at', [
          { id: 'l1', closed_at: Date.parse(ISO), region: 'east' },       // INTEGER epoch
          { id: 'l2', closed_at: ISO, region: 'east' },                   // canonical TEXT
          { id: 'l3', closed_at: ISO_LATER, region: 'west' },
        ]);

        const forms = (await legacy.storedForms(TABLE, 'closed_at')).map((r) => r.type);
        expect(forms).toContain('text');
        expect(forms.some((f) => f === 'integer' || f === 'real')).toBe(true);

        // Three stored rows for two instants → two values, not three.
        expect((await legacy.distinct(TABLE, 'closed_at')).sort()).toEqual([ISO, ISO_LATER]);
      } finally {
        await legacy.disconnect();
      }
    });
  });

  describe('aggregate() — min/max over a temporal column', () => {
    it('presents max(datetime) as an instant, not an epoch integer', async () => {
      const rows = await driver.aggregate(TABLE, {
        aggregations: [
          { function: 'max', field: 'closed_at', alias: 'latest' },
          { function: 'min', field: 'closed_at', alias: 'earliest' },
        ],
      } as any);
      expect(rows[0].latest).toBe(ISO_LATER);
      expect(rows[0].earliest).toBe(ISO);
    });

    it('presents min/max of a date column as YYYY-MM-DD', async () => {
      const rows = await driver.aggregate(TABLE, {
        aggregations: [{ function: 'max', field: 'closed_on', alias: 'latest' }],
      } as any);
      expect(rows[0].latest).toBe('2026-02-14');
    });

    it('follows the alias, not the field name', async () => {
      // The column is called `latest`; a name-driven fix would never find it.
      const rows = await driver.aggregate(TABLE, {
        aggregations: [{ function: 'max', field: 'closed_at', alias: 'whatever_i_called_it' }],
      } as any);
      expect(rows[0].whatever_i_called_it).toBe(ISO_LATER);
    });

    it('leaves a NUMERIC aggregate over a datetime as a number', async () => {
      // count/sum/avg over a datetime are numbers by construction — presenting
      // them as instants would be a different kind of wrong.
      const rows = await driver.aggregate(TABLE, {
        aggregations: [{ function: 'count', field: 'closed_at', alias: 'n' }],
      } as any);
      expect(rows[0].n).toBe(3);
    });
  });

  describe('aggregate() — groupBy on a raw temporal column', () => {
    it('keys the group by an instant, not an epoch integer', async () => {
      const rows = await driver.aggregate(TABLE, {
        groupBy: ['closed_at'],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      } as any);
      const byInstant = Object.fromEntries(rows.map((r: any) => [r.closed_at, Number(r.total)]));
      expect(byInstant).toEqual({ [ISO]: 3, [ISO_LATER]: 4 });
    });

    it('keys a structured groupBy without granularity the same way', async () => {
      const rows = await driver.aggregate(TABLE, {
        groupBy: [{ field: 'closed_at' }],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      } as any);
      const byInstant = Object.fromEntries(rows.map((r: any) => [r.closed_at, Number(r.total)]));
      expect(byInstant).toEqual({ [ISO]: 3, [ISO_LATER]: 4 });
    });

    it('matches what the in-memory fallback would key on', async () => {
      // `applyInMemoryAggregation` groups over `driver.find()` rows, which are
      // already formatted — so its keys are `String(<ISO>)`. The pushed-down
      // path has to produce the same key or a dataset changes shape depending
      // on which path served it.
      const rows = await driver.aggregate(TABLE, {
        groupBy: ['closed_at'],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as any);
      const driverKeys = rows.map((r: any) => String(r.closed_at)).sort();
      const inMemoryKeys = [...new Set((await viaFind('closed_at')).map(String))].sort();
      expect(driverKeys).toEqual(inMemoryKeys);
    });

    it('leaves a date-BUCKETED column as its label, not an instant', async () => {
      // Since #3773 the bucket expression is aliased AS the field name, so its
      // column collides with a real datetime field — but its value is a label.
      // Normalizing by column name would feed '2026-01' into the datetime
      // presenter; this is the assertion that keeps the two apart.
      const rows = await driver.aggregate(TABLE, {
        groupBy: [{ field: 'closed_at', dateGranularity: 'month' }],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      } as any);
      const byMonth = Object.fromEntries(rows.map((r: any) => [r.closed_at, Number(r.total)]));
      expect(byMonth).toEqual({ '2026-01': 3, '2026-02': 4 });
    });

    it('leaves a non-temporal groupBy key alone', async () => {
      const rows = await driver.aggregate(TABLE, {
        groupBy: ['region'],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      } as any);
      expect(Object.fromEntries(rows.map((r: any) => [r.region, Number(r.total)]))).toEqual({
        east: 3,
        west: 4,
      });
    });

    it('handles a mixed groupBy — temporal key formatted, plain key untouched', async () => {
      const rows = await driver.aggregate(TABLE, {
        groupBy: ['region', 'closed_at'],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as any);
      const norm = rows.map((r: any) => `${r.region}|${r.closed_at}=${Number(r.n)}`).sort();
      expect(norm).toEqual([`east|${ISO}=2`, `west|${ISO_LATER}=1`]);
    });
  });
});
