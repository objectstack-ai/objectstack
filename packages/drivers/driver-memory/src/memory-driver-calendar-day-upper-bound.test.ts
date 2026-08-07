// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Calendar-day upper bounds in the in-memory driver (#4042) — the
 * driver-memory half of #3777's rule: a bare `YYYY-MM-DD` used as an upper
 * bound (`$lte`, `<=`, a `between` max, a dateRange end) means "through that
 * whole day" and compiles half-open (`$lt` next day).
 *
 * Rows store ISO-string timestamps — the driver's OWN storage form (its
 * `created_at` default is `new Date().toISOString()`, and every REST/JSON
 * write arrives as a string). Mingo compares strings lexicographically, so
 * pre-fix `$lte: '2026-07-28'` cut the window at the midnight prefix and the
 * final day's rows vanished, exactly like the SQL drivers. (`Date`-object
 * rows are a separate storage-form problem — mingo compares cross-type as
 * never-equal for EVERY operator, `$gte` included — covered for the analytics
 * window below and tracked separately for `find()`.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import type { Cube } from '@objectstack/spec/data';

const ids = (rows: any[]) => rows.map((r: any) => r.id).sort();

describe('InMemoryDriver — bare-day $lte covers the whole day (#4042)', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({
      initialData: {
        task: [
          { id: 't_midnight', title: 't_midnight', created_at: '2026-07-28T00:00:00.000Z' },
          { id: 't_morning', title: 't_morning', created_at: '2026-07-28T09:15:00.000Z' },
          { id: 't_evening', title: 't_evening', created_at: '2026-07-28T21:40:00.000Z' },
          { id: 't_yesterday', title: 't_yesterday', created_at: '2026-07-27T14:00:00.000Z' },
          { id: 't_old', title: 't_old', created_at: '2026-04-19T10:00:00.000Z' },
        ],
      },
    });
    await driver.connect();
  });

  it('keeps the whole final day — the dashboard default-config window', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    // Pre-fix: only [t_midnight, t_yesterday] — the 09:15 / 21:40 rows fell
    // past the midnight-anchored string prefix.
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('a full-ISO $lte keeps instant semantics — only the bare day is widened', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $lte: '2026-07-28T12:00:00.000Z' } },
    } as any);
    expect(ids(found)).toEqual(['t_midnight', 't_morning', 't_old', 't_yesterday']);
  });

  it('$gte / $gt / $lt keep their midnight anchoring', async () => {
    const gte = await driver.find('task', { where: { created_at: { $gte: '2026-07-28' } } });
    expect(ids(gte)).toEqual(['t_evening', 't_midnight', 't_morning']);

    const gt = await driver.find('task', { where: { created_at: { $gt: '2026-07-28' } } });
    expect(ids(gt)).toEqual(['t_evening', 't_midnight', 't_morning']); // string '…T00:00' > '2026-07-28'

    const lt = await driver.find('task', { where: { created_at: { $lt: '2026-07-28' } } });
    expect(ids(lt)).toEqual(['t_old', 't_yesterday']);
  });

  it('$between with a bare-day max covers the whole final day', async () => {
    const found = await driver.find('task', {
      where: { created_at: { $between: ['2026-04-29', '2026-07-28'] } },
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('stays correct inside an $or branch', async () => {
    const found = await driver.find('task', {
      where: {
        $or: [
          { created_at: { $gte: '2026-07-28', $lte: '2026-07-28' } }, // "today" preset
          { title: 't_old' },
        ],
      },
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_old']);
  });

  it('applies to the authored array spelling, lowered the declared way (#5158)', async () => {
    // The array form is input-only sugar lowered at the engine/protocol doors;
    // the driver no longer compiles it. Same authored filter, same rows. The
    // INFIX join has no lowering — the declared spelling is the prefix group.
    const lte = await driver.find('task', {
      where: parseFilterAST(
        ['and', ['created_at', '>=', '2026-04-29'], ['created_at', '<=', '2026-07-28']],
      ) as any,
    } as any);
    expect(ids(lte)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);

    const between = await driver.find('task', {
      where: parseFilterAST([['created_at', 'between', ['2026-04-29', '2026-07-28']]]) as any,
    } as any);
    expect(ids(between)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });
});

describe('MemoryAnalyticsService — dateRange window (#4042)', () => {
  const CUBE: Cube = {
    name: 'tasks',
    title: 'Tasks',
    sql: 'task',
    measures: {
      count: { name: 'count', label: 'Count', type: 'count', sql: 'id' },
    },
    dimensions: {
      created_at: { name: 'created_at', label: 'Created', type: 'time', sql: 'created_at' },
    },
  } as unknown as Cube;

  it('keeps the final day for BOTH stored forms — ISO strings and Date objects', async () => {
    // One column, two writer forms: the driver's own ISO-string default and a
    // direct JS `Date`. The window must keep the final day's rows of each —
    // the $or-of-both-spellings that stands in for driver-sql's mixed-storage
    // CASE repair.
    const driver = new InMemoryDriver({
      initialData: {
        task: [
          { id: 's_final_day', created_at: '2026-07-28T21:40:00.000Z' },
          { id: 's_in_range', created_at: '2026-07-10T08:00:00.000Z' },
          { id: 's_next_day', created_at: '2026-07-29T00:00:00.000Z' },
          { id: 'd_final_day', created_at: new Date('2026-07-28T09:15:00Z') },
          { id: 'd_in_range', created_at: new Date('2026-07-10T12:00:00Z') },
          { id: 'd_next_day', created_at: new Date('2026-07-29T00:00:00Z') },
          { id: 'd_old', created_at: new Date('2026-04-19T10:00:00Z') },
        ],
      },
    });
    await driver.connect();
    const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });

    const result = await service.query({
      cube: 'tasks',
      measures: ['count'],
      timeDimensions: [
        { dimension: 'created_at', dateRange: ['2026-04-29', '2026-07-28'] },
      ],
    } as any);

    // 4 rows inside the window (2 per storage form, both final-day rows kept);
    // the two next-day-midnight rows and the pre-window Date row are out.
    expect(result.rows[0]?.count).toBe(4);
  });
});
