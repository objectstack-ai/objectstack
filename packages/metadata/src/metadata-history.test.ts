// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader, type MetadataHistoryAddress } from './loaders/database-loader.js';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysMetadataHistoryObject } from '@objectstack/metadata-core';
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
  const versions = async (type: string, options?: MetadataHistoryAddress) =>
    (await manager.getHistory(type, 'x', options)).records.map((record) => record.version);
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
        await manager.rollback(type, 'x', 1, { packageId: A });
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
        expect((await manager.diff(type, 'x', 1, 3, { packageId: A })).identical).toBe(false);
        await expect(manager.diff(type, 'x', 1, 2, { packageId: A })).rejects.toThrow(/Version 2 not found/);
        await expect(manager.rollback(type, 'x', 2, { packageId: A })).rejects.toThrow(/Version 2 not found/);
        // Paging counts the package's versions, not the name's.
        const page = await manager.getHistory(type, 'x', { packageId: A, limit: 1 });
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
        expect(await refusal(manager.rollback(type, 'x', 2, { packageId: B }))).toEqual({
          code: 'RESOURCE_CONFLICT',
          status: 409,
          reason: 'not-held-by-qualifier',
          callerPackageId: B,
          candidates: [{ kind: 'package', packageId: A }],
        });
        expect(await rowsOf(type)).toEqual(before);
      });

      it('a package-less customization saved into A\'s row is A\'s version, and its snapshot is byte-identical', async () => {
        await loader.save(type, 'x', body('A1', A));
        await loader.save(type, 'x', body('custom'));
        await loader.save(type, 'x', body('B1', B));
        expect(await versions(type, { packageId: A })).toEqual([2, 1]);
        expect((await loader.getHistoryRecord(type, 'x', 2, { packageId: A }))?.metadata).toEqual(body('custom'));
        await manager.rollback(type, 'x', 2, { packageId: A });
        expect(labelOf(await rowOf(type, A))).toBe('custom');
        expect(labelOf(await rowOf(type, B))).toBe('B1');
      });

      it('a history row written before the column (package_id NULL) reads as before; by package, the package its body names', async () => {
        // The table as the release before this one created it: no `package_id`.
        const { package_id: _added, ...before } = SysMetadataHistoryObject.fields as Record<string, unknown>;
        await driver.syncSchema('sys_metadata_history', { ...SysMetadataHistoryObject, fields: before } as never);
        const legacy = (version: number, data: Record<string, unknown>) => driver.create('sys_metadata_history', {
          id: `legacy_${version}`, event_seq: version, type, name: 'x', version, operation_type: 'update',
          metadata: JSON.stringify(data), checksum: `c${version}`, recorded_at: `2026-01-0${version}T00:00:00.000Z`,
          source: 'database-loader',
        });
        await legacy(1, body('A1', A));
        await legacy(2, body('custom'));
        await loader.save(type, 'x', body('A3', A));
        const rows = (await driver.find('sys_metadata_history', { where: { type } } as never)) as Array<Record<string, unknown>>;
        expect(rows.map((row) => [row.version, row.package_id ?? null])).toEqual([[1, null], [2, null], [3, A]]);
        expect((await manager.getHistory(type, 'x')).records.map((record) => [record.version, record.metadata])).toEqual([
          [3, body('A3', A)],
          [2, body('custom')],
          [1, body('A1', A)],
        ]);
        expect(await versions(type, { packageId: A })).toEqual([3, 1]);
        // An unattributed version lands in the one holder's row, as before.
        await manager.rollback(type, 'x', 2);
        expect((await rowsOf(type)).map((row) => [row.package_id, labelOf(row), row.version])).toEqual([[A, 'custom', 4]]);
      });

      it('F1: a legacy unattributed version of a name several row slots hold is in no addressed read, and a rollback to it is refused naming every holder', async () => {
        // The table as the release before this one created it: no `package_id`.
        const { package_id: _added, ...before } = SysMetadataHistoryObject.fields as Record<string, unknown>;
        await driver.syncSchema('sys_metadata_history', { ...SysMetadataHistoryObject, fields: before } as never);
        const legacy = (version: number, data: Record<string, unknown>) => driver.create('sys_metadata_history', {
          id: `legacy_${version}`, event_seq: version, type, name: 'x', version, operation_type: 'update',
          metadata: JSON.stringify(data), checksum: `c${version}`, recorded_at: `2026-01-0${version}T00:00:00.000Z`,
          source: 'database-loader',
        });
        await legacy(1, body('A1', A));
        await legacy(2, body('B1', B));
        await legacy(3, body('custom'));
        // A's row, B's row and the package-less row, saved after the column.
        await loader.save(type, 'x', body('A4', A));
        await loader.save(type, 'x', body('B5', B));
        await loader.save(type, 'x', body('env6'));
        const history = (await driver.find('sys_metadata_history', { where: { type } } as never)) as Array<Record<string, unknown>>;
        // NULL is "not attributed"; a snapshot of the package-less row carries the sentinel.
        expect(history.map((row) => [row.version, row.package_id ?? null]).sort((l, r) => Number(l[0]) - Number(r[0]))).toEqual([
          [1, null], [2, null], [3, null], [4, A], [5, B], [6, 'sys_metadata'],
        ]);
        expect(await versions(type, { packageId: A })).toEqual([4, 1]);
        expect(await versions(type, { packageId: B })).toEqual([5, 2]);
        for (const environment of [null, '', 'sys_metadata']) {
          expect(await versions(type, { packageId: environment })).toEqual([6]);
        }
        const rows = await rowsOf(type);
        const holders = [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'environment' }];
        for (const packageId of [A, B, null]) {
          expect(await loader.getHistoryRecord(type, 'x', 3, { packageId })).toBeNull();
          for (const attempt of [
            manager.rollback(type, 'x', 3, { packageId }),
            loader.registerRollback(type, 'x', body('custom'), 3, undefined, undefined, { packageId }),
          ]) {
            const refused = await refusal(attempt);
            expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409, reason: 'ambiguous-in-environment' });
            expect(refused?.candidates).toHaveLength(3);
            expect(refused?.candidates).toEqual(expect.arrayContaining(holders));
          }
        }
        expect((await refusal(manager.rollback(type, 'x', 3)))?.reason).toBe('ambiguous-in-environment');
        // Nothing was written: every row as it was.
        expect(await rowsOf(type)).toEqual(rows);
        // An attributed legacy version still restores into its own package's row.
        await manager.rollback(type, 'x', 1, { packageId: A });
        expect(labelOf(await rowOf(type, A))).toBe('A1');
        expect(labelOf(await rowOf(type, B))).toBe('B5');
      });

      it('M1/F2 CONTROL: one row slot: the environment\'s own version rolls back by name into the one row at both doors, as before', async () => {
        // A takes over the package-less row: the name has one row slot.
        await loader.save(type, 'x', body('env1'));
        await loader.save(type, 'x', body('A2', A));
        expect((await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)])).toEqual([[A, 'A2']]);
        await manager.rollback(type, 'x', 1);
        expect((await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row), row.version])).toEqual([[A, 'env1', 3]]);
        // The other road to one slot: the package-less row removed, then A's saved.
        await loader.delete(type, 'x');
        await loader.save(type, 'x', body('env4'));
        await loader.delete(type, 'x');
        await loader.save(type, 'x', body('A6', A));
        expect((await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)])).toEqual([[A, 'A6']]);
        await manager.rollback(type, 'x', 4);
        expect((await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)])).toEqual([[A, 'env4']]);
        // The loader's door answers the same: the environment's v1 lands in the one row.
        await loader.registerRollback(type, 'x', body('env1'), 1);
        expect((await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)])).toEqual([[A, 'env1']]);
      });

      it('an environment version is not written into a package\'s row', async () => {
        await twoHolders();
        await loader.save(type, 'x', body('env1'));
        const rows = await rowsOf(type);
        await expect(loader.registerRollback(type, 'x', body('env1'), 4, undefined, undefined, { packageId: A }))
          .rejects.toThrow(/^Version 4 of .*\/x is the environment's, not package "com\.acme\.alpha"'s: roll it back addressing the environment/);
        expect(await rowsOf(type)).toEqual(rows);
      });

      it('a package-less row beside two packages\' rows: the environment address (null, \'\' or the sentinel) reads and rolls back its versions only', async () => {
        await twoHolders();
        // A package-less save of a name two packages hold fills the bare slot (#32347 R1b's state).
        await loader.save(type, 'x', body('env1'));
        await loader.save(type, 'x', body('env2'));
        const slots = (await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)]);
        expect(slots).toHaveLength(3);
        expect(slots).toEqual(expect.arrayContaining([[A, 'A2'], [B, 'B1'], [null, 'env2']]));
        // The several-slots refusal (#32347 R1b) names the environment beside both packages, in the rows' order.
        const candidates = (await refusal(manager.getHistory(type, 'x')))?.candidates;
        expect(candidates).toHaveLength(3);
        expect(candidates).toEqual(expect.arrayContaining([
          { kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'environment' },
        ]));
        for (const environment of [null, '', 'sys_metadata']) {
          expect(await versions(type, { packageId: environment })).toEqual([5, 4]);
          expect((await loader.getHistoryRecord(type, 'x', 4, { packageId: environment }))?.metadata).toEqual(body('env1'));
          expect(await loader.getHistoryRecord(type, 'x', 1, { packageId: environment })).toBeNull();
        }
        expect((await manager.diff(type, 'x', 4, 5, { packageId: null })).identical).toBe(false);
        await expect(manager.rollback(type, 'x', 1, { packageId: null })).rejects.toThrow(/Version 1 not found in history for .* \(environment\)/);
        const packageRows = (await rowsOf(type)).filter((row) => row.package_id);
        await manager.rollback(type, 'x', 4, { packageId: '' });
        expect((await rowsOf(type)).filter((row) => !row.package_id).map(labelOf)).toEqual(['env1']);
        expect((await rowsOf(type)).filter((row) => row.package_id)).toEqual(packageRows);
        expect(await versions(type, { packageId: 'sys_metadata' })).toEqual([6, 5, 4]);
      });

      it('the environment address on a name with no package-less row is refused naming the packages', async () => {
        await twoHolders();
        expect(await refusal(loader.registerRollback(type, 'x', body('A1', A), 1, undefined, undefined, { packageId: null }))).toEqual({
          code: 'RESOURCE_CONFLICT',
          status: 409,
          reason: 'not-held-by-qualifier',
          callerPackageId: null,
          candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
        });
      });

      it('an environment rollback beside one package files the bare registry slot, not the package\'s (S4)', async () => {
        await twoHolders();
        await loader.save(type, 'x', body('env1'));
        await loader.save(type, 'x', body('env2'));
        await loader.delete(type, 'x', { packageId: B });
        // A's row plus the package-less row; the registry holds A's slot (A's rollback filed it).
        await manager.rollback(type, 'x', 1, { packageId: A });
        expect(await manager.get(type, 'x', A)).toEqual(body('A1', A));
        await manager.rollback(type, 'x', 4, { packageId: null });
        expect(await manager.get(type, 'x', A)).toEqual(body('A1', A));
        // The restored body sits in the bare (environment) registry slot, as its row does.
        const registry = (manager as unknown as { registry: Map<string, Map<string, unknown>> }).registry;
        expect(registry.get(type)?.get('x')).toEqual(body('env1'));
        expect((await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)])).toEqual(
          expect.arrayContaining([[A, 'A1'], [null, 'env1']]),
        );
      });

      it('a rollback naming a package when no row of the name is left answers "not found", not a refusal naming nobody', async () => {
        await twoHolders();
        await loader.delete(type, 'x', { packageId: A });
        await loader.delete(type, 'x', { packageId: B });
        const error = await manager.rollback(type, 'x', 1, { packageId: A }).then(() => undefined, (e: any) => e);
        expect(error?.message).toMatch(/not found for rollback/);
        expect(error?.status).toBeUndefined();
      });

      it('a direct rollback naming A with B\'s version while B holds a row says the version is B\'s, and writes nothing', async () => {
        await twoHolders();
        const before = await rowsOf(type);
        const error = await loader.registerRollback(type, 'x', body('B1', B), 2, undefined, undefined, { packageId: A })
          .then(() => undefined, (e: any) => e);
        expect(error?.message).toMatch(/^Version 2 of .*\/x is package "com\.acme\.beta"'s, not package "com\.acme\.alpha"'s/);
        expect(error?.refusal).toBeUndefined();
        expect(await rowsOf(type)).toEqual(before);
      });

      it('two holders and no package: a rollback or diff of a version that does not exist answers the 409, not "not found"', async () => {
        await twoHolders();
        expect((await refusal(manager.rollback(type, 'x', 42)))?.status).toBe(409);
        expect((await refusal(manager.diff(type, 'x', 1, 42)))?.status).toBe(409);
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
