// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager';
import { MemoryLoader } from './loaders/memory-loader';
import type { MetadataLoader } from './loaders/loader-interface';

// Suppress logger output during tests
vi.mock('@objectstack/core', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------- MetadataManager ----------

describe('MetadataManager', () => {
  let manager: MetadataManager;
  let memoryLoader: MemoryLoader;

  beforeEach(() => {
    memoryLoader = new MemoryLoader();
    manager = new MetadataManager({
      formats: ['json'],
      loaders: [memoryLoader],
    });
  });

  describe('load', () => {
    it('should return null when item does not exist', async () => {
      const result = await manager.load('object', 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return data from a loader', async () => {
      await memoryLoader.save('object', 'account', { name: 'account', label: 'Account' });
      const result = await manager.load('object', 'account');
      expect(result).toEqual({ name: 'account', label: 'Account' });
    });

    it('should try loaders in order and return first result', async () => {
      const loader1 = createMockLoader('first', { name: 'from_first' });
      const loader2 = createMockLoader('second', { name: 'from_second' });

      const m = new MetadataManager({ formats: ['json'], loaders: [loader1, loader2] });
      const result = await m.load('object', 'test');
      expect(result).toEqual({ name: 'from_first' });
    });

    it('should skip failing loaders and try the next', async () => {
      const failingLoader = createMockLoader('failing', null, true);
      const goodLoader = createMockLoader('good', { name: 'ok' });

      const m = new MetadataManager({ formats: ['json'], loaders: [failingLoader, goodLoader] });
      const result = await m.load('object', 'test');
      expect(result).toEqual({ name: 'ok' });
    });
  });

  describe('loadMany', () => {
    it('should return empty array when nothing loaded', async () => {
      const result = await manager.loadMany('object');
      expect(result).toEqual([]);
    });

    it('should return all items from a loader', async () => {
      await memoryLoader.save('object', 'account', { name: 'account' });
      await memoryLoader.save('object', 'contact', { name: 'contact' });

      const result = await manager.loadMany('object');
      expect(result).toHaveLength(2);
    });

    it('should deduplicate items by name across loaders', async () => {
      const loader1 = createMockLoaderMany('first', [
        { name: 'account', label: 'Account V1' },
      ]);
      const loader2 = createMockLoaderMany('second', [
        { name: 'account', label: 'Account V2' },
        { name: 'contact', label: 'Contact' },
      ]);

      const m = new MetadataManager({ formats: ['json'], loaders: [loader1, loader2] });
      const result = await m.loadMany<{ name: string; label: string }>('object');
      expect(result).toHaveLength(2);
      // First loader wins
      expect(result.find(r => r.name === 'account')?.label).toBe('Account V1');
    });

    it('should skip failing loaders in loadMany', async () => {
      const failingLoader = createMockLoaderMany('failing', [], true);
      const goodLoader = createMockLoaderMany('good', [{ name: 'ok' }]);

      const m = new MetadataManager({ formats: ['json'], loaders: [failingLoader, goodLoader] });
      const result = await m.loadMany('object');
      expect(result).toHaveLength(1);
    });
  });

  describe('save', () => {
    it('should save to a writable loader', async () => {
      await manager.save('object', 'account', { name: 'account' });
      const result = await manager.load('object', 'account');
      expect(result).toEqual({ name: 'account' });
    });

    it('should throw when no writable loader is available', async () => {
      const readOnlyLoader: MetadataLoader = {
        contract: { name: 'readonly', protocol: 'memory:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        // No save method
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [readOnlyLoader] });
      await expect(m.save('object', 'test', {})).rejects.toThrow('No loader available');
    });

    it('should save to a specific named loader', async () => {
      await manager.save('object', 'account', { name: 'account' }, { loader: 'memory' } as any);
      const result = await manager.load('object', 'account');
      expect(result).toEqual({ name: 'account' });
    });

    it('should throw when specified loader not found', async () => {
      await expect(
        manager.save('object', 'test', {}, { loader: 'nonexistent' } as any)
      ).rejects.toThrow('Loader not found');
    });
  });

  describe('exists', () => {
    it('should return false for non-existent items', async () => {
      expect(await manager.exists('object', 'nope')).toBe(false);
    });

    it('should return true for existing items', async () => {
      await memoryLoader.save('object', 'account', { name: 'account' });
      expect(await manager.exists('object', 'account')).toBe(true);
    });
  });

  describe('list', () => {
    it('should return empty array for empty type', async () => {
      const result = await manager.listNames('object');
      expect(result).toEqual([]);
    });

    it('should list all items of a type', async () => {
      await memoryLoader.save('object', 'account', {});
      await memoryLoader.save('object', 'contact', {});
      const result = await manager.listNames('object');
      expect(result).toHaveLength(2);
      expect(result).toContain('account');
      expect(result).toContain('contact');
    });

    it('should deduplicate across loaders', async () => {
      const loader1: MetadataLoader = {
        contract: { name: 'l1', protocol: 'memory:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue(['account', 'contact']),
      };
      const loader2: MetadataLoader = {
        contract: { name: 'l2', protocol: 'memory:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue(['account', 'lead']),
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [loader1, loader2] });
      const result = await m.listNames('object');
      expect(result).toHaveLength(3);
      expect(result).toContain('account');
      expect(result).toContain('contact');
      expect(result).toContain('lead');
    });
  });

  describe('watch / unwatch', () => {
    it('should register and invoke watch callbacks', () => {
      const callback = vi.fn();
      (manager as any).addWatchCallback('object', callback);

      // Trigger via protected method — cast to access it
      (manager as any).notifyWatchers('object', {
        type: 'changed',
        metadataType: 'object',
        name: 'account',
        path: '/fake',
        timestamp: new Date(),
      });

      expect(callback).toHaveBeenCalledOnce();
    });

    it('should unwatch callback', () => {
      const callback = vi.fn();
      (manager as any).addWatchCallback('object', callback);
      (manager as any).removeWatchCallback('object', callback);

      (manager as any).notifyWatchers('object', {
        type: 'changed',
        metadataType: 'object',
        name: 'account',
        path: '/fake',
        timestamp: new Date(),
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not throw when unwatching non-existent callback', () => {
      expect(() => (manager as any).removeWatchCallback('object', vi.fn())).not.toThrow();
    });
  });

  describe('register — loader protocol filtering', () => {
    it('should persist to datasource: protocol loaders', async () => {
      const dbLoader: MetadataLoader = {
        contract: { name: 'database', protocol: 'datasource:' as const, capabilities: { read: true, write: true, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [dbLoader] });
      await m.register('object', 'account', { name: 'account' });

      expect(dbLoader.save).toHaveBeenCalledWith('object', 'account', { name: 'account' });
    });

    it('should NOT persist to file: protocol loaders', async () => {
      const fsLoader: MetadataLoader = {
        contract: { name: 'filesystem', protocol: 'file:' as const, capabilities: { read: true, write: true, watch: true, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [fsLoader] });
      await m.register('object', 'account', { name: 'account' });

      expect(fsLoader.save).not.toHaveBeenCalled();
    });

    it('should NOT persist to memory: protocol loaders', async () => {
      const memLoader: MetadataLoader = {
        contract: { name: 'memory', protocol: 'memory:' as const, capabilities: { read: true, write: true, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [memLoader] });
      await m.register('object', 'account', { name: 'account' });

      expect(memLoader.save).not.toHaveBeenCalled();
    });

    it('should NOT persist to datasource: protocol loaders with write: false', async () => {
      const readOnlyDbLoader: MetadataLoader = {
        contract: { name: 'database-ro', protocol: 'datasource:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [readOnlyDbLoader] });
      await m.register('object', 'account', { name: 'account' });

      expect(readOnlyDbLoader.save).not.toHaveBeenCalled();
    });

    it('should still store in in-memory registry regardless of loaders', async () => {
      const m = new MetadataManager({ formats: ['json'], loaders: [] });
      await m.register('object', 'account', { name: 'account' });

      const result = await m.get('object', 'account');
      expect(result).toEqual({ name: 'account' });
    });
  });

  describe('unregister — loader protocol filtering', () => {
    it('should delete from datasource: protocol loaders', async () => {
      const deleteFn = vi.fn();
      const dbLoader: MetadataLoader = {
        contract: { name: 'database', protocol: 'datasource:' as const, capabilities: { read: true, write: true, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
        delete: deleteFn,
      } as any;

      const m = new MetadataManager({ formats: ['json'], loaders: [dbLoader] });
      await m.register('object', 'account', { name: 'account' });
      await m.unregister('object', 'account');

      expect(deleteFn).toHaveBeenCalledWith('object', 'account');
    });

    it('should NOT delete from file: protocol loaders', async () => {
      const deleteFn = vi.fn();
      const fsLoader: MetadataLoader = {
        contract: { name: 'filesystem', protocol: 'file:' as const, capabilities: { read: true, write: true, watch: true, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
        delete: deleteFn,
      } as any;

      const m = new MetadataManager({ formats: ['json'], loaders: [fsLoader] });
      await m.register('object', 'account', { name: 'account' });
      await m.unregister('object', 'account');

      expect(deleteFn).not.toHaveBeenCalled();
    });

    it('should NOT delete from datasource: protocol loaders with write: false', async () => {
      const deleteFn = vi.fn();
      const readOnlyDbLoader: MetadataLoader = {
        contract: { name: 'database-ro', protocol: 'datasource:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
        delete: deleteFn,
      } as any;

      const m = new MetadataManager({ formats: ['json'], loaders: [readOnlyDbLoader] });
      await m.register('object', 'account', { name: 'account' });
      await m.unregister('object', 'account');

      expect(deleteFn).not.toHaveBeenCalled();
    });

    it('should remove from in-memory registry', async () => {
      const m = new MetadataManager({ formats: ['json'], loaders: [] });
      await m.register('object', 'account', { name: 'account' });
      expect(await m.get('object', 'account')).toEqual({ name: 'account' });

      await m.unregister('object', 'account');
      expect(await m.get('object', 'account')).toBeUndefined();
    });
  });

  describe('registerLoader', () => {
    it('should register a new loader', async () => {
      const newLoader = new MemoryLoader();
      await newLoader.save('view', 'dashboard', { name: 'dashboard' });

      manager.registerLoader(newLoader);

      const result = await manager.load('view', 'dashboard');
      expect(result).toEqual({ name: 'dashboard' });
    });
  });

  describe('serializer initialization', () => {
    it('should initialize with default formats', () => {
      const m = new MetadataManager({ loaders: [] });
      // Default formats are typescript, json, yaml
      expect((m as any).serializers.size).toBe(3);
    });

    it('should initialize with only requested formats', () => {
      const m = new MetadataManager({ formats: ['json'], loaders: [] });
      expect((m as any).serializers.size).toBe(1);
      expect((m as any).serializers.has('json')).toBe(true);
    });

    it('should support javascript format', () => {
      const m = new MetadataManager({ formats: ['javascript'], loaders: [] });
      expect((m as any).serializers.has('javascript')).toBe(true);
    });
  });

  describe('persistence write gates', () => {
    it('register() is a no-op when persistence.writable is false', async () => {
      const m = new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
        persistence: { writable: false },
      });
      await m.register('object', 'account', { name: 'account' });
      expect(await m.listNames('object')).toEqual([]);
    });

    it('register() throws when persistence.writable=false and validation.throwOnError', async () => {
      const m = new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
        persistence: { writable: false },
        validation: { throwOnError: true },
      });
      await expect(m.register('object', 'account', { name: 'account' })).rejects.toThrow(
        /persistence\.writable=false/,
      );
    });

    it('saveOverlay() is a no-op when persistence.overlayWritable is false', async () => {
      const m = new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
        persistence: { overlayWritable: false },
      });
      await m.saveOverlay({
        id: 'overlay-1',
        baseType: 'object',
        baseName: 'account',
        scope: 'platform',
        patch: { label: 'X' },
      } as any);
      expect(await m.getOverlay('object', 'account', 'platform')).toBeUndefined();
    });

    it('saveOverlay() throws when persistence.overlayWritable=false and validation.throwOnError', async () => {
      const m = new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
        persistence: { overlayWritable: false },
        validation: { throwOnError: true },
      });
      await expect(
        m.saveOverlay({
          id: 'overlay-1',
          baseType: 'object',
          baseName: 'account',
          scope: 'platform',
          patch: { label: 'X' },
        } as any),
      ).rejects.toThrow(/persistence\.overlayWritable=false/);
    });

    it('defaults preserve write behavior (writable=true, overlayWritable=true)', async () => {
      const m = new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
      });
      await m.register('object', 'account', { name: 'account' });
      expect(await m.listNames('object')).toContain('account');
      await m.saveOverlay({
        id: 'overlay-1',
        baseType: 'object',
        baseName: 'account',
        scope: 'platform',
        patch: { label: 'X' },
      } as any);
      expect(await m.getOverlay('object', 'account', 'platform')).toBeDefined();
    });
  });
});

// ---------- MemoryLoader ----------

describe('MemoryLoader', () => {
  let loader: MemoryLoader;

  beforeEach(() => {
    loader = new MemoryLoader();
  });

  it('should have correct contract', () => {
    expect(loader.contract.name).toBe('memory');
    expect(loader.contract.protocol).toBe('memory:');
    expect(loader.contract.capabilities.read).toBe(true);
    expect(loader.contract.capabilities.write).toBe(true);
  });

  it('should save and load items', async () => {
    await loader.save('object', 'task', { name: 'task', label: 'Task' });
    const result = await loader.load('object', 'task');
    expect(result.data).toEqual({ name: 'task', label: 'Task' });
    expect(result.source).toBe('memory');
  });

  it('should return null for missing items', async () => {
    const result = await loader.load('object', 'missing');
    expect(result.data).toBeNull();
  });

  it('should check existence', async () => {
    expect(await loader.exists('object', 'task')).toBe(false);
    await loader.save('object', 'task', {});
    expect(await loader.exists('object', 'task')).toBe(true);
  });

  it('should list items', async () => {
    await loader.save('object', 'a', {});
    await loader.save('object', 'b', {});
    const items = await loader.list('object');
    expect(items).toEqual(['a', 'b']);
  });

  it('should return empty list for unknown types', async () => {
    expect(await loader.list('unknown')).toEqual([]);
  });

  it('should loadMany items', async () => {
    await loader.save('object', 'a', { name: 'a' });
    await loader.save('object', 'b', { name: 'b' });
    const items = await loader.loadMany('object');
    expect(items).toHaveLength(2);
  });

  it('should return stats for existing items', async () => {
    await loader.save('object', 'task', {});
    const stats = await loader.stat('object', 'task');
    expect(stats).not.toBeNull();
    expect(stats!.format).toBe('json');
  });

  it('should return null stats for missing items', async () => {
    const stats = await loader.stat('object', 'missing');
    expect(stats).toBeNull();
  });

  it('should return save result with path', async () => {
    const result = await loader.save('object', 'task', {});
    expect(result.success).toBe(true);
    expect(result.path).toBe('memory://object/task');
  });
});

// ---------- MetadataPlugin ----------

describe('MetadataPlugin', () => {
  // Plugin creates NodeMetadataManager which depends on node:path and chokidar.
  // We mock NodeMetadataManager to avoid filesystem side effects.
  vi.mock('./node-metadata-manager', () => {
    const MockNodeMetadataManager = class {
      loadMany = vi.fn().mockResolvedValue([]);
      registerLoader = vi.fn();
      stopWatching = vi.fn();
      setTypeRegistry = vi.fn();
      setDatabaseDriver = vi.fn();
      setDataEngine = vi.fn();
      register = vi.fn();
    };
    return { NodeMetadataManager: MockNodeMetadataManager };
  });

  // Mock the spec kernel import
  vi.mock('@objectstack/spec/kernel', () => ({
    DEFAULT_METADATA_TYPE_REGISTRY: [
      { type: 'object', label: 'Object', filePatterns: ['**/*.object.ts'], supportsOverlay: true, allowRuntimeCreate: false, supportsVersioning: true, loadOrder: 10, domain: 'data' },
      { type: 'view', label: 'View', filePatterns: ['**/*.view.ts'], supportsOverlay: true, allowRuntimeCreate: true, supportsVersioning: false, loadOrder: 50, domain: 'ui' },
    ],
  }));

  it('should have correct plugin metadata', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });
    expect(plugin.name).toBe('com.objectstack.metadata');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.type).toBe('standard');
  });

  it('should call init and register metadata service', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const ctx = createMockPluginContext();
    await plugin.init(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith('metadata', expect.anything());
  });

  it('should register metadata storage objects in the ObjectOS manifest', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const manifestService = { register: vi.fn() };
    const ctx = createMockPluginContext();
    ctx.getService = vi.fn().mockImplementation((serviceName: string) => {
      if (serviceName === 'manifest') return manifestService;
      throw new Error(`Service ${serviceName} not found`);
    });

    await plugin.init(ctx);

    const registeredObjects = manifestService.register.mock.calls
      .flatMap(([manifest]) => manifest.objects ?? [])
      .map((object) => object.name);
    expect(registeredObjects).toContain('sys_metadata');
    expect(registeredObjects).toContain('sys_metadata_history');
  });

  it('should call start and attempt to load metadata types', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const ctx = createMockPluginContext();
    await plugin.init(ctx);
    await plugin.start(ctx);

    // start should call logger.info at least once
    expect(ctx.logger.info).toHaveBeenCalled();
  });

  it('should not bridge ObjectQL engine to MetadataManager in start()', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const mockObjectQL = { name: 'objectql', find: vi.fn(), create: vi.fn() };
    const ctx = createMockPluginContext();
    ctx.getService = vi.fn().mockImplementation((serviceName: string) => {
      if (serviceName === 'objectql') return mockObjectQL;
      throw new Error(`Service ${serviceName} not found`);
    });

    await plugin.init(ctx);
    await plugin.start(ctx);

    // ObjectOS metadata is artifact/file backed. Database persistence is an
    // explicit MetadataManager concern, not an automatic runtime bridge.
    const manager = (plugin as any).manager;
    expect(manager.setDataEngine).not.toHaveBeenCalled();
  });

  it('should load filesystem metadata without enabling database persistence', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const callOrder: string[] = [];

    const manager = (plugin as any).manager;
    manager.loadMany = vi.fn().mockImplementation(async () => {
      callOrder.push('loadMany');
      return [];
    });
    manager.setDataEngine = vi.fn().mockImplementation(() => {
      callOrder.push('setDataEngine');
    });

    const ctx = createMockPluginContext();
    ctx.getService = vi.fn().mockImplementation((serviceName: string) => {
      throw new Error(`Service ${serviceName} not found`);
    });

    await plugin.init(ctx);
    await plugin.start(ctx);

    expect(callOrder).toContain('loadMany');
    expect(callOrder).not.toContain('setDataEngine');
  });

  it('should not fail when no ObjectQL service is available', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const ctx = createMockPluginContext();
    ctx.getService = vi.fn().mockImplementation((serviceName: string) => {
      throw new Error(`Service ${serviceName} not found`);
    });

    await plugin.init(ctx);
    // Should not throw
    await expect(plugin.start(ctx)).resolves.not.toThrow();

    // setDataEngine should not have been called
    const manager = (plugin as any).manager;
    expect(manager.setDataEngine).not.toHaveBeenCalled();
  });

  it('should gracefully handle getServices errors', async () => {
    const { MetadataPlugin } = await import('./plugin.js');
    const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

    const ctx = createMockPluginContext();
    ctx.getServices = vi.fn().mockImplementation(() => { throw new Error('services unavailable'); });

    await plugin.init(ctx);
    // Should not throw even when getServices fails
    await expect(plugin.start(ctx)).resolves.not.toThrow();
  });

  describe('bootstrap modes', () => {
    it('eager (default) primes metadata from the filesystem', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const plugin = new MetadataPlugin({ rootDir: '/tmp/test', watch: false });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await plugin.start(ctx);

      // eager mode performs an FS scan via manager.loadMany() per registered type
      expect(manager.loadMany).toHaveBeenCalled();
    });

    it('lazy bootstrap skips the filesystem priming pass', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        config: { bootstrap: 'lazy' },
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await plugin.start(ctx);

      // lazy mode never scans the filesystem — reads flow through registered loaders
      expect(manager.loadMany).not.toHaveBeenCalled();
      // lazy mode should announce its decision
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('lazy bootstrap'),
      );
    });

    it('artifact-only bootstrap throws when no artifactSource is configured', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        config: { bootstrap: 'artifact-only' },
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await expect(plugin.start(ctx)).rejects.toThrow(/artifact-only/);
      // Must NOT have scanned the filesystem
      expect(manager.loadMany).not.toHaveBeenCalled();
    });

    it('artifact-only bootstrap rejects the not-yet-implemented artifact-api source', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        config: { bootstrap: 'artifact-only' },
        artifactSource: { mode: 'artifact-api', url: 'https://example.com/artifact' },
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await expect(plugin.start(ctx)).rejects.toThrow(/artifact-api/);
      expect(manager.loadMany).not.toHaveBeenCalled();
    });
  });
});

// ---------- Helpers ----------

function createMockLoader(name: string, data: any, shouldFail = false): MetadataLoader {
  return {
    contract: { name, protocol: 'memory:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
    load: shouldFail
      ? vi.fn().mockRejectedValue(new Error('loader failed'))
      : vi.fn().mockResolvedValue({ data }),
    loadMany: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  };
}

function createMockLoaderMany(name: string, items: any[], shouldFail = false): MetadataLoader {
  return {
    contract: { name, protocol: 'memory:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
    load: vi.fn().mockResolvedValue({ data: null }),
    loadMany: shouldFail
      ? vi.fn().mockRejectedValue(new Error('loader failed'))
      : vi.fn().mockResolvedValue(items),
    exists: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  };
}

function createMockPluginContext() {
  return {
    registerService: vi.fn(),
    replaceService: vi.fn(),
    getService: vi.fn().mockReturnValue(null),
    getServices: vi.fn().mockReturnValue(new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getKernel: vi.fn(),
  };
}
