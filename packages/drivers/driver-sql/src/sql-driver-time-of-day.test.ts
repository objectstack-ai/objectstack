// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `Field.time` canonical presentation (#2004, #3994).
 *
 * `Field.time` is a wall-clock time-of-day, not an instant. Since #3994 the
 * driver stores, filters and presents ONE canonical shape — `HH:MM:SS`, with a
 * `.fff` suffix only when the milliseconds are non-zero — via the same
 * `canonicalTimeOfDay` on all three paths. On read that transparently repairs
 * legacy rows (full-timestamp text from the old `CURRENT_TIMESTAMP` default,
 * epoch ms from a bound `Date`) with no data migration; `HH:MM:SS` writes
 * round-trip identically (the field-zoo `f_time` contract, #2022), while a
 * minutes-only `HH:MM` gains its `:00` so equality filters and `distinct()`
 * cannot split one wall clock into several presented values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const TIME_OF_DAY = /^\d{2}:\d{2}:\d{2}(\.\d{3})?$/;

describe('Field.time canonical presentation (time-of-day, SQLite)', () => {
  let driver: SqlDriver;
  let raw: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    });
    raw = (driver as any).knex;
    await driver.initObjects([
      {
        name: 'shift',
        fields: {
          label: { type: 'string' },
          starts_at: { type: 'time' },
          auto_at: { type: 'time', defaultValue: 'NOW()' },
        },
      },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('repairs a legacy full-timestamp time value to its time-of-day on read', async () => {
    // A row written by a raw insert that took the OLD full `CURRENT_TIMESTAMP`
    // default (or any full timestamp that leaked into the column), bypassing the
    // driver write path.
    await raw('shift').insert({ id: 'legacy', label: 'L', starts_at: '2026-01-15 14:30:00' });
    const row: any = await driver.findOne('shift', { object: 'shift', where: { id: 'legacy' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBe('14:30:00');
  });

  it('repairs a full-ISO value (with Z) in a time column to its time-of-day', async () => {
    await raw('shift').insert({ id: 'iso', label: 'I', starts_at: '2026-01-15T14:30:00.500Z' });
    const row: any = await driver.findOne('shift', { object: 'shift', where: { id: 'iso' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBe('14:30:00.500');
  });

  it('round-trips HH:MM:SS identically (field-zoo parity, #2022) and completes HH:MM', async () => {
    // `HH:MM:SS[.fff]` IS the canonical shape — written, stored and presented
    // byte-identically. A minutes-only `HH:MM` is the same wall clock as its
    // `HH:MM:00` spelling and must canonicalise to it (#3994): leaving both
    // forms in one column made `=` filters and `distinct()` treat them as two.
    for (const [id, written, presented] of [
      ['a', '14:30', '14:30:00'],
      ['b', '14:30:00', '14:30:00'],
      ['c', '09:05:30', '09:05:30'],
      ['d', '09:05:30.250', '09:05:30.250'],
    ] as const) {
      await driver.create('shift', { id, label: id, starts_at: written }, { bypassTenantAudit: true });
      const row: any = await driver.findOne('shift', { object: 'shift', where: { id } }, { bypassTenantAudit: true });
      expect(row.starts_at).toBe(presented);
    }
  });

  it('a NOW()-default time column reads back a time-of-day, not a full timestamp', async () => {
    // `auto_at` omitted → the DDL default fires.
    await driver.create('shift', { id: 'd', label: 'D' }, { bypassTenantAudit: true });
    const row: any = await driver.findOne('shift', { object: 'shift', where: { id: 'd' } }, { bypassTenantAudit: true });
    expect(row.auto_at).toMatch(TIME_OF_DAY);
    expect(row.auto_at).not.toContain('-'); // not a `YYYY-MM-DD …` timestamp
  });

  it('find() (list path) normalizes time identically to findOne()', async () => {
    await raw('shift').insert({ id: 'l1', label: 'L1', starts_at: '2026-02-02 08:15:00' });
    await driver.create('shift', { id: 'l2', label: 'L2', starts_at: '08:15:00' }, { bypassTenantAudit: true });
    const rows = await driver.find('shift', { object: 'shift', orderBy: [{ field: 'id', order: 'asc' }] });
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    expect(byId.l1.starts_at).toBe('08:15:00'); // legacy full-timestamp repaired
    expect(byId.l2.starts_at).toBe('08:15:00'); // canonical write round-trips
  });

  it('leaves null untouched', async () => {
    await driver.create('shift', { id: 'n', label: 'N', starts_at: null }, { bypassTenantAudit: true });
    const row: any = await driver.findOne('shift', { object: 'shift', where: { id: 'n' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBeNull();
  });
});
