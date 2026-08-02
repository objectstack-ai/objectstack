// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseLoader, type DatabaseLoaderOptions } from './database-loader';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from '../metadata-manager';
import { MemoryLoader } from './memory-loader';

// Suppress logger output during tests
vi.mock('@objectstack/core', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * In-memory IDataDriver mock for testing DatabaseLoader.
 * Stores records in a Map keyed by table name → id.
 */
function createMockDriver(): IDataDriver {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();

  function getTable(name: string): Map<string, Record<string, unknown>> {
    if (!tables.has(name)) {
      tables.set(name, new Map());
    }
    return tables.get(name)!;
  }

  return {
    name: 'mock',
    version: '1.0.0',
    supports: {
      transactions: false,
      joins: false,
      aggregations: false,
      streaming: false,
      bulkOperations: true,
      nestedObjects: false,
      fullTextSearch: false,
      geoQueries: false,
      changeStreams: false,
    },

    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),

    execute: vi.fn().mockResolvedValue(undefined),

    find: vi.fn().mockImplementation((tableName: string, query: any) => {
      const table = getTable(tableName);
      const where = query?.where ?? {};
      const fields = query?.fields as string[] | undefined;

      const results: Record<string, unknown>[] = [];
      for (const row of table.values()) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) {
            match = false;
            break;
          }
        }
        if (match) {
          if (fields && fields.length > 0) {
            const partial: Record<string, unknown> = {};
            for (const f of fields) {
              partial[f] = row[f];
            }
            results.push(partial);
          } else {
            results.push({ ...row });
          }
        }
      }
      return Promise.resolve(results);
    }),

    findOne: vi.fn().mockImplementation((tableName: string, query: any) => {
      const table = getTable(tableName);
      const where = query?.where ?? {};

      for (const row of table.values()) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) {
            match = false;
            break;
          }
        }
        if (match) return Promise.resolve({ ...row });
      }
      return Promise.resolve(null);
    }),


    create: vi.fn().mockImplementation((tableName: string, data: Record<string, unknown>) => {
      const table = getTable(tableName);
      const id = data.id as string;
      table.set(id, { ...data });
      return Promise.resolve({ ...data });
    }),

    update: vi.fn().mockImplementation((tableName: string, id: string, data: Record<string, unknown>) => {
      const table = getTable(tableName);
      const existing = table.get(id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, ...data };
      table.set(id, updated);
      return Promise.resolve(updated);
    }),

    upsert: vi.fn().mockResolvedValue({}),

    delete: vi.fn().mockImplementation((tableName: string, id: string) => {
      const table = getTable(tableName);
      const existed = table.has(id);
      table.delete(id);
      return Promise.resolve(existed);
    }),

    count: vi.fn().mockImplementation((tableName: string, query: any) => {
      const table = getTable(tableName);
      const where = query?.where ?? {};

      let count = 0;
      for (const row of table.values()) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      return Promise.resolve(count);
    }),

    bulkCreate: vi.fn().mockResolvedValue([]),
    bulkUpdate: vi.fn().mockResolvedValue([]),
    bulkDelete: vi.fn().mockResolvedValue(undefined),

    beginTransaction: vi.fn().mockResolvedValue({}),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),

    syncSchema: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------- DatabaseLoader ----------

