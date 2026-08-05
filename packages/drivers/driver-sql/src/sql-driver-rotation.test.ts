// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0057 P2 — physical table rotation for high-frequency telemetry.
 *
 * Rotation-declared objects are time-sharded: writes land in the current
 * shard (`<table>__r<key>`), reads go through a UNION ALL view under the base
 * name, and expiry DROPs shards past the `shards × unit` window (O(1)
 * reclaim). These tests drive the full shard lifecycle on SQLite.
 *
 * Every test boots through `initObjects` first — that's what registers the
 * per-field read/filter bookkeeping (datetime coercion etc.) the shards
 * alias; `rotateShards` alone is the sweep-time entry point, not a boot path.
 * The pinned clock T0 is far in the future so real-`Date.now()` boot shards
 * are deterministically outside the test window.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

const DAY_MS = 86_400_000;
const T0 = Date.parse('2036-08-01T12:00:00.000Z');

const ROTATED_OBJECT = {
  name: 'rot_event',
  fields: {
    payload: { type: 'text' },
    created_at: { type: 'datetime' },
  },
  lifecycle: {
    class: 'telemetry',
    storage: { strategy: 'rotation', shards: 3, unit: 'day' },
  },
};

async function tableNames(driver: SqlDriver): Promise<Record<string, string>> {
  const rows = (await driver.execute(
    "SELECT name, type FROM sqlite_master WHERE name LIKE 'rot_event%' AND name NOT LIKE '%autoindex%'",
  )) as Array<{ name: string; type: string }>;
  return Object.fromEntries(rows.map((r) => [r.name, r.type]));
}

describe('SqlDriver rotation (ADR-0057 P2)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('initObjects shards a rotation-declared object: writes hit the current shard, reads the view', async () => {
    // Boot path — initObjects rotates on the REAL clock, so derive the
    // expected shard key from Date.now() rather than pinning one.
    await driver.initObjects([ROTATED_OBJECT]);
    const todayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const currentShard = `rot_event__r${todayKey}`;

    const names = await tableNames(driver);
    expect(names['rot_event']).toBe('view');
    expect(names[currentShard]).toBe('table');

    await driver.create('rot_event', { id: 'a', payload: 'x' }, { bypassTenantAudit: true });

    // The row is physically in the shard and visible through the view.
    const inShard = (await driver.execute(`SELECT id FROM "${currentShard}"`)) as any[];
    expect(inShard.map((r) => r.id)).toEqual(['a']);
    expect(await driver.count('rot_event', { object: 'rot_event' })).toBe(1);
    const found = await driver.findOne('rot_event', { object: 'rot_event', where: { id: 'a' } });
    expect(found?.payload).toBe('x');
  });

  it('rotating across days creates new shards, unions all live rows, and DROPs shards past the window', async () => {
    await driver.initObjects([ROTATED_OBJECT]);
    await driver.rotateShards(ROTATED_OBJECT, T0); // drops the empty boot shard (outside the T0 window)
    await driver.create('rot_event', { id: 'd0', payload: 'day0', created_at: new Date(T0) }, { bypassTenantAudit: true });

    // Day 1: new shard becomes the write target; day-0 row still readable.
    const day1 = await driver.rotateShards(ROTATED_OBJECT, T0 + 1 * DAY_MS);
    expect(day1.current).toBe('rot_event__r20360802');
    expect(day1.dropped).toEqual([]);
    await driver.create('rot_event', { id: 'd1', payload: 'day1', created_at: new Date(T0 + DAY_MS) }, { bypassTenantAudit: true });
    expect(await driver.count('rot_event', { object: 'rot_event' })).toBe(2);

    // Day 3 (shards=3, window = [day1 .. day3]): the day-0 shard falls out —
    // one O(1) DROP, its rows gone from the view, newer rows intact.
    const day3 = await driver.rotateShards(ROTATED_OBJECT, T0 + 3 * DAY_MS);
    expect(day3.dropped).toEqual(['rot_event__r20360801']);
    expect(day3.shards).toEqual(['rot_event__r20360804', 'rot_event__r20360802']);

    const names = await tableNames(driver);
    expect(names['rot_event__r20360801']).toBeUndefined();
    const remaining = await driver.find('rot_event', { object: 'rot_event' });
    expect(remaining.map((r: any) => r.id).sort()).toEqual(['d1']);
  });

  it('adopts a legacy pre-rotation table as the first shard (no data loss)', async () => {
    // Boot WITHOUT rotation: plain table with history.
    const legacyDef = { name: 'rot_event', fields: ROTATED_OBJECT.fields };
    await driver.initObjects([legacyDef]);
    await driver.create('rot_event', { id: 'legacy', payload: 'old-world', created_at: new Date(T0 - 5 * DAY_MS) }, { bypassTenantAudit: true });

    // Upgrade: same object now declares rotation.
    const res = await driver.rotateShards(ROTATED_OBJECT, T0);
    expect(res.current).toBe('rot_event__r20360801');

    const names = await tableNames(driver);
    expect(names['rot_event']).toBe('view');
    const rows = await driver.find('rot_event', { object: 'rot_event' });
    expect(rows.map((r: any) => r.id)).toEqual(['legacy']);
  });

  it('by-id update/delete and bulk deleteMany fan out across shards', async () => {
    await driver.initObjects([ROTATED_OBJECT]);
    await driver.rotateShards(ROTATED_OBJECT, T0);
    await driver.create('rot_event', { id: 'old', payload: 'p0', created_at: new Date(T0) }, { bypassTenantAudit: true });
    await driver.rotateShards(ROTATED_OBJECT, T0 + DAY_MS);
    await driver.create('rot_event', { id: 'new', payload: 'p1', created_at: new Date(T0 + DAY_MS) }, { bypassTenantAudit: true });

    // Update a row living in the OLDER shard (not the write target).
    const updated = await driver.update('rot_event', 'old', { payload: 'patched' }, { bypassTenantAudit: true });
    expect(updated?.payload).toBe('patched');

    // Delete by id probes shards until the hit.
    expect(await driver.delete('rot_event', 'old', { bypassTenantAudit: true })).toBe(true);
    expect(await driver.delete('rot_event', 'old', { bypassTenantAudit: true })).toBe(false);

    // deleteMany with a temporal cutoff spans every live shard (the Reaper's
    // retention trim on a rotated object).
    await driver.create('rot_event', { id: 'old2', payload: 'p2', created_at: new Date(T0 - 10 * DAY_MS) }, { bypassTenantAudit: true });
    const deleted = await driver.deleteMany(
      'rot_event',
      { object: 'rot_event', where: { created_at: { $lt: new Date(T0).toISOString() } } },
      { bypassTenantAudit: true },
    );
    expect(deleted).toBe(1);
    const rest = await driver.find('rot_event', { object: 'rot_event' });
    expect(rest.map((r: any) => r.id)).toEqual(['new']);
  });

  it('rotateShards is idempotent within the same period', async () => {
    await driver.initObjects([ROTATED_OBJECT]);
    const first = await driver.rotateShards(ROTATED_OBJECT, T0);
    await driver.create('rot_event', { id: 'a', payload: 'x', created_at: new Date(T0) }, { bypassTenantAudit: true });
    const second = await driver.rotateShards(ROTATED_OBJECT, T0 + 3_600_000); // +1h, same day
    expect(second.current).toBe(first.current);
    expect(second.dropped).toEqual([]);
    expect(await driver.count('rot_event', { object: 'rot_event' })).toBe(1);
  });
});
