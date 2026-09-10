// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16729] The shard path resolves its tenant column through the STICKY
 * opt-out record, so a rotation-declared platform-global object scopes its
 * declared `unique: 'organization'` index identically on the base table and on
 * every shard.
 *
 * ## The gap
 *
 * `tenantOptOutByTable` (#3249) keeps an explicit `tenancy.enabled: false`
 * declaration from being lost to a later partial re-registration, and
 * `computeAndRecordTenantField` is the resolver that consults it. The shard
 * leaf called the BARE `computeTenantField` instead — the one that reads this
 * call's schema and nothing else — so a `rotateShards` sweep carrying no
 * `tenancy` block fell through to the implicit `organization_id` heuristic and
 * gave the shard an organization key part the base table's own index does not
 * have. One object, two partitions, decided by which physical table a row
 * happened to land in.
 *
 * The sweep-time entry point is exactly where that shape appears: the
 * LifecycleService calls `rotateShards` on every sweep with whatever object it
 * holds, long after `initObjects` recorded the declaration.
 *
 * ## What is asserted
 *
 * The tenant column handed to `syncDeclaredIndexes` — the value that decides
 * the partition — captured per table. Both directions: the opted-out object
 * must resolve `null` on base AND shard, and a genuinely org-scoped object must
 * still resolve `organization_id` on both. An implementation that answered
 * `null` everywhere would satisfy the first pair and quietly unscope the
 * second.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

const T0 = Date.parse('2036-08-01T12:00:00.000Z');

/** Captures the tenant column each `syncDeclaredIndexes` call was given. */
class RecordingDriver extends SqlDriver {
  readonly resolved: Array<{ table: string; tenantField: string | null | undefined }> = [];

  protected override async syncDeclaredIndexes(
    tableName: string,
    indexes: any,
    physicalColumns: any,
    tenantField?: string | null,
  ): Promise<any> {
    this.resolved.push({ table: tableName, tenantField });
    return super.syncDeclaredIndexes(tableName, indexes, physicalColumns, tenantField);
  }
}

const ROTATION = { strategy: 'rotation' as const, shards: 3, unit: 'day' as const };

const FIELDS = {
  key: { type: 'text' },
  organization_id: { type: 'text' },
  created_at: { type: 'datetime' },
};
const INDEXES = [{ name: 'by_key', fields: ['key'], unique: 'organization' }];

/** Platform-global AND rotation-declared. */
const GLOBAL_FULL = {
  name: 'rot_license',
  fields: FIELDS,
  indexes: INDEXES,
  tenancy: { enabled: false },
  lifecycle: { class: 'telemetry', storage: ROTATION },
};
/** The same object as a sweep hands it back — no `tenancy` block. */
const GLOBAL_PARTIAL = {
  name: 'rot_license',
  fields: FIELDS,
  indexes: INDEXES,
  lifecycle: { class: 'telemetry', storage: ROTATION },
};
/** The control: genuinely org-scoped, same shape otherwise. */
const SCOPED_PARTIAL = { ...GLOBAL_PARTIAL, name: 'rot_event' };

/** The same declaration on the MANAGED-table path — no rotation policy. */
const MAIN_FULL = { name: 'lic_main', fields: FIELDS, indexes: INDEXES, tenancy: { enabled: false } };
const MAIN_PARTIAL = { name: 'lic_main', fields: FIELDS, indexes: INDEXES };

describe('[#16729] shard path honours the sticky tenancy opt-out', () => {
  let driver: RecordingDriver;

  beforeEach(() => {
    driver = new RecordingDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('resolves null on base AND shard for a declared platform-global object', async () => {
    await driver.initObjects([GLOBAL_FULL as any]);
    driver.resolved.length = 0;

    // The sweep-time call, carrying no `tenancy` block.
    const rotated = await driver.rotateShards(GLOBAL_PARTIAL as any, T0);
    expect(rotated.shards.length).toBeGreaterThan(0);

    const shardReadings = driver.resolved.filter((r) => r.table !== 'rot_license');
    expect(shardReadings.length).toBeGreaterThan(0);
    for (const reading of shardReadings) {
      expect(reading.tenantField ?? null).toBeNull();
    }
  });

  it('agrees with the MAIN-TABLE path for the same declaration', async () => {
    // A rotation object's base NAME becomes the read view, so its managed-table
    // reading has to come from a non-rotation twin of the same declaration —
    // same fields, same declared index, same explicit opt-out.
    const main = new RecordingDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      await main.initObjects([MAIN_FULL as any]);
      main.resolved.length = 0;
      await main.initObjects([MAIN_PARTIAL as any]);
      const mainReadings = main.resolved.filter((r) => r.table === 'lic_main');
      expect(mainReadings.length).toBeGreaterThan(0);

      await driver.initObjects([GLOBAL_FULL as any]);
      driver.resolved.length = 0;
      await driver.rotateShards(GLOBAL_PARTIAL as any, T0);
      const shardReadings = driver.resolved.filter((r) => r.table !== 'rot_license');
      expect(shardReadings.length).toBeGreaterThan(0);

      // ⚠️ The point of the card: one declaration, ONE partition, whichever
      // physical table the row lands in.
      const partitions = new Set(
        [...mainReadings, ...shardReadings].map((r) => r.tenantField ?? null),
      );
      expect([...partitions]).toEqual([null]);
    } finally {
      await main.disconnect();
    }
  });

  it('leaves a genuinely org-scoped object scoped on its shards', async () => {
    await driver.initObjects([SCOPED_PARTIAL as any]);
    driver.resolved.length = 0;

    await driver.rotateShards(SCOPED_PARTIAL as any, T0);
    const shardReadings = driver.resolved.filter((r) => r.table !== 'rot_event');
    expect(shardReadings.length).toBeGreaterThan(0);
    for (const reading of shardReadings) {
      expect(reading.tenantField).toBe('organization_id');
    }
  });
});
