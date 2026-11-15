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
        // [#32717] A's slot is the name's one row slot, so its addressed history
        // lists the unattributed v2 too: a rollback addressing A restores it.
        expect(await versions(type, { packageId: A })).toEqual([3, 2, 1]);
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

      // [#32717, seat ruling 6885958183 (amended B)] One answer per rollback
      // door: `MetadataManager.rollback`, `DatabaseLoader.registerRollback` and
      // `/meta` (`SysMetadataRepository.restoreVersion`'s `isVersionOf`). On a
      // name one row slot holds, a version attributed to none and the
      // environment's own version are that slot's (ADR-0150 D4: a package-less
      // row at a held name is its one holder's customization), so they land,
      // addressed or not, and an addressed history read lists exactly what an
      // addressed rollback restores. On a name several row slots hold such a
      // version is refused 409 naming every holder. A history row that exists
      // says whose version it is, and the body the slot stores is stamped for
      // that slot's owner, never for the package the restored body names.
      const legacyHistory = async () => {
        // The table as the release before #32351 created it: no `package_id`.
        const { package_id: _added, ...before } = SysMetadataHistoryObject.fields as Record<string, unknown>;
        await driver.syncSchema('sys_metadata_history', { ...SysMetadataHistoryObject, fields: before } as never);
        return (version: number, data: Record<string, unknown>) => driver.create('sys_metadata_history', {
          id: `legacy_${version}`, event_seq: version, type, name: 'x', version, operation_type: 'update',
          metadata: JSON.stringify(data), checksum: `c${version}`, recorded_at: `2026-01-0${version}T00:00:00.000Z`,
          source: 'database-loader',
        });
      };
      const slotsOf = async () => (await rowsOf(type)).map((row) => [row.package_id ?? null, labelOf(row)]);
      const storedStampOf = (row: Record<string, unknown> | undefined) => JSON.parse(String(row?.metadata))._packageId;

      for (const holder of [A, null]) {
        const save = (label: string) => loader.save(type, 'x', holder === null ? body(label) : body(label, holder));
        it(`one row slot (${holder ?? 'the environment'}): a version attributed to none is in the slot's addressed history and rolls back into the slot at both doors, addressed or not`, async () => {
          const legacy = await legacyHistory();
          await legacy(1, body('custom'));
          await save('own2');
          expect((await rowsOf(type)).map((row) => row.package_id ?? null)).toEqual([holder]);
          // The addressed history lists it, as the bare one does.
          expect(await versions(type, { packageId: holder })).toEqual([2, 1]);
          expect(await versions(type)).toEqual([2, 1]);
          expect((await loader.getHistoryRecord(type, 'x', 1, { packageId: holder }))?.metadata).toEqual(body('custom'));
          expect((await manager.diff(type, 'x', 1, 2, { packageId: holder })).identical).toBe(false);
          // The manager's door, addressed.
          await manager.rollback(type, 'x', 1, { packageId: holder });
          expect(await slotsOf()).toEqual([[holder, 'custom']]);
          // The loader's door, addressed.
          await save('own4');
          await loader.registerRollback(type, 'x', body('custom'), 1, undefined, undefined, { packageId: holder });
          expect(await slotsOf()).toEqual([[holder, 'custom']]);
          // CONTROL: naming no package, both doors land it in the one row, as before.
          await save('own6');
          await manager.rollback(type, 'x', 1);
          expect(await slotsOf()).toEqual([[holder, 'custom']]);
          await save('own8');
          await loader.registerRollback(type, 'x', body('custom'), 1);
          expect(await slotsOf()).toEqual([[holder, 'custom']]);
        });
      }

      it('M1: one row slot a package took over: the environment\'s version is in that package\'s addressed history and rolls back addressing it at both doors', async () => {
        await loader.save(type, 'x', body('env1'));
        await loader.save(type, 'x', body('A2', A));
        expect(await slotsOf()).toEqual([[A, 'A2']]);
        expect(await versions(type, { packageId: A })).toEqual([2, 1]);
        expect((await loader.getHistoryRecord(type, 'x', 1, { packageId: A }))?.metadata).toEqual(body('env1'));
        await manager.rollback(type, 'x', 1, { packageId: A });
        expect(await slotsOf()).toEqual([[A, 'env1']]);
        await loader.save(type, 'x', body('A4', A));
        await loader.registerRollback(type, 'x', body('env1'), 1, undefined, undefined, { packageId: A });
        expect(await slotsOf()).toEqual([[A, 'env1']]);
        // The environment holds no row of the name: addressing it is refused, as before.
        expect((await refusal(manager.rollback(type, 'x', 1, { packageId: null })))?.reason).toBe('not-held-by-qualifier');
      });

      it('two row slots: a version attributed to none is in no addressed history and is refused naming both holders at both doors, whatever package the restored body is stamped with — never landed in that package\'s row', async () => {
        const legacy = await legacyHistory();
        await legacy(1, body('custom'));
        await loader.save(type, 'x', body('A2', A));
        await loader.save(type, 'x', body('B3', B));
        const rows = await rowsOf(type);
        const both = {
          code: 'RESOURCE_CONFLICT',
          status: 409,
          reason: 'ambiguous-in-environment',
          callerPackageId: null,
          candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
        };
        for (const packageId of [A, B]) {
          expect(await loader.getHistoryRecord(type, 'x', 1, { packageId })).toBeNull();
          expect(await refusal(manager.rollback(type, 'x', 1, { packageId }))).toEqual(both);
          expect(await refusal(loader.registerRollback(type, 'x', body('custom', B), 1, undefined, undefined, { packageId }))).toEqual(both);
        }
        expect(await rowsOf(type)).toEqual(rows);
      });

      it('one row slot, the environment\'s: a version restored with a body stamped for a package that holds no row is written unstamped, and the row stays the environment\'s', async () => {
        const legacy = await legacyHistory();
        await legacy(1, body('custom'));
        await loader.save(type, 'x', body('env2'));
        await loader.save(type, 'x', body('env3'));
        // An unattributed version (1) and the environment's own (2), restored naming no package or addressing the environment.
        for (const version of [1, 2]) {
          for (const options of [undefined, { packageId: null }]) {
            await loader.registerRollback(type, 'x', body(`v${version}`, B), version, undefined, undefined, options);
            const rows = await rowsOf(type);
            expect(rows.map((row) => [row.package_id ?? null, labelOf(row)])).toEqual([[null, `v${version}`]]);
            expect(storedStampOf(rows[0])).toBeUndefined();
            expect(((await loader.load(type, 'x')).data as Record<string, unknown> | undefined)?._packageId).toBeUndefined();
            // Still the environment's slot: B holds no row of the name, and the environment's address reads its newest version.
            expect(await refusal(loader.registerRollback(type, 'x', body('env3'), 3, undefined, undefined, { packageId: B }))).toMatchObject({
              status: 409, reason: 'not-held-by-qualifier', callerPackageId: B, candidates: [{ kind: 'environment' }],
            });
            expect((await versions(type, { packageId: null }))[0]).toBe(Number(rows[0]!.version));
          }
        }
      });

      it('one row slot, A\'s: a version restored with a body stamped for B is written stamped A, and served as A\'s', async () => {
        const legacy = await legacyHistory();
        await legacy(1, body('custom'));
        await loader.save(type, 'x', body('A2', A));
        // An unattributed version (1) and A's own (2), restored naming no package or addressing A.
        for (const version of [1, 2]) {
          for (const options of [undefined, { packageId: A }]) {
            await loader.registerRollback(type, 'x', body(`v${version}`, B), version, undefined, undefined, options);
            const rows = await rowsOf(type);
            expect(rows.map((row) => [row.package_id ?? null, labelOf(row)])).toEqual([[A, `v${version}`]]);
            expect(storedStampOf(rows[0])).toBe(A);
            expect(((await loader.load(type, 'x')).data as Record<string, unknown> | undefined)?._packageId).toBe(A);
            // Its history snapshot is the body written.
            const snapshot = await loader.getHistoryRecord(type, 'x', Number(rows[0]!.version), { packageId: A });
            expect((snapshot?.metadata as Record<string, unknown> | undefined)?._packageId).toBe(A);
          }
        }
      });

      it('N1: two row slots: A\'s version restored into A\'s row with a body stamped for B is written stamped A, and B\'s row is byte-identical', async () => {
        await twoHolders();
        const before = await rowOf(type, B);
        await loader.registerRollback(type, 'x', body('A1', B), 1, undefined, undefined, { packageId: A });
        expect(labelOf(await rowOf(type, A))).toBe('A1');
        expect(storedStampOf(await rowOf(type, A))).toBe(A);
        expect(await rowOf(type, B)).toEqual(before);
      });

      it('N1 at the manager\'s door: a recorded A version whose snapshot is stamped for B lands in A\'s row stamped A, and the registry files it as A\'s', async () => {
        await driver.syncSchema('sys_metadata_history', SysMetadataHistoryObject as never);
        // A snapshot recorded of A's row with B's stamp (a direct rollback before #32717 wrote one).
        await driver.create('sys_metadata_history', {
          id: 'residue_1', event_seq: 1, type, name: 'x', version: 1, operation_type: 'revert', package_id: A,
          metadata: JSON.stringify(body('A1', B)), checksum: 'c1', recorded_at: '2026-01-01T00:00:00.000Z', source: 'database-loader',
        });
        await loader.save(type, 'x', body('A2', A));
        for (const options of [undefined, { packageId: A }]) {
          await loader.save(type, 'x', body('A9', A));
          expect(await manager.rollback(type, 'x', 1, options)).toEqual(body('A1', A));
          expect(await slotsOf()).toEqual([[A, 'A1']]);
          expect(storedStampOf(await rowOf(type, A))).toBe(A);
          expect(await manager.get(type, 'x', A)).toEqual(body('A1', A));
          expect(await manager.get(type, 'x', B)).toBeUndefined();
        }
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

  it('[#32517] an environment rollback of a non-canonical locale files that locale\'s own registry key, never the canonical member\'s', async () => {
    const type = 'email_template';
    const fr = (label: string, packageId?: string) => ({ ...body(label, packageId), locale: 'fr-FR' });
    await loader.save(type, 'x', body('A1', A));
    await loader.save(type, 'x', body('B1', B));
    await loader.save(type, 'x', body('A2', A));
    // The environment's fr-FR, beside two packages: its own (package-less) row.
    await loader.save(type, 'x', fr('env-fr1'));
    await loader.save(type, 'x', fr('env-fr2'));
    await loader.delete(type, 'x', { packageId: B });
    await manager.rollback(type, 'x', 3, { packageId: A });
    await manager.rollback(type, 'x', 4, { packageId: null });
    const registry = (manager as unknown as { registry: Map<string, Map<string, unknown>> }).registry.get(type)!;
    // The environment's slot keeps its fr-FR under the member's key; its canonical key holds nothing.
    expect(registry.get('x\u0002fr-FR')).toEqual(fr('env-fr1'));
    expect(registry.has('x')).toBe(false);
    expect(await manager.get(type, 'x', A)).toEqual(body('A2', A));
  });

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

/**
 * [#31699 PR 2, ADR-0150 D3/D4] `webhook` joins `PACKAGE_SLOTTED_STORE_TYPES`
 * in this change, so #32351's history above reaches a declared webhook. Named
 * here rather than derived from the set, so taking the webhook out of the set
 * turns these red instead of dropping them.
 *
 * BASE (measured on this branch with `webhook` taken out of the set, same
 * fixture): a webhook's `sys_metadata` row and its history rows carried no
 * package; a second package's save wrote the one row of the name, whose
 * history answered every version by name, with or without a package; after
 * B's removal, a rollback to B's version wrote B's body into that row.
 */
describe('[#31699 PR 2] a declared webhook\'s history is per package (#32351)', () => {
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  let driver: SqliteWasmDriver;
  let loader: DatabaseLoader;
  let manager: MetadataManager;

  const hook = (label: string, packageId: string) =>
    ({ name: 'x', label, object: 'task', url: 'https://hooks.example/x', _packageId: packageId });
  const packagesOf = async (table: string) =>
    ((await driver.find(table, { where: { type: 'webhook' } } as never)) as Array<Record<string, unknown>>)
      .map((row) => [row.version, row.package_id ?? null, JSON.parse(String(row.metadata)).label])
      .sort((l, r) => Number(l[0]) - Number(r[0]));
  const refusal = (promise: Promise<unknown>) =>
    promise.then(() => undefined, (error: any) => [error?.status, error?.refusal?.reason, error?.refusal?.candidates]);
  const twoHolders = async () => {
    await loader.save('webhook', 'x', hook('A1', A));
    await loader.save('webhook', 'x', hook('B1', B));
    await loader.save('webhook', 'x', hook('A2', A));
  };

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    loader = new DatabaseLoader({ driver, cache: { enabled: false } });
    manager = new MetadataManager({ datasource: 'sqlite', loaders: [loader] });
  });

  it('the premise: `webhook` is stored per package', () => {
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('webhook')).toBe(true);
  });

  it('[FROM no package TO the package] one holder: its row and each history row name its package; the history by name answers as before', async () => {
    await loader.save('webhook', 'x', hook('A1', A));
    await loader.save('webhook', 'x', hook('A2', A));
    expect(await packagesOf('sys_metadata')).toEqual([[2, A, 'A2']]);
    expect(await packagesOf('sys_metadata_history')).toEqual([[1, A, 'A1'], [2, A, 'A2']]);
    expect((await manager.getHistory('webhook', 'x')).records.map((record) => record.version)).toEqual([2, 1]);
  });

  it('[FROM one row, every version TO a row each, 409] two holders: a row per package; naming none refuses naming both and writes nothing; naming A reads and rolls back A\'s own', async () => {
    await twoHolders();
    expect(await packagesOf('sys_metadata')).toEqual([[2, B, 'B1'], [3, A, 'A2']]);
    const both = [409, 'ambiguous-in-environment', [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]];
    expect(await refusal(manager.getHistory('webhook', 'x'))).toEqual(both);
    expect(await refusal(manager.rollback('webhook', 'x', 1))).toEqual(both);
    expect(await packagesOf('sys_metadata')).toEqual([[2, B, 'B1'], [3, A, 'A2']]);
    expect((await manager.getHistory('webhook', 'x', { packageId: A })).records.map((record) => record.version)).toEqual([3, 1]);
    await manager.rollback('webhook', 'x', 1, { packageId: A });
    expect(await packagesOf('sys_metadata')).toEqual([[2, B, 'B1'], [4, A, 'A1']]);
  });

  it('[FROM B\'s body written TO 409] after B is removed, a rollback to B\'s version is refused naming B, and A\'s row is unchanged', async () => {
    await twoHolders();
    await loader.delete('webhook', 'x', { packageId: B });
    expect(await refusal(manager.rollback('webhook', 'x', 2))).toEqual([409, 'not-held-by-qualifier', [{ kind: 'package', packageId: A }]]);
    expect(await packagesOf('sys_metadata')).toEqual([[3, A, 'A2']]);
  });
});
