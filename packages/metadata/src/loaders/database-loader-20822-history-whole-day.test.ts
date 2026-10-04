// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20822 · ADR-0053 D-D1 items 5, 7 and 10, as amended] In driver mode
 * `DatabaseLoader.queryHistory` is a seam: it lowers its own `where` with the
 * shared lowering before any driver sees it, so `until: 'YYYY-MM-DD'` keeps
 * meaning "through the whole of that day" on every driver.
 *
 * ## Why the loader, not the driver
 *
 * In driver mode (`MetadataManager.setDatabaseDriver`) the history filter goes
 * straight to `IDataDriver.find` / `count` and passes no seam. Each driver's own
 * whole-day copy is deleted by its step-4 card, and item 5 says a caller that
 * reaches a face without a seam then "gets the comparison it wrote": `recorded_at
 * <= 'YYYY-MM-DD'`, i.e. `<=` midnight, which drops every version recorded later
 * that day. Measured on `@objectstack/driver-memory` with its copy deleted:
 * `until` = today went from 2 rows to 0. Item 5's remedy is to make the caller a
 * seam, so the loader runs `lowerFilterCondition` typed by the history object it
 * syncs — `recorded_at` is `Field.datetime`, every other column lowers
 * byte-identical (item 7).
 *
 * ## What is pinned, and on what
 *
 * - §A the rows: real SQLite (`driver-sqlite-wasm`, already a devDependency)
 *   in driver mode. `SqlDriver` still carries its own copy until its deletion
 *   card (#20822 group 2) lands, so §A is green with or without the loader's
 *   lowering today; it is the answer that card must keep.
 * - §B the seam itself: what the loader hands the driver. This is the half
 *   that goes red when the loader stops lowering, whatever the driver does,
 *   so it holds for every driver — `driver-memory`, whose copy is gone,
 *   included.
 *
 * ⛔ No `@objectstack/driver-memory` here: a new test consumer of that package
 * needs a maintainer ruling (`scripts/driver-memory-census.ledger.json`). §B pins
 * the filter every driver receives, and `driver-memory`'s own suite pins how it
 * answers that lowered filter and the unlowered one
 * (`memory-driver-20822-comparison-as-written.test.ts`).
 *
 * The clock is faked for `Date` only, so the two versions are recorded at
 * known instants on one known day and no midnight rollover can move a case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatabaseLoader } from './database-loader.js';

const DAY = '2026-07-28';
const NEXT_DAY = '2026-07-29';
const MORNING = '2026-07-28T09:00:00.000Z';
const EVENING = '2026-07-28T21:00:00.000Z';

describe('[#20822] queryHistory in driver mode lowers a bare-day bound itself (ADR-0053 D-D1 item 5)', () => {
  let driver: SqliteWasmDriver;
  let loader: DatabaseLoader;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    loader = new DatabaseLoader({ driver, trackHistory: true, cache: { enabled: false } });

    vi.setSystemTime(new Date(MORNING));
    await loader.save('view', 'case_grid', { name: 'case_grid', label: 'one' });
    vi.setSystemTime(new Date(EVENING));
    await loader.save('view', 'case_grid', { name: 'case_grid', label: 'two' });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await driver.disconnect();
  });

  describe('§A the rows, on real SQLite', () => {
    it('the fixture really holds two versions recorded after midnight of DAY', async () => {
      const all = await loader.queryHistory('view', 'case_grid');
      expect(all.records.map((r) => r.recordedAt)).toEqual([EVENING, MORNING]);
      expect(all.total).toBe(2);
    });

    it('until = DAY keeps both versions recorded on DAY', async () => {
      const page = await loader.queryHistory('view', 'case_grid', { until: DAY });
      expect(page.records.map((r) => r.recordedAt)).toEqual([EVENING, MORNING]);
      expect(page.total).toBe(2);
    });

    it('since = until = DAY is the whole of DAY', async () => {
      const page = await loader.queryHistory('view', 'case_grid', { since: DAY, until: DAY });
      expect(page.records.map((r) => r.recordedAt)).toEqual([EVENING, MORNING]);
      expect(page.total).toBe(2);
    });

    it('the bound still bounds: until = the day before keeps nothing', async () => {
      const page = await loader.queryHistory('view', 'case_grid', { until: '2026-07-27' });
      expect(page.records).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('an instant until is kept as written, never widened', async () => {
      const page = await loader.queryHistory('view', 'case_grid', { until: '2026-07-28T12:00:00.000Z' });
      expect(page.records.map((r) => r.recordedAt)).toEqual([MORNING]);
      expect(page.total).toBe(1);
    });
  });

  describe('§B the filter the driver receives: the loader is the seam', () => {
    it('until = DAY reaches find and count as recorded_at < the next day', async () => {
      const find = vi.spyOn(driver, 'find');
      const count = vi.spyOn(driver, 'count');
      await loader.queryHistory('view', 'case_grid', { until: DAY });

      const findWhere = find.mock.calls.find(([table]) => table === 'sys_metadata_history')?.[1]?.where;
      const countWhere = count.mock.calls.find(([table]) => table === 'sys_metadata_history')?.[1]?.where;
      expect(findWhere).toEqual({ type: 'view', name: 'case_grid', recorded_at: { $lt: NEXT_DAY } });
      expect(countWhere).toEqual(findWhere);
    });

    it('since = until = DAY keeps the midnight lower bound and widens only the upper', async () => {
      const find = vi.spyOn(driver, 'find');
      await loader.queryHistory('view', 'case_grid', { since: DAY, until: DAY });

      const where = find.mock.calls.find(([table]) => table === 'sys_metadata_history')?.[1]?.where;
      expect(where).toEqual({ type: 'view', name: 'case_grid', recorded_at: { $gte: DAY, $lt: NEXT_DAY } });
    });

    it('an instant until and the non-datetime columns reach the driver byte-identical', async () => {
      const find = vi.spyOn(driver, 'find');
      await loader.queryHistory('view', 'case_grid', {
        operationType: 'update',
        until: '2026-07-28T12:00:00.000Z',
      });

      const where = find.mock.calls.find(([table]) => table === 'sys_metadata_history')?.[1]?.where;
      expect(where).toEqual({
        type: 'view',
        name: 'case_grid',
        operation_type: 'update',
        recorded_at: { $lte: '2026-07-28T12:00:00.000Z' },
      });
    });
  });
});
