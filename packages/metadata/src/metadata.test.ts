// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataManager } from './metadata-manager';
import { MemoryLoader } from './loaders/memory-loader';
import type { MetadataLoader } from './loaders/loader-interface';

// Suppress logger output during tests
vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
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
        // [#5276] A `datasource:` loader that declares `capabilities.write` must
        // implement `delete` — `registerLoader()` rejects it otherwise. This
        // stub is a write-capable datasource loader by intent (that is the whole
        // point of the assertion below), so it gains the method rather than
        // narrowing its capabilities.
        delete: vi.fn().mockResolvedValue(undefined),
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
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const dbLoader: MetadataLoader = {
        contract: { name: 'database', protocol: 'datasource:' as const, capabilities: { read: true, write: true, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
        delete: deleteFn,
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [dbLoader] });
      await m.register('object', 'account', { name: 'account' });
      await m.unregister('object', 'account');

      expect(deleteFn).toHaveBeenCalledWith('object', 'account');
    });

    it('should NOT delete from file: protocol loaders', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const fsLoader: MetadataLoader = {
        contract: { name: 'filesystem', protocol: 'file:' as const, capabilities: { read: true, write: true, watch: true, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
        delete: deleteFn,
      };

      const m = new MetadataManager({ formats: ['json'], loaders: [fsLoader] });
      await m.register('object', 'account', { name: 'account' });
      await m.unregister('object', 'account');

      expect(deleteFn).not.toHaveBeenCalled();
    });

    it('should NOT delete from datasource: protocol loaders with write: false', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const readOnlyDbLoader: MetadataLoader = {
        contract: { name: 'database-ro', protocol: 'datasource:' as const, capabilities: { read: true, write: false, watch: false, list: true } },
        load: vi.fn().mockResolvedValue({ data: null }),
        loadMany: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(false),
        stat: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue({ success: true }),
        delete: deleteFn,
      };

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

    // #4085 — an ABSENT local artifact is "no app compiled yet", not a fault.
    // `createStandaloneStack` always points MetadataPlugin at
    // `dist/objectstack.json`, so an unconditional throw here made
    // `os serve objectstack.config.ts` impossible before a first `os compile`:
    // the development platform refused to start without an app.
    it('eager bootstrap boots without a compiled artifact instead of failing', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const missing = join(tmpdir(), `os-absent-artifact-${process.pid}`, 'dist/objectstack.json');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        artifactSource: { mode: 'local-file', path: missing },
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await expect(plugin.start(ctx)).resolves.not.toThrow();
      // …and it says so, naming the path, rather than booting silently.
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('no compiled artifact yet'),
        expect.objectContaining({ path: missing }),
      );
    });

    // The tolerance is ENOENT-only: a present-but-broken artifact is a real
    // fault and must not degrade into a silent empty boot.
    it('eager bootstrap still fails loudly on a malformed artifact file', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const dir = mkdtempSync(join(tmpdir(), 'os-bad-artifact-'));
      const bad = join(dir, 'objectstack.json');
      writeFileSync(bad, '{ this is not json', 'utf8');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        artifactSource: { mode: 'local-file', path: bad },
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      try {
        await expect(plugin.start(ctx)).rejects.toThrow(/Cannot read artifact file/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    // …and the sealed runtime keeps its hard guarantee: `artifact-only` exists
    // precisely so a deployment cannot serve metadata it did not ship.
    it('artifact-only bootstrap still fails when the local artifact is missing', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const missing = join(tmpdir(), `os-absent-sealed-${process.pid}`, 'dist/objectstack.json');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        config: { bootstrap: 'artifact-only' },
        artifactSource: { mode: 'local-file', path: missing },
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await expect(plugin.start(ctx)).rejects.toThrow(/Cannot read artifact file/);
      expect(manager.loadMany).not.toHaveBeenCalled();
    });

    // #4246 resolution — the `artifact-api` source is REMOVED, not reserved.
    // The mode shipped through v17 with zero consumers in any repo (the cloud
    // runtime uses its own ArtifactApiClient; package distribution into a
    // running OSS instance goes through @objectstack/cloud-connection), so the
    // enforce-or-remove call went to remove. What these tests pin is the
    // failure MODE of the removal: a still-configured 'artifact-api' source —
    // reachable only from JS callers or config plumbed through `any`, since
    // the TS union is now single-member — must fail loudly at start(), never
    // degrade into "no source".
    it('artifact-only bootstrap rejects the removed artifact-api source with a migration message', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        config: { bootstrap: 'artifact-only' },
        artifactSource: { mode: 'artifact-api', url: 'https://example.com' } as any,
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);
      const fetchMock = vi.fn();
      const realFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      const ctx = createMockPluginContext();
      try {
        await plugin.init(ctx);
        await expect(plugin.start(ctx)).rejects.toThrow(/'artifact-api' source was removed/);
        // Rejected before any load path was chosen: no fetch, no FS scan.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(manager.loadMany).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    // The dangerous degradation the guard exists to prevent: under `eager`,
    // treating "unsupported source" as "no source" would fall through to the
    // filesystem scan and boot with whatever happens to be on disk instead of
    // the artifact the caller named.
    it('eager bootstrap rejects the removed mode instead of silently falling back to the filesystem scan', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        artifactSource: { mode: 'artifact-api', url: 'https://example.com' } as any,
      });

      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      await plugin.init(ctx);
      await expect(plugin.start(ctx)).rejects.toThrow(/not supported/);
      expect(manager.loadMany).not.toHaveBeenCalled();
    });

    // The migration target named by the rejection message, pinned so it stays
    // real: `local-file` with an http(s) URL fetches verbatim and registers
    // the envelope-wrapped artifact — the shape the control plane's public
    // /pub/v1/environments/:id/artifact route serves.
    it('local-file accepts an http(s) URL and registers the fetched artifact envelope', async () => {
      const { MetadataPlugin } = await import('./plugin.js');
      const url = 'https://cloud.example.com/pub/v1/environments/env_42/artifact?commit=cmt_1';
      const envelope = {
        schemaVersion: '0.1',
        environmentId: 'env_42',
        commitId: 'cmt_1',
        checksum: 'a'.repeat(64),
        metadata: { objects: [{ name: 'artifact_probe', label: 'Artifact Probe', fields: {} }] },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(envelope),
      });
      const realFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      const plugin = new MetadataPlugin({
        rootDir: '/tmp/test',
        watch: false,
        environmentId: 'env_42',
        config: { bootstrap: 'artifact-only' },
        artifactSource: { mode: 'local-file', path: url },
      });
      const manager = (plugin as any).manager;
      manager.loadMany = vi.fn().mockResolvedValue([]);

      const ctx = createMockPluginContext();
      try {
        await plugin.init(ctx);
        await plugin.start(ctx);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(url);
        expect(manager.register).toHaveBeenCalledWith(
          'object',
          'artifact_probe',
          expect.objectContaining({ name: 'artifact_probe' }),
          { notify: false },
        );
        expect(manager.loadMany).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = realFetch;
      }
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
