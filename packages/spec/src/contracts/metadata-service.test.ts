import { describe, it, expect } from 'vitest';
import type { IMetadataService, MetadataWatchCallback, MetadataWatchHandle, MetadataTypeInfo, ApiEndpointMatch } from './metadata-service';
import { ApiEndpointSchema, type ApiEndpoint } from '../api/endpoint.zod';

describe('Metadata Service Contract', () => {
  it('should allow a minimal IMetadataService implementation with required methods', () => {
    const service: IMetadataService = {
      register: async (_type, _name, _data) => {},
      get: async (_type, _name) => undefined,
      list: async (_type) => [],
      unregister: async (_type, _name) => {},
      exists: async (_type, _name) => false,
      listNames: async (_type) => [],
      getObject: async (_name) => undefined,
      listObjects: async () => [],
    };

    expect(typeof service.register).toBe('function');
    expect(typeof service.get).toBe('function');
    expect(typeof service.list).toBe('function');
    expect(typeof service.unregister).toBe('function');
    expect(typeof service.exists).toBe('function');
    expect(typeof service.listNames).toBe('function');
    expect(typeof service.getObject).toBe('function');
    expect(typeof service.listObjects).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      unregisterPackage: async (_packageName) => {},
    };

    expect(service.unregisterPackage).toBeDefined();
  });

  it('should register and retrieve metadata items asynchronously', async () => {
    const store = new Map<string, Map<string, unknown>>();

    const service: IMetadataService = {
      register: async (type, name, data) => {
        if (!store.has(type)) store.set(type, new Map());
        store.get(type)!.set(name, data);
      },
      get: async (type, name) => store.get(type)?.get(name),
      list: async (type) => Array.from(store.get(type)?.values() ?? []),
      unregister: async (type, name) => { store.get(type)?.delete(name); },
      exists: async (type, name) => store.get(type)?.has(name) ?? false,
      listNames: async (type) => Array.from(store.get(type)?.keys() ?? []),
      getObject: async (name) => store.get('object')?.get(name),
      listObjects: async () => Array.from(store.get('object')?.values() ?? []),
    };

    const objectDef = { name: 'account', label: 'Account', fields: {} };
    await service.register('object', 'account', objectDef);

    expect(await service.get('object', 'account')).toEqual(objectDef);
    expect(await service.getObject('account')).toEqual(objectDef);
    expect(await service.listObjects()).toHaveLength(1);
    expect(await service.exists('object', 'account')).toBe(true);
    expect(await service.listNames('object')).toEqual(['account']);

    await service.unregister('object', 'account');
    expect(await service.get('object', 'account')).toBeUndefined();
    expect(await service.exists('object', 'account')).toBe(false);
  });

  it('should list items by type', async () => {
    const store = new Map<string, Map<string, unknown>>();

    const service: IMetadataService = {
      register: async (type, name, data) => {
        if (!store.has(type)) store.set(type, new Map());
        store.get(type)!.set(name, data);
      },
      get: async (type, name) => store.get(type)?.get(name),
      list: async (type) => Array.from(store.get(type)?.values() ?? []),
      unregister: async (type, name) => { store.get(type)?.delete(name); },
      exists: async (type, name) => store.get(type)?.has(name) ?? false,
      listNames: async (type) => Array.from(store.get(type)?.keys() ?? []),
      getObject: async (name) => store.get('object')?.get(name),
      listObjects: async () => Array.from(store.get('object')?.values() ?? []),
    };

    await service.register('object', 'account', { name: 'account', label: 'Account' });
    await service.register('object', 'contact', { name: 'contact', label: 'Contact' });
    await service.register('view', 'account_list', { name: 'account_list', label: 'Account List' });

    expect(await service.list('object')).toHaveLength(2);
    expect(await service.list('view')).toHaveLength(1);
    expect(await service.list('flow')).toHaveLength(0);
    expect(await service.listNames('object')).toEqual(['account', 'contact']);
  });

  // ==========================================
  // Extended Contract Tests
  // ==========================================

  it('should allow implementation with query support', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      query: async (_query) => ({
        items: [{ type: 'object', name: 'account' }],
        total: 1,
        page: 1,
        pageSize: 50,
      }),
    };

    const result = await service.query!({ types: ['object'], search: 'account' });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('should allow implementation with bulk operations', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      bulkRegister: async (items) => ({
        total: items.length,
        succeeded: items.length,
        failed: 0,
      }),
      bulkUnregister: async (items) => ({
        total: items.length,
        succeeded: items.length,
        failed: 0,
      }),
    };

    const result = await service.bulkRegister!([
      { type: 'object', name: 'account', data: { label: 'Account' } },
      { type: 'object', name: 'contact', data: { label: 'Contact' } },
    ]);
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
  });

  // (The `overlay management` implementation case left with the optional
  // `getOverlay` / `saveOverlay` / `removeOverlay` / `getEffective` members —
  // #13135, ADR-0049: they belonged to the paper customization protocol no
  // route ever served.)

  it('should allow implementation with watch support', () => {
    const callbacks: MetadataWatchCallback[] = [];

    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      watch: (type, callback) => {
        callbacks.push(callback);
        const handle: MetadataWatchHandle = {
          unsubscribe: () => {
            const idx = callbacks.indexOf(callback);
            if (idx >= 0) callbacks.splice(idx, 1);
          },
        };
        return handle;
      },
    };

    const handle = service.watch!('object', (_event) => {});
    expect(callbacks).toHaveLength(1);
    handle.unsubscribe();
    expect(callbacks).toHaveLength(0);
  });

  it('should allow implementation with import/export', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      exportMetadata: async () => ({ version: '1.0', items: [] }),
      importMetadata: async (_data, _options) => ({
        total: 3,
        imported: 2,
        skipped: 1,
        failed: 0,
      }),
    };

    const bundle = await service.exportMetadata!({ types: ['object'] });
    expect(bundle).toBeDefined();

    const result = await service.importMetadata!(bundle, { conflictResolution: 'merge' });
    expect(result.total).toBe(3);
    expect(result.imported).toBe(2);
  });

  it('should allow implementation with validation', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      validate: async (_type, _data) => ({
        valid: false,
        errors: [{ path: 'name', message: 'Name is required' }],
      }),
    };

    const result = await service.validate!('object', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should allow implementation with type registry', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      getRegisteredTypes: async () => ['object', 'view', 'flow', 'app'],
      getTypeInfo: async (type) => {
        if (type === 'object') {
          const info: MetadataTypeInfo = {
            type: 'object',
            label: 'Object',
            filePatterns: ['**/*.object.ts'],
            supportsOverlay: true,
            domain: 'data',
          };
          return info;
        }
        return undefined;
      },
    };

    const types = await service.getRegisteredTypes!();
    expect(types).toContain('object');
    expect(types).toContain('view');

    const info = await service.getTypeInfo!('object');
    expect(info?.label).toBe('Object');
    expect(info?.domain).toBe('data');

    const unknown = await service.getTypeInfo!('unknown');
    expect(unknown).toBeUndefined();
  });

  it('should allow implementation with dependency tracking', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      getDependencies: async (_type, _name) => [
        { sourceType: 'view', sourceName: 'account_list', targetType: 'object', targetName: 'account', kind: 'reference' },
      ],
      getDependents: async (_type, _name) => [
        { sourceType: 'view', sourceName: 'account_list', targetType: 'object', targetName: 'account', kind: 'reference' },
        { sourceType: 'dashboard', sourceName: 'crm_dashboard', targetType: 'object', targetName: 'account', kind: 'reference' },
      ],
    };

    const deps = await service.getDependencies!('view', 'account_list');
    expect(deps).toHaveLength(1);
    expect(deps[0].targetType).toBe('object');

    const dependents = await service.getDependents!('object', 'account');
    expect(dependents).toHaveLength(2);
  });

  it('should allow a complete full-featured implementation', () => {
    const service: IMetadataService = {
      // Core CRUD
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      // Package
      unregisterPackage: async () => {},
      publishPackage: async () => ({
        success: true,
        packageId: 'test',
        version: 1,
        publishedAt: new Date().toISOString(),
        itemsPublished: 0,
      }),
      revertPackage: async () => {},
      getPublished: async () => undefined,
      // Query
      query: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      // Bulk
      bulkRegister: async () => ({ total: 0, succeeded: 0, failed: 0 }),
      bulkUnregister: async () => ({ total: 0, succeeded: 0, failed: 0 }),
      // Watch
      watch: () => ({ unsubscribe: () => {} }),
      // Import/Export
      exportMetadata: async () => ({}),
      importMetadata: async () => ({ total: 0, imported: 0, skipped: 0, failed: 0 }),
      // Validation
      validate: async () => ({ valid: true }),
      // Type Registry
      getRegisteredTypes: async () => [],
      getTypeInfo: async () => undefined,
      // Dependencies
      getDependencies: async () => [],
      getDependents: async () => [],
    };

    // Verify all methods exist
    expect(typeof service.register).toBe('function');
    expect(typeof service.query).toBe('function');
    expect(typeof service.bulkRegister).toBe('function');
    expect(typeof service.watch).toBe('function');
    expect(typeof service.exportMetadata).toBe('function');
    expect(typeof service.validate).toBe('function');
    expect(typeof service.getRegisteredTypes).toBe('function');
    expect(typeof service.getDependencies).toBe('function');
    expect(typeof service.publishPackage).toBe('function');
    expect(typeof service.revertPackage).toBe('function');
    expect(typeof service.getPublished).toBe('function');
  });

  it('should allow implementation with package publish support', async () => {
    const service: IMetadataService = {
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
      publishPackage: async (packageId, options) => ({
        success: true,
        packageId,
        version: 2,
        publishedAt: new Date().toISOString(),
        itemsPublished: 3,
      }),
      revertPackage: async () => {},
      getPublished: async (_type, _name) => ({ name: 'account', label: 'Account' }),
    };

    const result = await service.publishPackage!('com.acme.crm', { publishedBy: 'admin' });
    expect(result.success).toBe(true);
    expect(result.packageId).toBe('com.acme.crm');
    expect(result.version).toBe(2);
    expect(result.itemsPublished).toBe(3);

    const published = await service.getPublished!('object', 'account');
    expect(published).toEqual({ name: 'account', label: 'Account' });
  });

  // ==========================================
  // API Endpoint Resolution (#5040 E1)
  // ==========================================

  describe('matchEndpoint (optional member)', () => {
    /** A minimal base implementation with only the REQUIRED members. */
    const baseService = (): IMetadataService => ({
      register: async () => {},
      get: async () => undefined,
      list: async () => [],
      unregister: async () => {},
      exists: async () => false,
      listNames: async () => [],
      getObject: async () => undefined,
      listObjects: async () => [],
    });

    /** An author-written `api` item that OMITS the `authRequired` default. */
    const authoredEndpoint = {
      name: 'showcase_tasks',
      path: '/api/v1/apps/showcase/tasks',
      method: 'GET',
      type: 'object_operation',
      target: 'showcase_task',
      objectParams: { object: 'showcase_task', operation: 'find' },
    };

    it('is optional — an implementation without it still satisfies the contract', () => {
      const service = baseService();

      // The whole point of the optional-member convention: consumers probe.
      expect(typeof service.matchEndpoint).toBe('undefined');
      expect(typeof (service as IMetadataService).matchEndpoint === 'function').toBe(false);
    });

    it('is probeable with typeof === "function" when provided', () => {
      const service: IMetadataService = {
        ...baseService(),
        matchEndpoint: async () => undefined,
      };

      expect(typeof service.matchEndpoint).toBe('function');
    });

    it('resolves method+path to a match, and undefined on a miss', async () => {
      const parsed = ApiEndpointSchema.parse(authoredEndpoint);

      const service: IMetadataService = {
        ...baseService(),
        matchEndpoint: async ({ path, method }) =>
          method.toUpperCase() === parsed.method && path === parsed.path
            ? { endpoint: parsed, params: {} }
            : undefined,
      };

      const hit = await service.matchEndpoint!({
        path: '/api/v1/apps/showcase/tasks',
        method: 'get',
      });
      expect(hit).toBeDefined();
      expect(hit!.endpoint.name).toBe('showcase_tasks');

      const miss = await service.matchEndpoint!({
        path: '/api/v1/apps/showcase/nope',
        method: 'GET',
      });
      expect(miss).toBeUndefined();
    });

    it('returns the ApiEndpointSchema.parse-d shape — schema defaults materialized', async () => {
      // The author never wrote `authRequired`; the contract says a consumer
      // must never see "absent" for it.
      expect('authRequired' in authoredEndpoint).toBe(false);

      const service: IMetadataService = {
        ...baseService(),
        matchEndpoint: async () => ({
          endpoint: ApiEndpointSchema.parse(authoredEndpoint),
          params: {},
        }),
      };

      const match = await service.matchEndpoint!({
        path: '/api/v1/apps/showcase/tasks',
        method: 'GET',
      });

      expect(match!.endpoint.authRequired).toBe(true);
      expect(typeof match!.endpoint.authRequired).toBe('boolean');
    });

    it('params is always {} in 17.x — the slot is reserved, no template syntax', async () => {
      const service: IMetadataService = {
        ...baseService(),
        matchEndpoint: async () => ({
          endpoint: ApiEndpointSchema.parse(authoredEndpoint),
          params: {},
        }),
      };

      const match = await service.matchEndpoint!({
        path: '/api/v1/apps/showcase/tasks',
        method: 'GET',
      });

      expect(match!.params).toEqual({});
    });

    it('ApiEndpointMatch types endpoint as ApiEndpoint and params as Record< string, string >', () => {
      // Type-level shape assertion: the literal only compiles against the
      // declared member types.
      const match: ApiEndpointMatch = {
        endpoint: ApiEndpointSchema.parse(authoredEndpoint),
        params: {},
      };

      const endpoint: ApiEndpoint = match.endpoint;
      const params: Record<string, string> = match.params;

      expect(endpoint.path).toBe('/api/v1/apps/showcase/tasks');
      expect(params).toEqual({});
    });
  });
});