describe('DatabaseLoader', () => {
  let loader: DatabaseLoader;
  let mockDriver: IDataDriver;

  beforeEach(() => {
    mockDriver = createMockDriver();
    loader = new DatabaseLoader({ driver: mockDriver });
  });

  describe('contract', () => {
    it('should have correct contract metadata', () => {
      expect(loader.contract.name).toBe('database');
      expect(loader.contract.protocol).toBe('datasource:');
      expect(loader.contract.capabilities.read).toBe(true);
      expect(loader.contract.capabilities.write).toBe(true);
      expect(loader.contract.capabilities.watch).toBe(false);
      expect(loader.contract.capabilities.list).toBe(true);
    });
  });

  describe('schema bootstrapping', () => {
    it('should call syncSchema with SysMetadataObject on first operation', async () => {
      await loader.list('object');
      expect(mockDriver.syncSchema).toHaveBeenCalledOnce();
      expect(mockDriver.syncSchema).toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({
          name: 'sys_metadata',
          isSystem: true,
          fields: expect.objectContaining({
            id: expect.objectContaining({ type: 'text' }),
            name: expect.objectContaining({ type: 'text' }),
            type: expect.objectContaining({ type: 'text' }),
            scope: expect.objectContaining({ type: 'select' }),
            metadata: expect.objectContaining({ type: 'textarea' }),
          }),
        })
      );
    });

    it('should only call syncSchema once (idempotent)', async () => {
      await loader.list('object');
      await loader.list('view');
      await loader.exists('object', 'account');
      expect(mockDriver.syncSchema).toHaveBeenCalledOnce();
    });

    it('should use custom table name', async () => {
      const customLoader = new DatabaseLoader({
        driver: mockDriver,
        tableName: 'custom_metadata',
      });
      await customLoader.list('object');
      expect(mockDriver.syncSchema).toHaveBeenCalledWith(
        'custom_metadata',
        expect.objectContaining({ name: 'custom_metadata' })
      );
    });
  });

  describe('save and load', () => {
    it('should save and load a metadata item', async () => {
      const data = { name: 'account', label: 'Account', fields: {} };
      await loader.save('object', 'account', data);

      const result = await loader.load('object', 'account');
      expect(result.data).toEqual(data);
      expect(result.source).toBe('database');
      expect(result.format).toBe('json');
    });

    it('should return null for non-existent item', async () => {
      const result = await loader.load('object', 'missing');
      expect(result.data).toBeNull();
    });

    it('should update existing item on re-save', async () => {
      await loader.save('object', 'account', { name: 'account', label: 'V1' });
      await loader.save('object', 'account', { name: 'account', label: 'V2' });

      const result = await loader.load('object', 'account');
      expect(result.data).toEqual({ name: 'account', label: 'V2' });
    });

    it('should return save result with path', async () => {
      const result = await loader.save('object', 'account', { name: 'account' });
      expect(result.success).toBe(true);
      expect(result.path).toBe('datasource://sys_metadata/object/account');
      expect(result.size).toBeGreaterThan(0);
      expect(result.saveTime).toBeDefined();
    });

    it('should increment version on update', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'account', { name: 'account', label: 'Updated' });

      // The update call should have been made with incremented version
      expect(mockDriver.update).toHaveBeenCalledWith(
        'sys_metadata',
        expect.any(String),
        expect.objectContaining({ version: 2 })
      );
    });
  });

  describe('exists', () => {
    it('should return false for non-existent items', async () => {
      expect(await loader.exists('object', 'nope')).toBe(false);
    });

    it('should return true for existing items', async () => {
      await loader.save('object', 'account', { name: 'account' });
      expect(await loader.exists('object', 'account')).toBe(true);
    });

    it('should differentiate between types', async () => {
      await loader.save('object', 'account', { name: 'account' });
      expect(await loader.exists('object', 'account')).toBe(true);
      expect(await loader.exists('view', 'account')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return empty array for empty type', async () => {
      const items = await loader.list('object');
      expect(items).toEqual([]);
    });

    it('should list all items of a type', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'contact', { name: 'contact' });
      await loader.save('view', 'account_list', { name: 'account_list' });

      const objects = await loader.list('object');
      expect(objects).toHaveLength(2);
      expect(objects).toContain('account');
      expect(objects).toContain('contact');

      const views = await loader.list('view');
      expect(views).toHaveLength(1);
      expect(views).toContain('account_list');
    });
  });

  describe('loadMany', () => {
    it('should return empty array for unknown type', async () => {
      const items = await loader.loadMany('object');
      expect(items).toEqual([]);
    });

    it('should return all items of a type', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'contact', { name: 'contact' });

      const items = await loader.loadMany<{ name: string }>('object');
      expect(items).toHaveLength(2);
      expect(items.map(i => i.name)).toContain('account');
      expect(items.map(i => i.name)).toContain('contact');
    });

    it('should not include items from other types', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('view', 'account_list', { name: 'account_list' });

      const objects = await loader.loadMany('object');
      expect(objects).toHaveLength(1);
    });
  });

  describe('stat', () => {
    it('should return null for missing items', async () => {
      const stats = await loader.stat('object', 'missing');
      expect(stats).toBeNull();
    });

    it('should return stats for existing items', async () => {
      await loader.save('object', 'account', { name: 'account' });
      const stats = await loader.stat('object', 'account');
      expect(stats).not.toBeNull();
      expect(stats!.format).toBe('json');
      expect(stats!.size).toBeGreaterThan(0);
    });
  });

  describe('multi-tenant isolation', () => {
    it('should filter by organizationId when configured (environmentId accepted but ignored — ADR-0008 §0)', async () => {
      const tenantLoader = new DatabaseLoader({
        driver: mockDriver,
        organizationId: 'org-1',
        environmentId: 'env-1',
      });

      await tenantLoader.save('object', 'account', { name: 'account' });

      // The create call should include organization_id but NOT environment_id
      // (environment_id was removed from the metadata layer in the ADR-0008 §0
      // branch/project-removal amendment).
      expect(mockDriver.create).toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({ organization_id: 'org-1' })
      );
      expect(mockDriver.create).not.toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({ environment_id: expect.anything() })
      );

      // The find calls should filter by organization_id (no environment_id).
      await tenantLoader.load('object', 'account');
      expect(mockDriver.findOne).toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-1' }),
        })
      );
      const findOneCalls = (mockDriver.findOne as any).mock.calls;
      for (const [, opts] of findOneCalls) {
        expect((opts?.where ?? {})).not.toHaveProperty('environment_id');
      }
    });
  });

  describe('error handling', () => {
    it('should return null data on load failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.findOne = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      const result = await failLoader.load('object', 'account');
      expect(result.data).toBeNull();
    });

    it('should return empty array on loadMany failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.find = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      const result = await failLoader.loadMany('object');
      expect(result).toEqual([]);
    });

    it('should return false on exists failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.count = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      expect(await failLoader.exists('object', 'account')).toBe(false);
    });

    it('should return null on stat failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.findOne = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      expect(await failLoader.stat('object', 'account')).toBeNull();
    });

    it('should return empty array on list failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.find = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      expect(await failLoader.list('object')).toEqual([]);
    });

    it('should throw descriptive error on save failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.findOne = vi.fn().mockResolvedValue(null);
      failingDriver.create = vi.fn().mockRejectedValue(new Error('Insert failed'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(
        failLoader.save('object', 'account', { name: 'account' })
      ).rejects.toThrow('DatabaseLoader save failed for object/account: Insert failed');
    });
  });
});

