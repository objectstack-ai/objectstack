// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager';
import { DatabaseLoader } from './loaders/database-loader';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

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
    if (manager.getHistory) {
      const history = await manager.getHistory('object', 'test_object');

      expect(history.records.length).toBeGreaterThan(0);
      expect(history.records[0].operationType).toBe('create');
      expect(history.records[0].version).toBe(1);
    }
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
    if (manager.getHistory) {
      const history = await manager.getHistory('object', 'test_object');

      expect(history.records.length).toBeGreaterThanOrEqual(2);
      expect(history.records[0].operationType).toBe('update');
      expect(history.records[0].version).toBe(2);
    }
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
    if (manager.rollback) {
      const restored = await manager.rollback('object', 'test_object', 1);

      expect(restored).toBeDefined();
      expect((restored as any).label).toBe('Version 1');
    }

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
    if (manager.diff) {
      const diffResult = await manager.diff('object', 'test_object', 1, 2);

      expect(diffResult.identical).toBe(false);
      expect(diffResult.patch.length).toBeGreaterThan(0);
      expect(diffResult.summary).toContain('modified');
    }
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

    if (manager.getHistory) {
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
    }
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

    if (manager.getHistory) {
      const history = await manager.getHistory('object', 'test_object');

      // Should only have one history record (the create)
      // The second register should be skipped due to identical checksum
      expect(history.records.length).toBe(1);
    }
  });

  it('should return empty history for non-existent metadata', async () => {
    if (manager.getHistory) {
      const history = await manager.getHistory('object', 'nonexistent');

      expect(history.records).toEqual([]);
      expect(history.total).toBe(0);
      expect(history.hasMore).toBe(false);
    }
  });

  it('should throw error when rolling back to non-existent version', async () => {
    await manager.register('object', 'test_object', {
      name: 'test_object',
      label: 'Test',
    });

    if (manager.rollback) {
      await expect(
        manager.rollback('object', 'test_object', 999)
      ).rejects.toThrow();
    }
  });
});
