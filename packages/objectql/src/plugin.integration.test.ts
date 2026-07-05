// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '../src/plugin';
import { ObjectSchema } from '@objectstack/spec/data';

describe('ObjectQLPlugin - Metadata Service Integration', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    kernel = new ObjectKernel({ logLevel: 'silent' });
  });

  describe('Simple Mode (ObjectQL-only)', () => {
    it('should register objectql, data, and protocol services', async () => {
      // Arrange
      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert — ObjectQL no longer registers metadata (kernel provides fallback)
      const objectql = kernel.getService('objectql');
      expect(objectql).toBeDefined();
      expect(kernel.getService('data')).toBeDefined();
      expect(kernel.getService('protocol')).toBeDefined();
      // metadata is provided by kernel's core fallback, not ObjectQL
      const metadataService = kernel.getService('metadata');
      expect(metadataService).toBeDefined();
      expect((metadataService as any)._fallback).toBe(true);
    });

    it('should serve in-memory metadata definitions', async () => {
      // Arrange
      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);
      await kernel.bootstrap();

      const objectql = kernel.getService('objectql') as any;
      const testObject: ObjectSchema = {
        name: 'test_object',
        label: 'Test Object',
        fields: {
          name: {
            name: 'name',
            label: 'Name',
            type: 'text'
          }
        }
      };

      // Act - Register object programmatically via the SchemaRegistry API
      objectql.registry.registerObject(testObject, 'test', 'test');

      // Assert - Should be retrievable via registry (getAllObjects returns ServiceObject[])
      const objects = objectql.registry.getAllObjects();
      const fqns = objects.map((o: any) => o.name);
      expect(fqns).toContain('test_object');
    });
  });

  describe('Service Registration', () => {
    it('should register manifest service', async () => {
      // Arrange
      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert
      expect(kernel.getService('objectql')).toBeDefined();
      expect(kernel.getService('data')).toBeDefined();
      expect(kernel.getService('protocol')).toBeDefined();
      expect(kernel.getService('manifest')).toBeDefined();
    });

    it('should respect existing metadata service', async () => {
      // Arrange - Register a mock metadata service first
      const mockMetadataService = {
        load: async () => null,
        loadMany: async () => [],
        save: async () => ({ success: true }),
        exists: async () => false,
        list: async () => []
      };

      await kernel.use({
        name: 'mock-metadata',
        type: 'test',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('metadata', mockMetadataService);
        }
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert - metadata service should be the mock, not ObjectQL
      const metadataService = kernel.getService('metadata');
      expect(metadataService).toBe(mockMetadataService);
      
      const objectql = kernel.getService('objectql');
      expect(metadataService).not.toBe(objectql);
    });
  });

  describe('Driver and App Discovery', () => {
    it('should discover and register drivers from kernel services', async () => {
      // Arrange
      const mockDriver = {
        name: 'mock-driver',
        connect: async () => {},
        disconnect: async () => {},
        query: async () => ({ rows: [] }),
        insert: async () => ({ id: '1' }),
        update: async () => ({ count: 1 }),
        delete: async () => ({ count: 1 })
      };

      await kernel.use({
        name: 'mock-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.mock', mockDriver);
        }
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert
      const objectql = kernel.getService('objectql') as any;
      expect(objectql.drivers?.has('mock-driver')).toBe(true);
    });

    it('should register apps via manifest service', async () => {
      // Arrange
      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Plugin that uses the manifest service directly
      await kernel.use({
        name: 'mock-app-plugin',
        type: 'app',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx) => {
          ctx.getService<{ register(m: any): void }>('manifest').register({
            id: 'test-app',
            name: 'test_app',
            version: '1.0.0',
            type: 'app',
            apps: [{ name: 'Test App' }],
          });
        }
      });

      // Act
      await kernel.bootstrap();

      // Assert
      const objectql = kernel.getService('objectql') as any;
      expect(objectql.registry).toBeDefined();
      const apps = objectql.registry.getAllApps();
      expect(apps.some((a: any) => a.name === 'Test App')).toBe(true);
    });

    it('should register manifests from start() phase via manifest service', async () => {
      // Arrange — simulates SetupPlugin's pattern (registers in start, not init)
      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      await kernel.use({
        name: 'late-registerer',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async () => {},
        start: async (ctx) => {
          ctx.getService<{ register(m: any): void }>('manifest').register({
            id: 'late-app',
            name: 'late_app',
            version: '1.0.0',
            type: 'plugin',
            apps: [{ name: 'Late App' }],
          });
        }
      });

      // Act
      await kernel.bootstrap();

      // Assert
      const objectql = kernel.getService('objectql') as any;
      const apps = objectql.registry.getAllApps();
      expect(apps.some((a: any) => a.name === 'Late App')).toBe(true);
    });

    it('should still discover apps registered via legacy app.* convention', async () => {
      // Arrange — legacy pattern for backward compatibility
      const mockApp = {
        manifest: {
          id: 'test-app',
          name: 'test_app',
          version: '1.0.0',
          type: 'app'
        }
      };

      await kernel.use({
        name: 'mock-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.test', mockApp.manifest);
        }
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert — legacy pattern still works
      const objectql = kernel.getService('objectql') as any;
      expect(objectql.registry).toBeDefined();
    });
  });

  describe('Metadata Sync from External Service', () => {
    it('should load metadata from external service into ObjectQL registry', async () => {
      // Arrange - Mock external metadata service with test data
      const testObject: ObjectSchema = {
        name: 'external_object',
        label: 'External Object',
        fields: {
          title: {
            name: 'title',
            label: 'Title',
            type: 'text'
          }
        }
      };

      const mockMetadataService = {
        load: async (type: string, name: string) => {
          if (type === 'object' && name === 'external_object') {
            return testObject;
          }
          return null;
        },
        loadMany: async (type: string) => {
          if (type === 'object') {
            return [testObject];
          }
          return [];
        },
        save: async () => ({ success: true, path: '/test' }),
        exists: async () => false,
        list: async () => []
      };

      // Register mock metadata service BEFORE ObjectQL
      await kernel.use({
        name: 'mock-metadata',
        type: 'metadata',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('metadata', mockMetadataService);
        }
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert - Metadata should be synced
      const metadataService = kernel.getService('metadata');
      expect(metadataService).toBe(mockMetadataService);
      
      const objectql = kernel.getService('objectql') as any;
      expect(objectql.registry).toBeDefined();
      
      // Note: The actual sync happens in start phase
      // We can verify by checking if ObjectQL detected external service
    });

    it('passes each item\'s _packageId through so synced items carry provenance', async () => {
      // Arrange — a view stamped by an artifact loader (carries _packageId)
      // and a runtime-authored view (no stamp). The sync must preserve the
      // distinction: stamped items get _provenance, unstamped stay clean.
      const packagedView = {
        name: 'pkg_view',
        label: 'Packaged View',
        _packageId: 'com.example.crm',
      };
      const runtimeView = {
        name: 'user_view',
        label: 'User View',
      };

      const mockMetadataService = {
        load: async () => null,
        loadMany: async (type: string) => (type === 'view' ? [packagedView, runtimeView] : []),
        save: async () => ({ success: true, path: '/test' }),
        exists: async () => false,
        list: async () => []
      };

      await kernel.use({
        name: 'mock-metadata',
        type: 'metadata',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('metadata', mockMetadataService);
        }
      });

      await kernel.use(new ObjectQLPlugin());

      // Act
      await kernel.bootstrap();

      // Assert
      const objectql = kernel.getService('objectql') as any;
      const synced = objectql.registry.getItem('view', 'pkg_view');
      expect(synced).toBeDefined();
      expect(synced._packageId).toBe('com.example.crm');
      expect(synced._provenance).toBe('package');

      const runtime = objectql.registry.getItem('view', 'user_view');
      expect(runtime).toBeDefined();
      expect(runtime._packageId).toBeUndefined();
      expect(runtime._provenance).toBeUndefined();
    });
  });

  describe('Schema Sync on Start', () => {
    it('should call syncSchema for each registered object after init', async () => {
      // Arrange - driver that tracks syncSchema calls
      const synced: Array<{ object: string; schema: any }> = [];
      const mockDriver = {
        name: 'sync-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string, schema: any) => {
          synced.push({ object, schema });
        },
      };

      // Plugin that registers objects and a driver
      await kernel.use({
        name: 'mock-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.sync', mockDriver);
        },
      });

      const appManifest = {
        id: 'com.test.auth',
        name: 'auth',
        namespace: 'sys',
        version: '1.0.0',
        objects: [
          {
            name: 'user',
            label: 'User',
            fields: {
              name: { name: 'name', label: 'Name', type: 'text' },
            },
          },
          {
            name: 'role',
            label: 'Role',
            fields: {
              title: { name: 'title', label: 'Title', type: 'text' },
            },
          },
        ],
      };

      await kernel.use({
        name: 'mock-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.auth', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert - syncSchema should have been called for each object
      const syncedObjects = synced.map((s) => s.object).sort();
      expect(syncedObjects).toContain('user');
      expect(syncedObjects).toContain('role');
      expect(synced.length).toBeGreaterThanOrEqual(2);
    });

    it('should tolerate drivers without syncSchema', async () => {
      // Arrange - driver without syncSchema
      const mockDriver = {
        name: 'no-sync-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        // No syncSchema method
      };

      await kernel.use({
        name: 'mock-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.nosync', mockDriver);
        },
      });

      const appManifest = {
        id: 'com.test.simple',
        name: 'simple',
        namespace: 'test',
        version: '1.0.0',
        objects: [
          {
            name: 'item',
            label: 'Item',
            fields: {
              title: { name: 'title', label: 'Title', type: 'text' },
            },
          },
        ],
      };

      await kernel.use({
        name: 'mock-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.simple', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act & Assert - should not throw
      await expect(kernel.bootstrap()).resolves.not.toThrow();
    });

    it('should tolerate syncSchema failures per object without aborting', async () => {
      // Arrange - driver where syncSchema fails for one object
      const synced: string[] = [];
      const mockDriver = {
        name: 'fail-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string) => {
          if (object.includes('bad')) {
            throw new Error('sync failed for bad object');
          }
          synced.push(object);
        },
      };

      await kernel.use({
        name: 'mock-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.fail', mockDriver);
        },
      });

      const appManifest = {
        id: 'com.test.mixed',
        name: 'mixed',
        namespace: 'mix',
        version: '1.0.0',
        objects: [
          {
            name: 'good',
            label: 'Good',
            fields: { a: { name: 'a', label: 'A', type: 'text' } },
          },
          {
            name: 'bad',
            label: 'Bad',
            fields: { b: { name: 'b', label: 'B', type: 'text' } },
          },
        ],
      };

      await kernel.use({
        name: 'mock-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.mixed', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act - should not throw despite one object failing
      await expect(kernel.bootstrap()).resolves.not.toThrow();

      // Assert - the good object should still have been synced
      expect(synced).toContain('good');
    });

    it('should work without any registered objects', async () => {
      // Arrange - no objects, just a driver
      const mockDriver = {
        name: 'empty-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async () => {},
      };

      await kernel.use({
        name: 'mock-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.empty', mockDriver);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act & Assert - should not throw
      await expect(kernel.bootstrap()).resolves.not.toThrow();
    });

    it('should use the short table name (FQN namespace stripped) for syncSchema', async () => {
      // Arrange - driver that tracks syncSchema calls
      const synced: Array<{ object: string; schema: any }> = [];
      const mockDriver = {
        name: 'table-name-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string, schema: any) => {
          synced.push({ object, schema });
        },
      };

      await kernel.use({
        name: 'mock-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.table-name', mockDriver);
        },
      });

      // System objects use the literal `sys_` prefix as part of their short name
      // (no FQN namespace). Physical table name is derived from the short name.
      const appManifest = {
        id: 'com.test.system',
        name: 'system',
        namespace: 'sys',
        version: '1.0.0',
        objects: [
          {
            name: 'sys_user',
            label: 'User',
            fields: {
              email: { name: 'email', label: 'Email', type: 'text' },
            },
          },
          {
            name: 'sys_session',
            label: 'Session',
            fields: {
              token: { name: 'token', label: 'Token', type: 'text' },
            },
          },
        ],
      };

      await kernel.use({
        name: 'mock-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.system', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert - syncSchema should be called with the short name (which IS the physical table name)
      const syncedNames = synced.map((s) => s.object).sort();
      expect(syncedNames).toContain('sys_user');
      expect(syncedNames).toContain('sys_session');
      // Should NOT contain double-underscore FQN
      expect(syncedNames).not.toContain('sys__user');
      expect(syncedNames).not.toContain('sys__session');
    });

    it('should use syncSchemasBatch when driver supports batchSchemaSync', async () => {
      // Arrange - driver that supports batch schema sync
      const batchCalls: Array<{ object: string; schema: any }[]> = [];
      const singleCalls: Array<{ object: string; schema: any }> = [];
      const mockDriver = {
        name: 'batch-driver',
        version: '1.0.0',
        supports: { batchSchemaSync: true },
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string, schema: any) => {
          singleCalls.push({ object, schema });
        },
        syncSchemasBatch: async (schemas: Array<{ object: string; schema: any }>) => {
          batchCalls.push(schemas);
        },
      };

      await kernel.use({
        name: 'mock-batch-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.batch', mockDriver);
        },
      });

      const appManifest = {
        id: 'com.test.batchapp',
        name: 'batchapp',
        namespace: 'bat',
        version: '1.0.0',
        objects: [
          {
            name: 'alpha',
            label: 'Alpha',
            fields: { a: { name: 'a', label: 'A', type: 'text' } },
          },
          {
            name: 'beta',
            label: 'Beta',
            fields: { b: { name: 'b', label: 'B', type: 'text' } },
          },
          {
            name: 'gamma',
            label: 'Gamma',
            fields: { c: { name: 'c', label: 'C', type: 'text' } },
          },
        ],
      };

      await kernel.use({
        name: 'mock-batch-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.batchapp', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert - syncSchemasBatch should have been called twice (Phase 1: built-in schemas,
      // Phase 3: schemas hydrated from DB) with all app objects present in at least one call
      expect(batchCalls.length).toBe(2);
      const allBatchedObjects = batchCalls.flat().map((s) => s.object);
      expect(allBatchedObjects).toContain('alpha');
      expect(allBatchedObjects).toContain('beta');
      expect(allBatchedObjects).toContain('gamma');
      // syncSchema should NOT have been called individually
      expect(singleCalls.length).toBe(0);
    });

    it('should fall back to sequential syncSchema when batch fails', async () => {
      // Arrange - driver where batch fails
      const singleCalls: Array<{ object: string; schema: any }> = [];
      const mockDriver = {
        name: 'fallback-driver',
        version: '1.0.0',
        supports: { batchSchemaSync: true },
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string, schema: any) => {
          singleCalls.push({ object, schema });
        },
        syncSchemasBatch: async () => {
          throw new Error('batch not supported at runtime');
        },
      };

      await kernel.use({
        name: 'mock-fallback-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.fallback', mockDriver);
        },
      });

      const appManifest = {
        id: 'com.test.fallback',
        name: 'fallback',
        namespace: 'fb',
        version: '1.0.0',
        objects: [
          {
            name: 'one',
            label: 'One',
            fields: { x: { name: 'x', label: 'X', type: 'text' } },
          },
          {
            name: 'two',
            label: 'Two',
            fields: { y: { name: 'y', label: 'Y', type: 'text' } },
          },
        ],
      };

      await kernel.use({
        name: 'mock-fallback-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.fallback', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act - should not throw
      await expect(kernel.bootstrap()).resolves.not.toThrow();

      // Assert - sequential fallback should have been used
      const syncedObjects = singleCalls.map((s) => s.object).sort();
      expect(syncedObjects).toContain('one');
      expect(syncedObjects).toContain('two');
    });

    it('should not use batch when driver does not support batchSchemaSync', async () => {
      // Arrange - driver without batch support (but with syncSchema)
      const singleCalls: string[] = [];
      const mockDriver = {
        name: 'nobatch-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string) => {
          singleCalls.push(object);
        },
      };

      await kernel.use({
        name: 'mock-nobatch-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.nobatch', mockDriver);
        },
      });

      const appManifest = {
        id: 'com.test.nobatch',
        name: 'nobatch',
        namespace: 'nb',
        version: '1.0.0',
        objects: [
          {
            name: 'item',
            label: 'Item',
            fields: { z: { name: 'z', label: 'Z', type: 'text' } },
          },
        ],
      };

      await kernel.use({
        name: 'mock-nobatch-app-plugin',
        type: 'app',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('app.nobatch', appManifest);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert - sequential syncSchema should have been used
      expect(singleCalls).toContain('item');
    });
  });

  describe('Cold-Start Metadata Restoration', () => {
    it('should restore metadata from sys_metadata via protocol.loadMetaFromDb on start', async () => {
      // Arrange — a driver whose find() returns persisted metadata records
      const findCalls: Array<{ object: string; query: any }> = [];
      const mockDriver = {
        name: 'restore-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async (object: string, query: any) => {
          findCalls.push({ object, query });
          if (object === 'sys_metadata') {
            return [
              {
                id: '1',
                type: 'apps',
                name: 'custom_crm',
                state: 'active',
                metadata: JSON.stringify({ name: 'custom_crm', label: 'Custom CRM' }),
              },
              {
                id: '2',
                type: 'object',
                name: 'invoice',
                state: 'active',
                metadata: JSON.stringify({
                  name: 'invoice',
                  label: 'Invoice',
                  fields: { amount: { name: 'amount', label: 'Amount', type: 'number' } },
                }),
                packageId: 'user_pkg',
              },
            ];
          }
          return [];
        },
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async () => {},
      };

      await kernel.use({
        name: 'mock-restore-driver',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.restore', mockDriver);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert — sys_metadata should have been queried
      const metaQuery = findCalls.find((c) => c.object === 'sys_metadata');
      expect(metaQuery).toBeDefined();
      expect(metaQuery!.query.where).toEqual({ state: 'active', organization_id: null });

      // Assert — items should be restored into the registry
      const registry = (kernel.getService('objectql') as any).registry;
      expect(registry.getAllApps()).toContainEqual({
        name: 'custom_crm',
        label: 'Custom CRM',
      });
    });

    // A driver that serves one runtime-created object (with inline fields)
    // from sys_metadata — models an isolated, proxy-free project kernel.
    const makeLocalMetadataDriver = (findCalls: Array<{ object: string; query?: any }>) => ({
      name: 'local-meta-driver',
      version: '1.0.0',
      connect: async () => {},
      disconnect: async () => {},
      find: async (object: string, query?: any) => {
        findCalls.push({ object, query });
        if (object === 'sys_metadata') {
          // Honour a type filter (the authored-hook resync queries
          // type='hook'); the object-hydration path queries without one.
          const typeFilter = query?.where?.type;
          if (typeFilter !== undefined && typeFilter !== 'object') return [];
          return [
            {
              id: '1',
              type: 'object',
              name: 'product',
              state: 'active',
              metadata: JSON.stringify({
                name: 'product',
                label: 'Product',
                fields: { sku: { name: 'sku', label: 'SKU', type: 'text' } },
              }),
              packageId: 'inventory_pkg',
            },
          ];
        }
        return [];
      },
      findOne: async () => null,
      create: async (_o: string, d: any) => d,
      update: async (_o: string, _i: any, d: any) => d,
      delete: async () => true,
      syncSchema: async () => {},
    });

    it('does NOT hydrate a project kernel (environmentId set) without the opt-in', async () => {
      // Default behavior: a project kernel sources metadata from the artifact /
      // control-plane proxy, so boot must not hydrate OBJECTS from a local
      // sys_metadata. The only permitted boot reads are the runtime-authored
      // re-syncs: hooks (#2588, type='hook') and actions (#2605 —
      // type='action' plus type='object' rows scanned ONLY to extract their
      // embedded `actions[]`). Neither registers objects — the registry
      // assertion below pins that.
      const findCalls: Array<{ object: string; query?: any }> = [];
      await kernel.use({
        name: 'mock-noopt-driver',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => ctx.registerService('driver.noopt', makeLocalMetadataDriver(findCalls)),
      });

      const plugin = new ObjectQLPlugin({ environmentId: 'env_1' });
      await kernel.use(plugin);
      await kernel.bootstrap();

      const metaReads = findCalls.filter((c) => c.object === 'sys_metadata');
      for (const read of metaReads) {
        expect(read.query?.where?.type).toMatch(/^(hooks?|actions?|object)$/);
      }
      const registry = (kernel.getService('objectql') as any).registry;
      expect(registry.getObject('product')).toBeUndefined();
    });

    it('hydrates a project kernel from local sys_metadata when hydrateMetadataFromDb is set (runtime objects regain their fields)', async () => {
      // The single-env tenant runtime case: an isolated, proxy-free kernel that
      // persists its OWN sys_metadata. Objects created at runtime (here:
      // `product`, not in any boot manifest) must re-enter the registry WITH
      // their fields after a restart — otherwise registry.getObject('product')
      // is empty and the engine.find unknown-$select guard can't fire.
      const findCalls: Array<{ object: string }> = [];
      await kernel.use({
        name: 'mock-opt-driver',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => ctx.registerService('driver.opt', makeLocalMetadataDriver(findCalls)),
      });

      const plugin = new ObjectQLPlugin({ environmentId: 'env_1', hydrateMetadataFromDb: true });
      await kernel.use(plugin);
      await kernel.bootstrap();

      expect(findCalls.find((c) => c.object === 'sys_metadata')).toBeDefined();
      const registry = (kernel.getService('objectql') as any).registry;
      const product = registry.getObject('product') as any;
      expect(product).toBeDefined();
      expect(product.fields).toBeDefined();
      expect(Object.keys(product.fields)).toContain('sku');
    });

    it('should not throw when protocol.loadMetaFromDb fails (graceful degradation)', async () => {
      // Arrange — driver that throws on find('sys_metadata')
      const mockDriver = {
        name: 'failing-db-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async (object: string) => {
          if (object === 'sys_metadata') {
            throw new Error('SQLITE_ERROR: no such table: sys_metadata');
          }
          return [];
        },
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async () => {},
      };

      await kernel.use({
        name: 'mock-fail-driver',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.faildb', mockDriver);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act & Assert — should not throw
      await expect(kernel.bootstrap()).resolves.not.toThrow();
    });

    it('should restore metadata before syncRegisteredSchemas so restored objects get table sync', async () => {
      // Arrange — track the order of operations
      const operations: string[] = [];
      const mockDriver = {
        name: 'order-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async (object: string) => {
          if (object === 'sys_metadata') {
            operations.push('loadMetaFromDb');
            return [
              {
                id: '1',
                type: 'object',
                name: 'restored_obj',
                state: 'active',
                metadata: JSON.stringify({
                  name: 'restored_obj',
                  label: 'Restored Object',
                  fields: { title: { name: 'title', label: 'Title', type: 'text' } },
                }),
                packageId: 'user_pkg',
              },
            ];
          }
          return [];
        },
        findOne: async () => null,
        create: async (_o: string, d: any) => d,
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async (object: string) => {
          operations.push(`syncSchema:${object}`);
        },
      };

      await kernel.use({
        name: 'mock-order-driver',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.order', mockDriver);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);

      // Act
      await kernel.bootstrap();

      // Assert — the RESTORED object must be synced AFTER it was hydrated from
      // sys_metadata, so its table exists. (The built-in metadata-storage
      // objects — sys_metadata, … — are registered up-front by ObjectQLPlugin
      // and synced in the FIRST pass, i.e. before loadMetaFromDb; only the
      // DB-restored custom objects depend on the post-hydration second pass.)
      const loadIdx = operations.indexOf('loadMetaFromDb');
      expect(loadIdx).toBeGreaterThanOrEqual(0);

      const restoredSyncIdx = operations.indexOf('syncSchema:restored_obj');
      expect(restoredSyncIdx).toBeGreaterThan(loadIdx);
    });
  });

  describe('Audit Hook Field Awareness', () => {
    /**
     * Regression: the built-in `sys_stamp_audit_insert` hook used to
     * blindly stamp `created_by`/`updated_by`/`tenant_id` on every insert,
     * which produced `SQLITE_ERROR: table X has no column named created_by`
     * when the object schema did not declare those audit fields. The hook
     * must only stamp values for fields the user has explicitly declared.
     */
    it('should NOT stamp created_by/updated_by/tenant_id when the schema does not declare them', async () => {
      const captured: Record<string, any>[] = [];
      const mockDriver = {
        name: 'capture-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => {
          captured.push({ ...d });
          return { id: 'rec-1', ...d };
        },
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async () => {},
      };

      await kernel.use({
        name: 'capture-driver-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.capture', mockDriver);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);
      await kernel.bootstrap();

      const objectql = kernel.getService('objectql') as any;
      // Opt out of auto-injected system fields so the schema authentically
      // does NOT declare created_by/updated_by/tenant_id — exercising the
      // original regression guard. (Without `systemFields:false` the
      // registry auto-injects audit fields and the hook correctly stamps
      // them; that's covered by the sibling test below.)
      const lite: ObjectSchema = {
        name: 'lite_lead',
        label: 'Lite Lead',
        datasource: 'capture-driver',
        systemFields: false,
        fields: {
          first_name: { name: 'first_name', label: 'First Name', type: 'text' },
        },
      } as any;
      objectql.registry.registerObject(lite, 'test', 'test');

      await objectql.insert(
        'lite_lead',
        { first_name: 'xxx' },
        { context: { userId: 'user-1', tenantId: 'org-1' } },
      );

      expect(captured.length).toBe(1);
      const row = captured[0];
      expect(row.first_name).toBe('xxx');
      expect(row).not.toHaveProperty('created_by');
      expect(row).not.toHaveProperty('updated_by');
      expect(row).not.toHaveProperty('tenant_id');
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    });

    it('should stamp created_by/updated_by/tenant_id when the schema declares them', async () => {
      const captured: Record<string, any>[] = [];
      const mockDriver = {
        name: 'capture-driver-2',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        find: async () => [],
        findOne: async () => null,
        create: async (_o: string, d: any) => {
          captured.push({ ...d });
          return { id: 'rec-1', ...d };
        },
        update: async (_o: string, _i: any, d: any) => d,
        delete: async () => true,
        syncSchema: async () => {},
      };

      await kernel.use({
        name: 'capture-driver-2-plugin',
        type: 'driver',
        version: '1.0.0',
        init: async (ctx) => {
          ctx.registerService('driver.capture-driver-2', mockDriver);
        },
      });

      const plugin = new ObjectQLPlugin();
      await kernel.use(plugin);
      await kernel.bootstrap();

      const objectql = kernel.getService('objectql') as any;
      const audited: ObjectSchema = {
        name: 'audited_obj',
        label: 'Audited Obj',
        datasource: 'capture-driver-2',
        fields: {
          name: { name: 'name', label: 'Name', type: 'text' },
          created_by: { name: 'created_by', label: 'Created By', type: 'text' },
          updated_by: { name: 'updated_by', label: 'Updated By', type: 'text' },
          tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'text' },
        },
      };
      objectql.registry.registerObject(audited, 'test', 'test');

      await objectql.insert(
        'audited_obj',
        { name: 'a' },
        { context: { userId: 'user-42', tenantId: 'org-7' } },
      );

      expect(captured.length).toBe(1);
      const row = captured[0];
      expect(row.created_by).toBe('user-42');
      expect(row.updated_by).toBe('user-42');
      expect(row.tenant_id).toBe('org-7');
    });
  });
});