// ---------- DatabaseLoader read-through cache ----------

describe('DatabaseLoader read-through cache', () => {
  let mockDriver: IDataDriver;

  beforeEach(() => {
    mockDriver = createMockDriver();
  });

  it('serves a second load() from cache without re-querying the driver', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'account', { name: 'account', label: 'Account' });

    // findOne calls so far: save() did one lookup before insert.
    const baseline = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;

    const first = await loader.load('object', 'account');
    expect(first.data).toEqual({ name: 'account', label: 'Account' });

    const callsAfterFirst = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBe(baseline + 1);

    const second = await loader.load('object', 'account');
    expect(second.data).toEqual({ name: 'account', label: 'Account' });

    // Second load should be a cache hit — no additional findOne.
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);

    const stats = loader.getCacheStats();
    expect(stats.enabled).toBe(true);
    expect(stats.load!.hits).toBeGreaterThanOrEqual(1);
  });

  it('caches null (not-found) results to absorb miss storms', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    const first = await loader.load('object', 'ghost');
    expect(first.data).toBeNull();
    const callsAfterFirst = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;

    const second = await loader.load('object', 'ghost');
    expect(second.data).toBeNull();

    // No additional findOne — the negative result is cached.
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('save() invalidates the (type, name) load cache', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    await loader.save('object', 'account', { name: 'account', label: 'V1' });
    const v1 = await loader.load('object', 'account');
    expect((v1.data as any).label).toBe('V1');

    await loader.save('object', 'account', { name: 'account', label: 'V2' });
    const v2 = await loader.load('object', 'account');
    expect((v2.data as any).label).toBe('V2');
  });

  it('save() invalidates a previously cached null entry (negative → positive)', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    expect((await loader.load('object', 'account')).data).toBeNull();

    await loader.save('object', 'account', { name: 'account', label: 'Created' });
    const after = await loader.load('object', 'account');
    expect(after.data).toEqual({ name: 'account', label: 'Created' });
  });

  it('caches loadMany() per type and invalidates on save', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    await loader.save('object', 'a', { name: 'a' });
    const findCallsBefore = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;

    const first = await loader.loadMany('object');
    expect(first).toHaveLength(1);
    const findCallsAfterFirst = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(findCallsAfterFirst).toBe(findCallsBefore + 1);

    // Second loadMany hits cache.
    const second = await loader.loadMany('object');
    expect(second).toHaveLength(1);
    expect((mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length).toBe(findCallsAfterFirst);

    // A save on the same type invalidates the loadMany cache.
    await loader.save('object', 'b', { name: 'b' });
    const third = await loader.loadMany('object');
    expect(third).toHaveLength(2);
  });

  it('caches list() per type independently of load()', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    await loader.save('object', 'a', { name: 'a' });
    await loader.save('object', 'b', { name: 'b' });

    const findCallsBefore = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;
    const first = await loader.list('object');
    expect(first).toEqual(expect.arrayContaining(['a', 'b']));
    const findCallsAfterFirst = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(findCallsAfterFirst).toBe(findCallsBefore + 1);

    // Second list() is a cache hit.
    await loader.list('object');
    expect((mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length).toBe(findCallsAfterFirst);

    // A save on the same type invalidates the list cache.
    await loader.save('object', 'c', { name: 'c' });
    const refreshed = await loader.list('object');
    expect(refreshed).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('caches stat() per (type, name)', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'account', { name: 'account' });

    const baseline = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    const s1 = await loader.stat('object', 'account');
    expect(s1).not.toBeNull();
    const afterFirst = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterFirst).toBe(baseline + 1);

    await loader.stat('object', 'account');
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterFirst);
  });

  it('delete() invalidates the load cache', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'account', { name: 'account' });
    expect((await loader.load('object', 'account')).data).not.toBeNull();

    await loader.delete('object', 'account');
    const after = await loader.load('object', 'account');
    expect(after.data).toBeNull();
  });

  it('disables caching when cache.enabled === false', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver, cache: { enabled: false } });
    await loader.save('object', 'account', { name: 'account' });

    const before = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    await loader.load('object', 'account');
    await loader.load('object', 'account');
    const after = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    // Both load() calls reach the driver.
    expect(after - before).toBe(2);

    const stats = loader.getCacheStats();
    expect(stats.enabled).toBe(false);
    expect(stats.load).toBeNull();
  });

  it('honors custom maxSize/ttl via cache options', async () => {
    const loader = new DatabaseLoader({
      driver: mockDriver,
      cache: { enabled: true, maxSize: 1, ttl: 60_000 },
    });
    await loader.save('object', 'a', { name: 'a' });
    await loader.save('object', 'b', { name: 'b' });

    // Prime cache with 'a' then 'b' — capacity is 1, so 'a' is evicted.
    await loader.load('object', 'a');
    await loader.load('object', 'b');

    const before = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    await loader.load('object', 'a'); // miss → driver hit
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it('invalidateAll() clears every cache shard', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'a', { name: 'a' });
    await loader.load('object', 'a');
    await loader.list('object');
    await loader.loadMany('object');
    await loader.stat('object', 'a');

    loader.invalidateAll();

    const before = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    await loader.load('object', 'a');
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });
});

