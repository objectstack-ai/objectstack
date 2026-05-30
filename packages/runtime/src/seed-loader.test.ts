// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { SeedLoaderRequest, SeedLoaderConfig } from '@objectstack/spec/data';

// ==========================================================================
// Mock Helpers
// ==========================================================================

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockEngine(data: Record<string, any[]> = {}): IDataEngine {
  const store: Record<string, any[]> = {};
  for (const [key, records] of Object.entries(data)) {
    store[key] = records.map((r, i) => ({ id: r.id || `id-${key}-${i}`, ...r }));
  }
  let idCounter = 0;

  return {
    find: vi.fn(async (objectName: string, query?: any) => {
      const records = store[objectName] || [];
      if (query?.filter) {
        return records.filter(r => {
          for (const [k, v] of Object.entries(query.filter)) {
            if (r[k] !== v) return false;
          }
          return true;
        });
      }
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      const results = await (store[objectName] || []);
      return results[0] || null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      const records = store[objectName] || [];
      const idx = records.findIndex(r => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  };
}

function createMockMetadata(objects: Record<string, any> = {}): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => objects[name] || undefined),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (type: string, name: string) => objects[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  };
}

// ==========================================================================
// Tests
// ==========================================================================

describe('SeedLoaderService', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  // ========================================================================
  // buildDependencyGraph
  // ========================================================================

  describe('buildDependencyGraph', () => {
    it('should build an empty graph for objects with no references', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        product: { name: 'product', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['account', 'product']);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.insertOrder).toEqual(expect.arrayContaining(['account', 'product']));
      expect(graph.circularDependencies).toEqual([]);
    });

    it('should detect lookup dependencies', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['account', 'contact']);

      expect(graph.nodes.find(n => n.object === 'contact')?.dependsOn).toEqual(['account']);
      // account should come before contact
      const accountIdx = graph.insertOrder.indexOf('account');
      const contactIdx = graph.insertOrder.indexOf('contact');
      expect(accountIdx).toBeLessThan(contactIdx);
    });

    it('should detect master_detail dependencies', async () => {
      const metadata = createMockMetadata({
        project: { name: 'project', fields: { name: { type: 'text' } } },
        task: {
          name: 'task',
          fields: {
            name: { type: 'text' },
            environment_id: { type: 'master_detail', reference: 'project' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['project', 'task']);

      const taskNode = graph.nodes.find(n => n.object === 'task');
      expect(taskNode?.references[0].fieldType).toBe('master_detail');
      expect(graph.insertOrder.indexOf('project')).toBeLessThan(graph.insertOrder.indexOf('task'));
    });

    it('should detect circular dependencies', async () => {
      const metadata = createMockMetadata({
        employee: {
          name: 'employee',
          fields: {
            name: { type: 'text' },
            manager_id: { type: 'lookup', reference: 'employee' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['employee']);

      // Self-referencing should still be in insertOrder
      expect(graph.insertOrder).toContain('employee');
    });

    it('should detect cross-object circular dependencies', async () => {
      const metadata = createMockMetadata({
        department: {
          name: 'department',
          fields: {
            name: { type: 'text' },
            head_id: { type: 'lookup', reference: 'employee' },
          },
        },
        employee: {
          name: 'employee',
          fields: {
            name: { type: 'text' },
            department_id: { type: 'lookup', reference: 'department' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['department', 'employee']);

      expect(graph.circularDependencies.length).toBeGreaterThan(0);
      expect(graph.insertOrder).toContain('department');
      expect(graph.insertOrder).toContain('employee');
    });

    it('should handle multi-level dependency chains', async () => {
      const metadata = createMockMetadata({
        org: { name: 'org', fields: { name: { type: 'text' } } },
        department: {
          name: 'department',
          fields: {
            name: { type: 'text' },
            org_id: { type: 'lookup', reference: 'org' },
          },
        },
        employee: {
          name: 'employee',
          fields: {
            name: { type: 'text' },
            department_id: { type: 'lookup', reference: 'department' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['org', 'department', 'employee']);

      const orgIdx = graph.insertOrder.indexOf('org');
      const deptIdx = graph.insertOrder.indexOf('department');
      const empIdx = graph.insertOrder.indexOf('employee');
      expect(orgIdx).toBeLessThan(deptIdx);
      expect(deptIdx).toBeLessThan(empIdx);
    });

    it('should ignore references to objects not in the graph for dependency ordering', async () => {
      const metadata = createMockMetadata({
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      // 'account' is not included in graph
      const graph = await loader.buildDependencyGraph(['contact']);

      // dependsOn should be empty (account not in graph)
      expect(graph.nodes[0].dependsOn).toEqual([]);
      // But references should still be tracked (for DB resolution)
      expect(graph.nodes[0].references).toHaveLength(1);
      expect(graph.nodes[0].references[0].targetObject).toBe('account');
      expect(graph.insertOrder).toEqual(['contact']);
    });

    it('should handle objects with no metadata', async () => {
      const metadata = createMockMetadata({});
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const graph = await loader.buildDependencyGraph(['unknown_object']);

      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0].dependsOn).toEqual([]);
      expect(graph.insertOrder).toEqual(['unknown_object']);
    });
  });

  // ========================================================================
  // load — basic operations
  // ========================================================================

  describe('load — basic operations', () => {
    it('should insert records for a single object with no references', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme Corp' }, { name: 'Globex' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.totalInserted).toBe(2);
      expect(result.summary.objectsProcessed).toBe(1);
      expect(engine.insert).toHaveBeenCalledTimes(2);
    });

    it('should return empty result for no datasets', async () => {
      const metadata = createMockMetadata({});
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.totalRecords).toBe(0);
    });

    it('should handle environment filtering', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        demo_data: { name: 'demo_data', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
          { object: 'demo_data', externalId: 'name', mode: 'upsert', env: ['dev'], records: [{ name: 'Demo' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
          env: 'prod',
        },
      });

      // Only 'account' should be loaded (env: ['prod','dev','test'])
      // 'demo_data' has env: ['dev'] which doesn't include 'prod'
      expect(result.summary.objectsProcessed).toBe(1);
      expect(result.summary.totalInserted).toBe(1);
    });
  });

  // ========================================================================
  // load — reference resolution
  // ========================================================================

  describe('load — reference resolution', () => {
    it('should resolve lookup references via externalId', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme Corp' }] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'Acme Corp' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.totalReferencesResolved).toBe(1);

      // The contact insert should have resolved account_id
      const contactInsertCall = (engine.insert as any).mock.calls.find(
        (c: any[]) => c[0] === 'contact'
      );
      expect(contactInsertCall).toBeDefined();
      // account_id should be resolved to the generated ID, not 'Acme Corp'
      expect(contactInsertCall[1].account_id).not.toBe('Acme Corp');
    });

    it('should skip reference resolution for null/undefined values', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: null }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.totalReferencesResolved).toBe(0);
    });

    it('should skip reference resolution for values that look like UUIDs', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = await loader.load({
        datasets: [
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: uuid }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      // UUID should be passed through without resolution
      const insertCall = (engine.insert as any).mock.calls.find(
        (c: any[]) => c[0] === 'contact'
      );
      expect(insertCall[1].account_id).toBe(uuid);
    });

    it('should resolve references from the database if not found in inserted records', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      // Pre-seed accounts in the mock engine
      const engine = createMockEngine({
        account: [{ id: 'existing-acme-id', name: 'Acme Corp' }],
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      // Only load contacts (accounts already exist)
      const result = await loader.load({
        datasets: [
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'Acme Corp' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary.totalReferencesResolved).toBe(1);
      // The insert call should have the resolved ID
      const insertCall = (engine.insert as any).mock.calls.find(
        (c: any[]) => c[0] === 'contact'
      );
      expect(insertCall[1].account_id).toBe('existing-acme-id');
    });

    it('should report errors for unresolvable references when multiPass is false', async () => {
      const metadata = createMockMetadata({
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'NonExistent' }] },
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: false,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].sourceObject).toBe('contact');
      expect(result.errors[0].field).toBe('account_id');
      expect(result.errors[0].attemptedValue).toBe('NonExistent');
    });
  });

  // ========================================================================
  // load — multi-pass (circular dependencies)
  // ========================================================================

  describe('load — multi-pass loading', () => {
    it('should defer references for circular dependencies and resolve in pass 2', async () => {
      const metadata = createMockMetadata({
        department: {
          name: 'department',
          fields: {
            name: { type: 'text' },
            head_id: { type: 'lookup', reference: 'employee' },
          },
        },
        employee: {
          name: 'employee',
          fields: {
            name: { type: 'text' },
            department_id: { type: 'lookup', reference: 'department' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'department', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Engineering', head_id: 'Alice' }] },
          { object: 'employee', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Alice', department_id: 'Engineering' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      // Both objects should be inserted
      expect(result.summary.totalInserted).toBe(2);
      // References should be deferred then resolved
      expect(result.summary.totalReferencesResolved).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // load — upsert mode
  // ========================================================================

  describe('load — upsert mode', () => {
    it('should update existing records instead of inserting duplicates', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' }, status: { type: 'text' } } },
      });
      const engine = createMockEngine({
        account: [{ id: 'acc-1', name: 'Acme Corp', status: 'active' }],
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'account', externalId: 'name', mode: 'upsert',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'Acme Corp', status: 'inactive' }],
          },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary.totalUpdated).toBe(1);
      expect(result.summary.totalInserted).toBe(0);
      expect(engine.update).toHaveBeenCalled();
    });

    it('should insert new records in upsert mode', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine({ account: [] });
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'account', externalId: 'name', mode: 'upsert',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'New Corp' }],
          },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary.totalInserted).toBe(1);
      expect(result.summary.totalUpdated).toBe(0);
    });

    it('should skip existing records in ignore mode', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine({
        account: [{ id: 'acc-1', name: 'Acme Corp' }],
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'account', externalId: 'name', mode: 'ignore',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'Acme Corp' }, { name: 'New Corp' }],
          },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary.totalSkipped).toBe(1);
      expect(result.summary.totalInserted).toBe(1);
    });

    it('should only update existing records in update mode', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' }, status: { type: 'text' } } },
      });
      const engine = createMockEngine({
        account: [{ id: 'acc-1', name: 'Acme Corp', status: 'active' }],
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'account', externalId: 'name', mode: 'update',
            env: ['prod', 'dev', 'test'],
            records: [
              { name: 'Acme Corp', status: 'inactive' },
              { name: 'Unknown Corp', status: 'new' },
            ],
          },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary.totalUpdated).toBe(1);
      expect(result.summary.totalSkipped).toBe(1);
      expect(result.summary.totalInserted).toBe(0);
    });
  });

  // ========================================================================
  // load — dry-run mode
  // ========================================================================

  describe('load — dry-run mode', () => {
    it('should not write any data in dry-run mode', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
        ],
        config: {
          dryRun: true, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.dryRun).toBe(true);
      expect(engine.insert).not.toHaveBeenCalled();
      expect(engine.update).not.toHaveBeenCalled();
    });

    it('should detect reference errors in dry-run mode', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'NonExistent' }] },
        ],
        config: {
          dryRun: true, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      // Should report unresolvable reference
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].attemptedValue).toBe('NonExistent');
    });

    it('should succeed in dry-run when references resolve correctly', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'Acme' }] },
        ],
        config: {
          dryRun: true, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ========================================================================
  // load — halt on error
  // ========================================================================

  describe('load — haltOnError', () => {
    it('should stop processing on first error when haltOnError is true', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: { name: 'contact', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      // Make insert throw for account
      (engine.insert as any).mockImplementationOnce(async () => {
        throw new Error('DB error');
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John' }] },
        ],
        config: {
          dryRun: false, haltOnError: true, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      // Should process account (with error) then stop
      expect(result.summary.totalErrored).toBe(1);
      // Contact should not have been processed
      expect(result.summary.objectsProcessed).toBe(1);
    });
  });

  // ========================================================================
  // load — dependency ordering
  // ========================================================================

  describe('load — dependency ordering', () => {
    it('should insert parent objects before child objects regardless of dataset order', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const insertOrder: string[] = [];
      const engine = createMockEngine();
      let idCounter = 0;
      (engine.insert as any).mockImplementation(async (objectName: string, data: any) => {
        insertOrder.push(objectName);
        return { id: `gen-${++idCounter}`, ...data };
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      // Deliberately put contact before account
      await loader.load({
        datasets: [
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'Acme' }] },
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      // Account should be inserted before contact
      expect(insertOrder.indexOf('account')).toBeLessThan(insertOrder.indexOf('contact'));
    });
  });

  // ========================================================================
  // load — error reporting
  // ========================================================================

  describe('load — error reporting', () => {
    it('should produce actionable error messages', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: 'MissingAccount' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: false,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.errors).toHaveLength(1);
      const error = result.errors[0];
      expect(error.sourceObject).toBe('contact');
      expect(error.field).toBe('account_id');
      expect(error.targetObject).toBe('account');
      expect(error.targetField).toBe('name');
      expect(error.attemptedValue).toBe('MissingAccount');
      expect(error.recordIndex).toBe(0);
      expect(error.message).toContain('Cannot resolve reference');
      expect(error.message).toContain('contact.account_id');
      expect(error.message).toContain('MissingAccount');
    });

    it('should include per-object error details in results', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [] },
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [
            { name: 'John', account_id: 'Missing1' },
            { name: 'Jane', account_id: 'Missing2' },
          ]},
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: false,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      const contactResult = result.results.find(r => r.object === 'contact');
      expect(contactResult?.errors).toHaveLength(2);
      expect(contactResult?.errors[0].recordIndex).toBe(0);
      expect(contactResult?.errors[1].recordIndex).toBe(1);
    });
  });

  // ========================================================================
  // validate
  // ========================================================================

  describe('validate', () => {
    it('should run in dry-run mode', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.validate([
        { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
      ]);

      expect(result.dryRun).toBe(true);
      expect(engine.insert).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // load — result structure
  // ========================================================================

  describe('load — result structure', () => {
    it('should include dependency graph in result', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.dependencyGraph).toBeDefined();
      expect(result.dependencyGraph.nodes).toHaveLength(1);
      expect(result.dependencyGraph.insertOrder).toEqual(['account']);
    });

    it('should include complete summary statistics', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'A' }, { name: 'B' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary).toMatchObject({
        objectsProcessed: 1,
        totalRecords: 2,
        totalInserted: 2,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        totalReferencesResolved: 0,
        totalReferencesDeferred: 0,
        circularDependencyCount: 0,
      });
      expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track durationMs', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(typeof result.summary.durationMs).toBe('number');
      expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // load — edge cases
  // ========================================================================

  describe('load — seed identity (os.user / os.org)', () => {
    // CEL Expression envelope helper — same shape the spec persists.
    const cel = (source: string) => ({ dialect: 'cel', source });

    const baseConfig = (extra: Record<string, any> = {}): SeedLoaderConfig => ({
      dryRun: false,
      haltOnError: false,
      multiPass: false,
      defaultMode: 'upsert',
      batchSize: 1000,
      transaction: false,
      ...extra,
    } as SeedLoaderConfig);

    it('resolves cel`os.user.id` from config.identity', async () => {
      const metadata = createMockMetadata({
        note: { name: 'note', fields: { name: { type: 'text' }, author: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'note',
            externalId: 'name',
            mode: 'insert',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'N1', author: cel('os.user.id') }],
          },
        ],
        config: baseConfig({
          identity: { user: { id: 'usr_system', role: 'system', email: 'system@objectstack.local' } },
        }),
      });

      expect(result.success).toBe(true);
      expect(result.summary.totalErrored).toBe(0);
      expect(engine.insert).toHaveBeenCalledWith(
        'note',
        expect.objectContaining({ name: 'N1', author: 'usr_system' }),
        expect.anything(),
      );
    });

    it('fails loudly (no raw envelope written) when os.user is unbound', async () => {
      const metadata = createMockMetadata({
        note: { name: 'note', fields: { name: { type: 'text' }, author: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'note',
            externalId: 'name',
            mode: 'insert',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'N1', author: cel('os.user.id') }],
          },
        ],
        // No identity → os.user unbound → record must be dropped, not written.
        config: baseConfig(),
      });

      expect(result.success).toBe(false);
      expect(result.summary.totalErrored).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('os.user');
      // Critically: the unresolved Expression envelope is NEVER persisted.
      expect(engine.insert).not.toHaveBeenCalled();
    });

    it('falls back os.org.id to organizationId during per-tenant replay', async () => {
      const metadata = createMockMetadata({
        note: { name: 'note', fields: { name: { type: 'text' }, org_label: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'note',
            externalId: 'name',
            mode: 'insert',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'N1', org_label: cel('os.org.id') }],
          },
        ],
        config: baseConfig({ organizationId: 'org_123' }),
      });

      expect(result.success).toBe(true);
      expect(engine.insert).toHaveBeenCalledWith(
        'note',
        expect.objectContaining({ org_label: 'org_123' }),
        expect.anything(),
      );
    });

    it('surfaces write failures in result.errors (loud, not just counted)', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      engine.insert = vi.fn(async () => {
        throw new Error('boom');
      });
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          {
            object: 'account',
            externalId: 'name',
            mode: 'insert',
            env: ['prod', 'dev', 'test'],
            records: [{ name: 'Acme' }],
          },
        ],
        config: baseConfig({ defaultMode: 'insert' }),
      });

      expect(result.success).toBe(false);
      expect(result.summary.totalErrored).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Failed to write');
    });
  });

  describe('load — edge cases', () => {
    it('should handle records with no matching externalId field', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'code', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      // Should still insert (externalId 'code' not present in record, insert path)
      expect(result.summary.totalInserted).toBe(1);
    });

    it('should handle insert errors gracefully', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
      });
      const engine = createMockEngine();
      (engine.insert as any).mockRejectedValue(new Error('Duplicate key'));
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.summary.totalErrored).toBe(1);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle multiple references on same object', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        user: { name: 'user', fields: { name: { type: 'text' } } },
        opportunity: {
          name: 'opportunity',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
            owner_id: { type: 'lookup', reference: 'user' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const result = await loader.load({
        datasets: [
          { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
          { object: 'user', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Admin' }] },
          { object: 'opportunity', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Deal', account_id: 'Acme', owner_id: 'Admin' }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.totalReferencesResolved).toBe(2);
    });

    it('should skip reference resolution for MongoDB ObjectId-like values', async () => {
      const metadata = createMockMetadata({
        account: { name: 'account', fields: { name: { type: 'text' } } },
        contact: {
          name: 'contact',
          fields: {
            name: { type: 'text' },
            account_id: { type: 'lookup', reference: 'account' },
          },
        },
      });
      const engine = createMockEngine();
      const loader = new SeedLoaderService(engine, metadata, logger);

      const objectId = '507f1f77bcf86cd799439011';
      const result = await loader.load({
        datasets: [
          { object: 'contact', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'John', account_id: objectId }] },
        ],
        config: {
          dryRun: false, haltOnError: false, multiPass: true,
          defaultMode: 'upsert', batchSize: 1000, transaction: false,
        },
      });

      const insertCall = (engine.insert as any).mock.calls[0];
      expect(insertCall[1].account_id).toBe(objectId);
    });
  });
});
