// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SqliteWasmDriver extends SqlDriver`, so the calendar-day upper-bound
 * translation (#3777) — a bare-day `$lte` on a `Field.datetime` column
 * compiling half-open (`< next-day-midnight`) — is inherited, not
 * re-implemented. This pins the inheritance the same way the date-bucket
 * storage fix (#3773) pinned its own: same disease, same cure, one test that
 * fails if the wasm driver ever stops sharing the seam.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from '../src/index.js';

describe('SqliteWasmDriver — bare-day $lte covers the whole day (#3777)', () => {
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'task', fields: { title: { type: 'string' }, created_at: { type: 'datetime' } } },
    ]);
    for (const [id, at] of [
      ['t_midnight', '2026-07-28T00:00:00Z'],
      ['t_evening', '2026-07-28T21:40:00Z'],
      ['t_yesterday', '2026-07-27T14:00:00Z'],
      ['t_next_day', '2026-07-29T00:00:00Z'],
    ] as const) {
      await driver.create(
        'task',
        { id, title: id, created_at: new Date(at) },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await (driver as any).knex.destroy();
  });

  it('keeps the final day of a dashboard window and excludes the next midnight', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    expect(found.map((r: any) => r.id).sort()).toEqual(['t_evening', 't_midnight', 't_yesterday']);
  });
});
