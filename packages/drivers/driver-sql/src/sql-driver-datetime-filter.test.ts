// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression: filters on `Field.datetime()` columns must work even when
 * the comparand is an ISO date string. The platform stores datetime
 * values as INTEGER milliseconds (via better-sqlite3's Date binding),
 * so `where: { published_at: { $gte: '2026-01-01' } }` used to compile
 * to a TEXT-vs-INTEGER affinity compare that never matched.
 *
 * This suite covers ISO string, full ISO timestamp, JS Date and numeric
 * inputs for both `Field.datetime()` and `Field.date()` columns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver datetime filter coercion', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'publication',
        fields: {
          title: { type: 'string' },
          published_at: { type: 'datetime' },
          period_start: { type: 'date' },
          views: { type: 'integer' },
        },
      },
    ]);

    // Insert with real Date objects so better-sqlite3 stores them as
    // INTEGER milliseconds — the exact path the seed loader takes via
    // `cel\`daysAgo(N)\``.
    await driver.create('publication', {
      id: 'p1', title: 'Old', views: 100,
      published_at: new Date('2025-01-15T00:00:00Z'),
      period_start: '2025-01-15',
    }, { bypassTenantAudit: true });
    await driver.create('publication', {
      id: 'p2', title: 'New', views: 200,
      published_at: new Date('2026-03-20T12:00:00Z'),
      period_start: '2026-03-20',
    }, { bypassTenantAudit: true });
    await driver.create('publication', {
      id: 'p3', title: 'Newer', views: 300,
      published_at: new Date('2026-05-25T08:00:00Z'),
      period_start: '2026-05-25',
    }, { bypassTenantAudit: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('matches datetime $gte against an ISO date string', async () => {
    const rows = await driver.find('publication', {
      where: { published_at: { $gte: '2026-01-01' } },
      orderBy: [{ field: 'published_at', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.id)).toEqual(['p2', 'p3']);
  });

  it('matches datetime range with $gte / $lt', async () => {
    const rows = await driver.find('publication', {
      where: { published_at: { $gte: '2026-01-01', $lt: '2026-05-01' } },
    });
    expect(rows.map((r: any) => r.id)).toEqual(['p2']);
  });

  it('accepts a full ISO timestamp', async () => {
    const rows = await driver.find('publication', {
      where: { published_at: { $gte: '2026-05-25T00:00:00.000Z' } },
    });
    expect(rows.map((r: any) => r.id)).toEqual(['p3']);
  });

  it('accepts a JS Date object', async () => {
    const rows = await driver.find('publication', {
      where: { published_at: { $gte: new Date('2026-01-01T00:00:00Z') } },
    });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['p2', 'p3']);
  });

  it('accepts a numeric epoch millisecond value', async () => {
    const ms = Date.parse('2026-01-01T00:00:00Z');
    const rows = await driver.find('publication', {
      where: { published_at: { $gte: ms } },
    });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['p2', 'p3']);
  });

  it('still filters non-date columns normally', async () => {
    const rows = await driver.find('publication', {
      where: { views: { $gte: 200 } },
    });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['p2', 'p3']);
  });

  it('matches date (YYYY-MM-DD) columns with ISO comparand', async () => {
    const rows = await driver.find('publication', {
      where: { period_start: { $gte: '2026-01-01' } },
    });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['p2', 'p3']);
  });
});
