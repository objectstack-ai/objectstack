// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32851] A field published `datetime` → `date` keeps its `timestamptz`
 * column on Postgres, and the `date` path read that column in two zones.
 *
 * Measured on live Postgres 16 before the fix, server at `Asia/Shanghai`,
 * process at `America/New_York` (the `Temporal Conformance (live PG + MySQL)`
 * job's pair):
 *
 *   - `create({ due: '2026-11-12' })` answered, and read back, `2026-11-11`:
 *     the bare day was stored as midnight in the SERVER's zone
 *     (`2026-11-11T16:00:00Z`) and read back by its UTC components;
 *   - `due = '2026-11-12'` matched that row (the comparand was cast in the
 *     session zone too) and missed the row written as the instant
 *     `2026-11-12T20:00:00Z` while the field was a `datetime`, which READ
 *     `2026-11-12`;
 *   - the day bucket put the second row on `2026-11-13` (`::date` in the
 *     session zone).
 *
 * The fix reads every door in UTC, the zone the read already used: the write
 * binds the day's UTC midnight, and the filter and the bucket read the column
 * as its UTC calendar day. See `date-on-instant-column.ts`.
 *
 * Every cell writes and reads the same rows: SQLite and MySQL never had the
 * defect (SQLite stores text; MySQL's session is UTC and `DATETIME` is
 * zone-naive) and must still answer the same day. The row written while the
 * field was a `datetime` is asserted through the filter and the bucket on
 * Postgres only: on SQLite and MySQL a bare-day comparand does not match a
 * stored instant with a time of day, the same on the pre-fix tree, and that is
 * not what this card changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'date on an instant column (#32851)';
const TABLE = 'pub32851_due';

/** The live table as it was created: `due` a `datetime`. */
const V1 = { name: TABLE, fields: { label: { type: 'text' }, due: { type: 'datetime' }, seen: { type: 'datetime' } } };
/** The published change: `due` becomes a `date`; `seen` stays a `datetime`. */
const V2 = { name: TABLE, fields: { label: { type: 'text' }, due: { type: 'date' }, seen: { type: 'datetime' } } };

/** 20:00Z is 04:00 the NEXT day at `Asia/Shanghai`: a session-zone day discriminates. */
const DATETIME_ERA = '2026-11-12T20:00:00.000Z';
const DAY = '2026-11-12';
const SEEN = '2026-11-12T23:30:00.000Z';

const rowsOf = (res: unknown): Record<string, unknown>[] =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] })?.rows ?? [])) as Record<string, unknown>[];

