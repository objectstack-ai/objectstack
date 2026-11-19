// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34598] A direct `aggregate()` call that asks for date buckets in a non-UTC
 * reference zone (`DriverAggregateQuery.timezone`, ADR-0053 Phase 2 D2 as
 * amended) is REFUSED with NOT_IMPLEMENTED / 501 — where it used to be
 * answered with UTC buckets and no word.
 *
 * The engine never sends this driver a zone: it does not declare
 * `supports.zonedDateBucketing`, so `engine.aggregate` buckets a zoned query
 * in memory (pinned engine-side by objectql `engine-aggregate-timezone.test.ts`;
 * objectql is not a dependency of this package, so that path is not reachable
 * from here). Only a caller that goes around the engine reaches this door.
 *
 * # The double
 *
 * No mongod runs in this fleet (the `mongodb-memory-server` download is
 * refused by the egress proxy), so the driver is given a `Db` stand-in whose
 * `aggregate()` hands the emitted pipeline to `mongodb-pipeline-evaluator.testkit.ts`
 * — the strict in-process reader the parity suites share. The refusal is decided
 * before any pipeline exists, so the double bounds only the UTC controls.
 *
 * # Why every refusal asserts `code` AND `status`
 *
 * The un-fixed driver does not throw at all — it returns the UTC rows — so a bare
 * `toThrow()` would catch the defect today and stay green the day the ADR-0112
 * envelope is replaced by a bare `Error`.
 */

import { describe, it, expect } from 'vitest';
import { MongoDBDriver } from './mongodb-driver.js';
import { runPipeline, type Doc } from './mongodb-pipeline-evaluator.testkit.js';

/** An instant that is 2024-03-01 in UTC and 2024-02-29 in New York. */
const STRADDLING = new Date('2024-03-01T03:00:00.000Z');
const ROWS: Doc[] = [{ at: STRADDLING, n: 1 }];
const COUNT = [{ function: 'count', alias: 'c' }];
const DAY_BUCKET = [{ field: 'at', dateGranularity: 'day' }];

function evaluatingDriver(calls: unknown[]): MongoDBDriver {
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused', database: 'unused' });
  (driver as unknown as { db: unknown }).db = {
    collection: () => ({
      aggregate: (pipeline: Doc[]) => {
        calls.push(pipeline);
        return { toArray: async () => runPipeline(ROWS, pipeline) };
      },
    }),
  };
  return driver;
}

async function refusalOf(run: () => Promise<unknown>): Promise<{ code?: string; status?: number; message: string }> {
  try {
    const out = await run();
    throw new Error(`expected a refusal, but aggregate() answered ${JSON.stringify(out)}`);
  } catch (e) {
    return e as { code?: string; status?: number; message: string };
  }
}

describe('[#34598] driver-mongodb refuses a zoned date bucket on a direct call', () => {
  it('a non-UTC timezone on a date bucket answers NOT_IMPLEMENTED / 501, before the server is asked', async () => {
    for (const timezone of ['America/New_York', 'Asia/Shanghai', 'CST', '+08:00']) {
      const calls: unknown[] = [];
      const driver = evaluatingDriver(calls);
      const err = await refusalOf(() =>
        driver.aggregate('ev', { aggregations: COUNT, groupBy: DAY_BUCKET, timezone } as never),
      );
      expect(err.code, timezone).toBe('NOT_IMPLEMENTED');
      expect(err.status, timezone).toBe(501);
      expect(err.message).toContain(`'${timezone}'`);
      expect(calls, timezone).toHaveLength(0);
    }
  });

  it('CONTROL: no timezone, or UTC, still buckets in UTC', async () => {
    for (const timezone of [undefined, 'UTC']) {
      const calls: unknown[] = [];
      const driver = evaluatingDriver(calls);
      const rows = await driver.aggregate('ev', {
        aggregations: COUNT,
        groupBy: DAY_BUCKET,
        ...(timezone === undefined ? {} : { timezone }),
      } as never);
      expect(calls, String(timezone)).toHaveLength(1);
      expect(rows, String(timezone)).toEqual([{ at: '2024-03-01', c: 1 }]);
    }
  });

  it('CONTROL: a timezone with no date bucket reads no zone and is not refused', async () => {
    const calls: unknown[] = [];
    const driver = evaluatingDriver(calls);
    const rows = await driver.aggregate('ev', { aggregations: COUNT, timezone: 'America/New_York' } as never);
    expect(calls).toHaveLength(1);
    expect(rows).toEqual([{ c: 1 }]);
  });
});
