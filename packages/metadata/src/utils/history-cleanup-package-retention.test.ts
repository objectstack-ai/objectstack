// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `HistoryCleanupManager`'s `maxVersions` retention of a type stored per
 * `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`, ADR-0150 D3/D4) keeps the
 * latest N versions per `(type, name, package_id)`.
 *
 * Two packages (and the environment) each keep their own row of one name of
 * such a type, and `DatabaseLoader` numbers their snapshots in ONE
 * `(type, name, version)` sequence, recording whose row each one is in
 * `sys_metadata_history.package_id`. Retention counted per `(type, name)`, so
 * package A's saves evicted package B's versions: B lost its rollback targets
 * because A was saved often.
 *
 * Buckets: each package; the environment's `sys_metadata` marker; and NULL —
 * a row attributed to nobody (written before the column existed) — its own
 * bucket, never folded into a package's.
 *
 * CONTROL: a type outside the set keeps the latest N per `(type, name)`
 * whatever its `package_id` column holds, and a one-holder name keeps exactly
 * the latest N, as before. The `executionPinned` types (ADR-0009) stay exempt.
 *
 * Every pin runs on the real save path (`DatabaseLoader.save` over SQLite),
 * and each fixture asserts its own `(version, package_id)` table first, so a
 * green run cannot come from a fixture that never had two holders.
 *
 * BEFORE (origin/main d4fbb4db): the A-and-B case deleted both of B's
 * versions and `getCleanupStats()` counted 4 past the limit, not 2; the
 * three-bucket case kept only A's latest two.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { DatabaseLoader } from '../loaders/database-loader.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from '../package-slotted-store.js';
import { HistoryCleanupManager } from './history-cleanup.js';

const HISTORY = 'sys_metadata_history';
const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const MAX_VERSIONS = 2;

const PINNED: ReadonlySet<string> = new Set(DEFAULT_METADATA_TYPE_REGISTRY.filter((entry) => entry.executionPinned).map((entry) => entry.type));
const RETAINED_SLOTTED = [...PACKAGE_SLOTTED_STORE_TYPES].filter((type) => !PINNED.has(type));
const PINNED_SLOTTED = [...PACKAGE_SLOTTED_STORE_TYPES].filter((type) => PINNED.has(type));

