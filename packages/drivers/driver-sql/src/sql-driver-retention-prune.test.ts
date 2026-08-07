// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression for age-based retention sweeps on Postgres (today the ADR-0057
 * LifecycleService Reaper; originally the retired NotificationRetention /
 * JobRunRetention plugin sweepers, which hit this exact bug):
 *
 * The builtin `created_at` audit column is provisioned as a native `TIMESTAMP`
 * (`table.timestamp`), so a retention prune MUST filter it with an ISO-8601
 * cutoff. An earlier sweep passed a bare epoch-ms number, which compares a
 * bigint to a timestamp column — Postgres rejects it ("date/time field value
 * out of range"). SQLite's lenient column affinity hid the bug.
 *
 * This proves the path the sweep now relies on: declaring the builtin
 * `created_at` column as `datetime` registers it for per-dialect filter
 * coercion, so a `created_at < <ISO>` delete prunes exactly the aged rows. Rows
 * are written as JS `Date`s, exactly as the outboxes now do.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver retention prune on a builtin created_at timestamp column', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // `created_at` is a builtin audit column; declaring it `datetime` (as the
    // outbox objects now do) registers it for filter coercion without creating a
    // duplicate column.
    await driver.initObjects([
      {
        name: 'retention_probe',
        fields: { created_at: { type: 'datetime' }, label: { type: 'string' } },
      },
    ]);

    // Write `created_at` as `Date` objects — the outbox enqueue convention. On
    // SQLite better-sqlite3 stores these as INTEGER milliseconds.
    await driver.create('retention_probe',
      { id: 'old1', label: 'old', created_at: new Date('2025-01-01T00:00:00Z') }, { bypassTenantAudit: true });
    await driver.create('retention_probe',
      { id: 'old2', label: 'old', created_at: new Date('2025-02-01T00:00:00Z') }, { bypassTenantAudit: true });
    await driver.create('retention_probe',
      { id: 'new1', label: 'new', created_at: new Date('2026-06-01T00:00:00Z') }, { bypassTenantAudit: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('prunes rows older than an ISO-8601 cutoff and keeps recent ones', async () => {
    const cutoffIso = new Date('2026-01-01T00:00:00.000Z').toISOString();

    const deleted = await driver.deleteMany(
      'retention_probe',
      { where: { created_at: { $lt: cutoffIso } } },
      { bypassTenantAudit: true },
    );
    expect(deleted).toBe(2);

    const remaining = await driver.find('retention_probe', {});
    expect(remaining.map((r: any) => r.id)).toEqual(['new1']);
  });

  it('an ISO-8601 cutoff before every row deletes nothing', async () => {
    const deleted = await driver.deleteMany(
      'retention_probe',
      { where: { created_at: { $lt: '2020-01-01T00:00:00.000Z' } } },
      { bypassTenantAudit: true },
    );
    expect(deleted).toBe(0);

    const remaining = await driver.find('retention_probe', {});
    expect(remaining.map((r: any) => r.id).sort()).toEqual(['new1', 'old1', 'old2']);
  });
});
