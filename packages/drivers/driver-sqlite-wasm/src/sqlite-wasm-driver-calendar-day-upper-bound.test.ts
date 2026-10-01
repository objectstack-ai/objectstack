// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A bare-day `$lte` on a `Field.datetime` column means the whole day (#3777):
 * `< next-day-midnight`, half-open. Since #20822 no driver applies that rule
 * itself — the shared lowering (`lowerFilterCondition`, `@objectstack/spec/data`)
 * applies it once at the seams (ADR-0053 D-D1, amended) — so what this driver
 * owns is the second half: converting the lowered `$lt` bound, a calendar
 * string, to the column's storage form (D-A1, D-E3), inherited from `SqlDriver`
 * like the date-bucket storage fix (#3773). This pins that the wasm driver
 * answers a seam-lowered window with the whole final day.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lowerFilterCondition } from '@objectstack/spec/data';
import { SqliteWasmDriver } from '../src/index.js';

const TASK_FIELDS: Record<string, { type: string }> = { title: { type: 'string' }, created_at: { type: 'datetime' } };

/** What a TYPED seam hands this driver: the filter through the shared lowering. */
const seamed = (where: unknown): unknown =>
  lowerFilterCondition(where, { isDatetimeColumn: (column) => TASK_FIELDS[column]?.type === 'datetime' });

describe('SqliteWasmDriver — bare-day $lte covers the whole day (#3777)', () => {
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: 'task', fields: TASK_FIELDS }]);
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
      where: seamed({ created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } }),
    } as any);
    expect(found.map((r: any) => r.id).sort()).toEqual(['t_evening', 't_midnight', 't_yesterday']);
  });
});