describe('history retention of a type stored per package keeps the latest N per (type, name, package_id)', () => {
  let driver: SqliteWasmDriver;
  let loader: DatabaseLoader;
  let manager: HistoryCleanupManager;

  const body = (label: string, packageId?: string) =>
    ({ name: 'x', label, locale: 'en-US', ...(packageId ? { _packageId: packageId } : {}) });
  /** `[version, package_id]` of every history row of `(type, x)`, oldest first. */
  const historyOf = async (type: string) =>
    ((await driver.find(HISTORY, { where: { type, name: 'x' } } as never)) as Array<Record<string, unknown>>)
      .map((row) => [Number(row.version), (row.package_id as string | null | undefined) ?? null] as const)
      .sort((l, r) => l[0] - r[0]);
  const saveTimes = async (type: string, times: number, packageId?: string) => {
    for (let i = 1; i <= times; i++) await loader.save(type, 'x', body(`${packageId ?? 'env'}${i}`, packageId));
  };
  /** A row written before `package_id` existed: attributed to nobody (NULL). */
  const legacy = (type: string, version: number) => driver.create(HISTORY, {
    id: `legacy_${type}_${version}`, event_seq: 1000 + version, type, name: 'x', version, operation_type: 'update',
    metadata: JSON.stringify(body(`legacy${version}`)), checksum: `c${version}`,
    recorded_at: '2026-01-01T00:00:00.000Z', source: 'database-loader',
  });

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    loader = new DatabaseLoader({ driver, cache: { enabled: false } });
    manager = new HistoryCleanupManager({ maxVersions: MAX_VERSIONS }, loader);
  });

  it('the set holds a type retention applies to, so the pins below are not vacuous', () => {
    expect(RETAINED_SLOTTED.length).toBeGreaterThan(0);
  });

  for (const type of RETAINED_SLOTTED) {
    describe(type, () => {
      it(`A saved ${MAX_VERSIONS}+2 times after B saved twice: B keeps both versions, A its latest ${MAX_VERSIONS}`, async () => {
        await saveTimes(type, 2, B);
        await saveTimes(type, MAX_VERSIONS + 2, A);
        expect(await historyOf(type)).toEqual([[1, B], [2, B], [3, A], [4, A], [5, A], [6, A]]);

        expect(await manager.getCleanupStats()).toMatchObject({ recordsByCount: 2 });
        expect(await manager.runCleanup()).toEqual({ deleted: 2, errors: 0 });
        expect(await historyOf(type)).toEqual([[1, B], [2, B], [5, A], [6, A]]);
      });

      it('the environment marker and unattributed (NULL) rows are each their own bucket', async () => {
        await saveTimes(type, 3);
        for (const version of [4, 5, 6]) await legacy(type, version);
        await saveTimes(type, 3, A);
        expect(await historyOf(type)).toEqual([
          [1, 'sys_metadata'], [2, 'sys_metadata'], [3, 'sys_metadata'],
          [4, null], [5, null], [6, null],
          [7, A], [8, A], [9, A],
        ]);

        expect(await manager.getCleanupStats()).toMatchObject({ recordsByCount: 3 });
        expect(await manager.runCleanup()).toEqual({ deleted: 3, errors: 0 });
        expect(await historyOf(type)).toEqual([
          [2, 'sys_metadata'], [3, 'sys_metadata'], [5, null], [6, null], [8, A], [9, A],
        ]);
      });

      it(`CONTROL: a one-holder name keeps exactly its latest ${MAX_VERSIONS}`, async () => {
        await saveTimes(type, MAX_VERSIONS + 2, A);
        expect(await historyOf(type)).toEqual([[1, A], [2, A], [3, A], [4, A]]);

        expect(await manager.getCleanupStats()).toMatchObject({ recordsByCount: 2 });
        expect(await manager.runCleanup()).toEqual({ deleted: 2, errors: 0 });
        expect(await historyOf(type)).toEqual([[3, A], [4, A]]);
      });
    });
  }

  for (const type of PINNED_SLOTTED) {
    it(`CONTROL ${type}: executionPinned stays exempt — A and B keep every version`, async () => {
      await saveTimes(type, 2, B);
      await saveTimes(type, MAX_VERSIONS + 2, A);
      const before = await historyOf(type);
      expect(before).toEqual([[1, B], [2, B], [3, A], [4, A], [5, A], [6, A]]);

      expect(await manager.getCleanupStats()).toMatchObject({ recordsByCount: 0 });
      expect(await manager.runCleanup()).toEqual({ deleted: 0, errors: 0 });
      expect(await historyOf(type)).toEqual(before);
    });
  }

  it(`CONTROL: a type outside the set keeps its latest ${MAX_VERSIONS} per (type, name), whatever package_id holds`, async () => {
    const type = 'view';
    expect(PACKAGE_SLOTTED_STORE_TYPES.has(type) || PINNED.has(type)).toBe(false);
    await saveTimes(type, 2);
    // Planted: a non-slotted type's rows never carry a package, so this column
    // can only prove that retention does not read it for such a type.
    for (const version of [1, 2]) {
      const [row] = (await driver.find(HISTORY, { where: { type, version } } as never)) as Array<{ id: string }>;
      await driver.update(HISTORY, row.id, { package_id: B });
    }
    await saveTimes(type, 2);
    expect(await historyOf(type)).toEqual([[1, B], [2, B], [3, null], [4, null]]);

    expect(await manager.getCleanupStats()).toMatchObject({ recordsByCount: 2 });
    expect(await manager.runCleanup()).toEqual({ deleted: 2, errors: 0 });
    expect(await historyOf(type)).toEqual([[3, null], [4, null]]);
  });
});