// ---------- MetadataManager + DatabaseLoader Integration ----------

describe('MetadataManager with DatabaseLoader', () => {
  let manager: MetadataManager;
  let dbLoader: DatabaseLoader;
  let memoryLoader: MemoryLoader;
  let mockDriver: IDataDriver;

  beforeEach(() => {
    mockDriver = createMockDriver();
    dbLoader = new DatabaseLoader({ driver: mockDriver });
    memoryLoader = new MemoryLoader();
    manager = new MetadataManager({
      formats: ['json'],
      loaders: [memoryLoader, dbLoader],
    });
  });

  it('should save and load via DatabaseLoader', async () => {
    await manager.save('object', 'account', { name: 'account' }, { loader: 'database' } as any);
    const result = await manager.load('object', 'account');
    expect(result).toEqual({ name: 'account' });
  });

  it('should list items from both loaders', async () => {
    await memoryLoader.save('object', 'account', { name: 'account' });
    await dbLoader.save('object', 'contact', { name: 'contact' });

    const names = await manager.listNames('object');
    expect(names).toContain('account');
    expect(names).toContain('contact');
  });

  it('should deduplicate items across memory and database loaders', async () => {
    await memoryLoader.save('object', 'account', { name: 'account', label: 'Memory' });
    await dbLoader.save('object', 'account', { name: 'account', label: 'Database' });

    const items = await manager.loadMany<{ name: string; label: string }>('object');
    const accounts = items.filter(i => i.name === 'account');
    expect(accounts).toHaveLength(1);
    // First loader (memory) wins
    expect(accounts[0].label).toBe('Memory');
  });

  it('should check existence across both loaders', async () => {
    await dbLoader.save('object', 'contact', { name: 'contact' });
    expect(await manager.exists('object', 'contact')).toBe(true);
  });

  it('should use DatabaseLoader for overlay persistence', async () => {
    // Register base metadata
    await manager.register('object', 'account', { name: 'account', label: 'Account' });

    // Save an overlay to the database
    await dbLoader.save('overlay', 'account_platform', {
      name: 'account_platform',
      baseType: 'object',
      baseName: 'account',
      scope: 'platform',
      patch: { label: 'Custom Account' },
      active: true,
    });

    // Verify the overlay is persisted in database
    const overlayResult = await dbLoader.load('overlay', 'account_platform');
    expect(overlayResult.data).toBeDefined();
    expect((overlayResult.data as any).patch.label).toBe('Custom Account');
  });
});