function measure(cell: DialectCell): void {
  describe(`a \`datetime\` field published as \`date\` — ${cell.label} (#32851)`, () => {
    const pg = cell.id === 'pg';
    let driver: SqlDriver;
    let columnType = '';
    let serverOffsetSeconds = 0;
    const ids: Record<'era' | 'created' | 'updated', string> = { era: '', created: '', updated: '' };
    let createdAnswer: Record<string, unknown> = {};

    const labelsOf = (rows: readonly Record<string, unknown>[]) => rows.map((r) => String(r.label)).sort();

    // Live: a connect, the two syncs and the publish's column half (#14213).
    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.connect();
      await driver.getKnex().schema.dropTableIfExists(TABLE);

      await driver.syncSchema(TABLE, V1);
      ids.era = String((await driver.create(TABLE, { label: 'era', due: DATETIME_ERA })).id);
      ids.updated = String((await driver.create(TABLE, { label: 'updated', due: DATETIME_ERA })).id);

      // The publish: its storage sync, then the column half it asks for.
      await driver.syncSchema(TABLE, V2);
      await driver.applyPublishedColumnChanges(V2);

      columnType = String(((await driver.getKnex()(TABLE).columnInfo()) as any).due.type).toLowerCase();
      if (pg) {
        const res = await driver.execute(`select extract(timezone from now())::int as off`);
        serverOffsetSeconds = Number(rowsOf(res)[0]?.off);
      }

      createdAnswer = (await driver.create(TABLE, { label: 'created', due: DAY, seen: SEEN })) as Record<string, unknown>;
      ids.created = String(createdAnswer.id);
      await driver.update(TABLE, ids.updated, { due: DAY });
    }, 60_000);

    afterAll(async () => {
      await driver?.getKnex().schema.dropTableIfExists(TABLE).catch(() => {});
      await driver?.disconnect().catch(() => {});
    }, 60_000);

    it.runIf(pg)('the fixture is real: the column is still `timestamptz` and the server zone is ahead of UTC', () => {
      expect(columnType).toBe('timestamp with time zone');
      // The defect needs a session zone east of UTC; CI points the server at
      // `Asia/Shanghai`. A server at UTC would pass every assertion below on
      // the pre-fix tree.
      expect(serverOffsetSeconds, 'point the Postgres server at a zone ahead of UTC (e.g. Asia/Shanghai)').toBeGreaterThan(0);
    });

    it('a day written after the publish is answered and read back as that day', async () => {
      expect(createdAnswer.due).toBe(DAY);
      const created: any = await driver.findOne(TABLE, { where: { id: ids.created } });
      expect(created.due).toBe(DAY);
      const updated: any = await driver.findOne(TABLE, { where: { id: ids.updated } });
      expect(updated.due).toBe(DAY);
    });

    it('a filter by that day finds every row written as that day', async () => {
      const eq = await driver.find(TABLE, { where: { due: DAY } } as any);
      expect(labelsOf(eq as any[])).toEqual(expect.arrayContaining(['created', 'updated']));
      const range = await driver.find(TABLE, { where: { due: { $gte: DAY, $lte: DAY } } } as any);
      expect(labelsOf(range as any[])).toEqual(expect.arrayContaining(['created', 'updated']));
      const before = await driver.find(TABLE, { where: { due: { $lt: DAY } } } as any);
      expect(labelsOf(before as any[])).not.toContain('created');
    });

    it('a `datetime` field beside it still reads and filters as its instant', async () => {
      const row: any = await driver.findOne(TABLE, { where: { id: ids.created } });
      expect(row.seen).toBe(SEEN);
      const hit = await driver.find(TABLE, { where: { seen: SEEN } } as any);
      expect(labelsOf(hit as any[])).toEqual(['created']);
    });

    it.runIf(pg)('the row written as a `datetime` reads, filters and buckets as one day', async () => {
      const era: any = await driver.findOne(TABLE, { where: { id: ids.era } });
      expect(era.due).toBe(DAY);

      const eq = await driver.find(TABLE, { where: { due: DAY } } as any);
      expect(labelsOf(eq as any[])).toEqual(['created', 'era', 'updated']);

      const grouped = await driver.aggregate(TABLE, {
        groupBy: [{ field: 'due', dateGranularity: 'day' }],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as any);
      expect((grouped as any[]).map((g) => [g.due, Number(g.n)])).toEqual([[DAY, 3]]);
    });

    it.runIf(pg)('the outside-the-builder doors (analytics native SQL) answer the same day', async () => {
      const column = driver.temporalFilterColumnSql(TABLE, 'due', '"due"');
      const comparand = driver.temporalFilterValue(TABLE, 'due', DAY);
      const hit = rowsOf(await driver.execute(`select label from "${TABLE}" where ${column} = ? order by label`, [comparand]));
      expect(hit.map((r) => r.label)).toEqual(['created', 'era', 'updated']);

      const expr = driver.dateBucketSql(TABLE, 'due', 'day');
      const echoed = rowsOf(await driver.execute(`select ${expr} as b, count(*) as n from "${TABLE}" group by ${expr}`));
      expect(echoed.map((r) => [r.b, Number(r.n)])).toEqual([[DAY, 3]]);
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, measure);
}
