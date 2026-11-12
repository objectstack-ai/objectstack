// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PACKAGE_SLOTTED_STORE_TYPES } from './package-slotted-store.js';

describe('Metadata History', () => {
  let manager: MetadataManager;
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    // A fresh in-memory SQLite database per test + the database loader.
    // `DatabaseLoader` provisions its own two tables via `driver.syncSchema`,
    // so it needs a CONNECTED driver — the mingo driver this used before #4065
    // needed no connect and created tables on first touch, so neither step was
    // visible here.
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();

    const dbLoader = new DatabaseLoader({
      driver,
      tableName: 'test_metadata',
      historyTableName: 'test_metadata_history',
      trackHistory: true,
    });

    manager = new MetadataManager({
      datasource: 'sqlite',
      loaders: [dbLoader],
    });
  });

  it('should create history record on metadata creation', async () => {
    // Register a new metadata item
    const objectDef = {
      name: 'test_object',
      label: 'Test Object',
      fields: {
        name: { type: 'text', label: 'Name' },
      },
    };

    await manager.register('object', 'test_object', objectDef);

    // Check that history was created
    const history = await manager.getHistory('object', 'test_object');

    expect(history.records.length).toBeGreaterThan(0);
    expect(history.records[0].operationType).toBe('create');
    expect(history.records[0].version).toBe(1);
  });

  it('should create history record on metadata update', async () => {
    // Register initial version
    const objectDef = {
      name: 'test_object',
      label: 'Test Object',
      fields: {
        name: { type: 'text', label: 'Name' },
      },
    };

    await manager.register('object', 'test_object', objectDef);

    // Update the metadata
    const updatedDef = {
      ...objectDef,
      label: 'Updated Test Object',
      fields: {
        name: { type: 'text', label: 'Name' },
        description: { type: 'text', label: 'Description' },
      },
    };

    await manager.register('object', 'test_object', updatedDef);

    // Check history
    const history = await manager.getHistory('object', 'test_object');

    expect(history.records.length).toBeGreaterThanOrEqual(2);
    expect(history.records[0].operationType).toBe('update');
    expect(history.records[0].version).toBe(2);
  });

  it('should rollback to previous version', async () => {
    // Register initial version
    const version1 = {
      name: 'test_object',
      label: 'Version 1',
      fields: {
        name: { type: 'text', label: 'Name' },
      },
    };

    await manager.register('object', 'test_object', version1);

    // Update to version 2
    const version2 = {
      ...version1,
      label: 'Version 2',
    };

    await manager.register('object', 'test_object', version2);

    // Rollback to version 1
    const restored = await manager.rollback('object', 'test_object', 1);

    expect(restored).toBeDefined();
    expect((restored as any).label).toBe('Version 1');

    // Verify current metadata is version 1
    const current = await manager.get('object', 'test_object');
    expect((current as any).label).toBe('Version 1');
  });

  it('should compare versions with diff', async () => {
    // Register version 1
    const version1 = {
      name: 'test_object',
      label: 'Version 1',
      description: 'Original description',
      fields: {
        name: { type: 'text', label: 'Name' },
      },
    };

    await manager.register('object', 'test_object', version1);

    // Update to version 2
    const version2 = {
      ...version1,
      label: 'Version 2',
      description: 'Updated description',
    };

    await manager.register('object', 'test_object', version2);

    // Compare versions
    const diffResult = await manager.diff('object', 'test_object', 1, 2);

    expect(diffResult.identical).toBe(false);
    expect(diffResult.patch!.length).toBeGreaterThan(0);
    expect(diffResult.summary).toContain('modified');
  });

  it('should handle history query with filters', async () => {
    // Create multiple versions
    for (let i = 1; i <= 5; i++) {
      await manager.register('object', 'test_object', {
        name: 'test_object',
        label: `Version ${i}`,
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Query with limit
    const limitedHistory = await manager.getHistory('object', 'test_object', {
      limit: 3,
    });

    expect(limitedHistory.records.length).toBeLessThanOrEqual(3);
    expect(limitedHistory.total).toBeGreaterThanOrEqual(5);

    // Query with operation type filter
    const createHistory = await manager.getHistory('object', 'test_object', {
      operationType: 'create',
    });

    expect(createHistory.records.every(r => r.operationType === 'create')).toBe(true);
  });

  it('should skip history record when checksum is unchanged', async () => {
    // Register metadata
    const objectDef = {
      name: 'test_object',
      label: 'Test Object',
    };

    await manager.register('object', 'test_object', objectDef);

    // Re-register with exact same content
    await manager.register('object', 'test_object', objectDef);

    const history = await manager.getHistory('object', 'test_object');

    // Should only have one history record (the create)
    // The second register should be skipped due to identical checksum
    expect(history.records.length).toBe(1);
  });

  it('should return empty history for non-existent metadata', async () => {
    const history = await manager.getHistory('object', 'nonexistent');

    expect(history.records).toEqual([]);
    expect(history.total).toBe(0);
    expect(history.hasMore).toBe(false);
  });

  it('should throw error when rolling back to non-existent version', async () => {
    await manager.register('object', 'test_object', {
      name: 'test_object',
      label: 'Test',
    });

    await expect(
      manager.rollback('object', 'test_object', 999)
    ).rejects.toThrow();
  });
});

/**
 * [ADR-0150 D3/D4, #32351] A type stored per `(package, name)` keeps a row per
 * package of a name, and its versions are numbered per name across them. Its
 * history rows carry the package of the row they snapshot, so history, diff
 * and rollback address one package's versions: a rollback writes the named
 * package's row and never another's, a version lands only in its own
 * package's row (S8a: a departed package's version is refused, not written
 * into the remaining holder's row), and a name two row slots hold is refused
 * 409 when no package is named. One holder and every other type answer as
 * before (CONTROL).
 *
 * BEFORE (origin/main 35929be7, every type): the package is not read; with two
 * holders `getHistory` / `diff` answered both packages' versions and a rollback
 * by package was impossible (409 by name); after B's removal a rollback to B's
 * version wrote B's body into A's row.
 */
describe('history and rollback of a type stored per package (#32351)', () => {
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  let driver: SqliteWasmDriver;
  let loader: DatabaseLoader;
  let manager: MetadataManager;

  const body = (label: string, packageId?: string) =>
    ({ name: 'x', label, locale: 'en-US', ...(packageId ? { _packageId: packageId } : {}) });
  const rowsOf = async (type: string) =>
    ((await driver.find('sys_metadata', { where: { type } } as never)) as Array<Record<string, unknown>>)
      .map((row) => ({ ...row }))
      .sort((l, r) => String(l.id).localeCompare(String(r.id)));
  const rowOf = async (type: string, packageId: string) =>
    (await rowsOf(type)).find((row) => row.package_id === packageId);
  const labelOf = (row: Record<string, unknown> | undefined) => JSON.parse(String(row?.metadata)).label;
  const versions = async (type: string, options?: { packageId?: string }) =>
    (await manager.getHistory(type, 'x', options as never)).records.map((record) => record.version);
  const refusal = (promise: Promise<unknown>) =>
    promise.then(() => undefined, (error: any) => ({
      code: error?.code,
      status: error?.status,
      reason: error?.refusal?.reason,
      callerPackageId: error?.refusal?.callerPackageId,
      candidates: error?.refusal?.candidates,
    }));

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    loader = new DatabaseLoader({ driver, cache: { enabled: false } });
    manager = new MetadataManager({ datasource: 'sqlite', loaders: [loader] });
  });

  for (const type of PACKAGE_SLOTTED_STORE_TYPES) {
    describe(type, () => {
      // A v1, B v2, A v3: two holders of `x`.
      const twoHolders = async () => {
        await loader.save(type, 'x', body('A1', A));
        await loader.save(type, 'x', body('B1', B));
        await loader.save(type, 'x', body('A2', A));
      };

      it('two holders: a rollback naming A to its v1 writes A\'s row only, and B\'s row is byte-identical', async () => {
        await twoHolders();
        const before = await rowOf(type, B);
        await manager.rollback(type, 'x', 1, { packageId: A } as never);
        expect(labelOf(await rowOf(type, A))).toBe('A1');
        expect(await rowOf(type, B)).toEqual(before);
        expect(await versions(type, { packageId: A })).toEqual([4, 3, 1]);
        expect(await versions(type, { packageId: B })).toEqual([2]);
      });

      it('two holders and no package: getHistory, diff and rollback answer 409 naming both, and nothing is written', async () => {
        await twoHolders();
        const before = await rowsOf(type);
        const both = {
          code: 'RESOURCE_CONFLICT',
          status: 409,
          reason: 'ambiguous-in-environment',
          callerPackageId: null,
          candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
        };
        expect(await refusal(manager.getHistory(type, 'x'))).toEqual(both);
        expect(await refusal(manager.diff(type, 'x', 1, 3))).toEqual(both);
        expect(await refusal(manager.rollback(type, 'x', 1))).toEqual(both);
        expect(await rowsOf(type)).toEqual(before);
      });

      it('a package\'s history, version and diff are its own versions only', async () => {
        await twoHolders();
        expect(await versions(type, { packageId: A })).toEqual([3, 1]);
        expect(await versions(type, { packageId: B })).toEqual([2]);
        expect((await loader.getHistoryRecord(type, 'x', 1, { packageId: A }))?.metadata).toEqual(body('A1', A));
        expect(await loader.getHistoryRecord(type, 'x', 2, { packageId: A })).toBeNull();
        expect((await manager.diff(type, 'x', 1, 3, { packageId: A } as never)).identical).toBe(false);
        await expect(manager.diff(type, 'x', 1, 2, { packageId: A } as never)).rejects.toThrow(/Version 2 not found/);
        await expect(manager.rollback(type, 'x', 2, { packageId: A } as never)).rejects.toThrow(/Version 2 not found/);
        // Paging counts the package's versions, not the name's.
        const page = await manager.getHistory(type, 'x', { packageId: A, limit: 1 } as never);
        expect([page.records.map((record) => record.version), page.total, page.hasMore]).toEqual([[3], 2, true]);
      });

      it('S8a: after B is removed, a rollback to B\'s version is refused 409 and A\'s row is unchanged', async () => {
        await twoHolders();
        await loader.delete(type, 'x', { packageId: B });
        const before = await rowsOf(type);
        expect(await refusal(manager.rollback(type, 'x', 2))).toEqual({
          code: 'RESOURCE_CONFLICT',
          status: 409,
          reason: 'not-held-by-qualifier',
          callerPackageId: B,
          candidates: [{ kind: 'package', packageId: A }],
        });
        expect(await rowsOf(type)).toEqual(before);
        // A rollback naming a package that holds no row is refused the same way.
        expect((await refusal(manager.rollback(type, 'x', 2, { packageId: B } as never)))?.reason).toBe('not-held-by-qualifier');
      });

      it('a package-less customization saved into A\'s row is A\'s version, and its snapshot is byte-identical', async () => {
        await loader.save(type, 'x', body('A1', A));
        await loader.save(type, 'x', body('custom'));
        await loader.save(type, 'x', body('B1', B));
        expect(await versions(type, { packageId: A })).toEqual([2, 1]);
        expect((await loader.getHistoryRecord(type, 'x', 2, { packageId: A }))?.metadata).toEqual(body('custom'));
        await manager.rollback(type, 'x', 2, { packageId: A } as never);
        expect(labelOf(await rowOf(type, A))).toBe('custom');
        expect(labelOf(await rowOf(type, B))).toBe('B1');
      });

      it('CONTROL: one holder and no package answer as before', async () => {
        await loader.save(type, 'x', body('A1', A));
        await loader.save(type, 'x', body('custom'));
        const history = await manager.getHistory(type, 'x');
        expect(history.records.map((record) => [record.version, record.operationType, record.metadata])).toEqual([
          [2, 'update', body('custom')],
          [1, 'create', body('A1', A)],
        ]);
        await manager.rollback(type, 'x', 1);
        expect((await rowsOf(type)).map((row) => [row.package_id, labelOf(row), row.version])).toEqual([[A, 'A1', 3]]);
      });
    });
  }

  it('CONTROL: a type stored per name keeps one row per name, and its history, diff and rollback ignore packages', async () => {
    await loader.save('object', 'x', body('A1', A));
    await loader.save('object', 'x', body('B1', B));
    expect(await versions('object')).toEqual([2, 1]);
    expect(await versions('object', { packageId: A })).toEqual([2, 1]);
    expect((await manager.diff('object', 'x', 1, 2)).identical).toBe(false);
    await manager.rollback('object', 'x', 1);
    expect((await rowsOf('object')).map((row) => [labelOf(row), row.version])).toEqual([['A1', 3]]);
  });
});