// ---------- MetadataManager Auto-Configuration ----------

describe('MetadataManager auto-configuration', () => {
  it('should auto-register DatabaseLoader when datasource and driver are provided', async () => {
    const mockDriver = createMockDriver();
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
      driver: mockDriver,
    });

    // The database loader should have been registered automatically
    // Verify by saving and loading data through the manager
    await manager.save('object', 'account', { name: 'account', label: 'Account' });
    const result = await manager.load('object', 'account');
    expect(result).toEqual({ name: 'account', label: 'Account' });
  });

  it('should NOT auto-register DatabaseLoader when only datasource is set (no driver)', async () => {
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
      // No driver provided
    });

    // No loaders should be registered, so save should fail
    await expect(
      manager.save('object', 'account', { name: 'account' })
    ).rejects.toThrow('No loader available');
  });

  it('should use custom tableName from config', async () => {
    const mockDriver = createMockDriver();
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
      tableName: 'custom_metadata',
      driver: mockDriver,
    });

    await manager.save('object', 'account', { name: 'account' });
    // syncSchema should be called with custom table name
    expect(mockDriver.syncSchema).toHaveBeenCalledWith(
      'custom_metadata',
      expect.objectContaining({ name: 'custom_metadata' })
    );
  });

  it('should support deferred database setup via setDatabaseDriver', async () => {
    const mockDriver = createMockDriver();
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
    });

    // No database loader yet — use deferred setup
    manager.setDatabaseDriver(mockDriver);

    // Now save and load should work via the database loader
    await manager.save('object', 'account', { name: 'account', label: 'Account' });
    const result = await manager.load('object', 'account');
    expect(result).toEqual({ name: 'account', label: 'Account' });
  });
});
