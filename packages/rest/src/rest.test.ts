// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RouteManager, RouteGroupBuilder } from './route-manager';
import { RestServer, mapDataError } from './rest-server';
import { createRestApiPlugin } from './rest-api-plugin';
import type { RestApiPluginConfig } from './rest-api-plugin';

// ---------------------------------------------------------------------------
// Mocks & Helpers
// ---------------------------------------------------------------------------

/** Minimal IHttpServer mock */
function createMockServer() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/** Minimal ObjectStackProtocol mock */
function createMockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({
      version: 'v0',
      endpoints: { data: '', metadata: '', ui: '', auth: '/auth' },
    }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    getMetaItemCached: undefined as any,
    saveMetaItem: undefined as any,
    getUiView: undefined as any,
    findData: vi.fn().mockResolvedValue([]),
    getData: vi.fn().mockResolvedValue({}),
    createData: vi.fn().mockResolvedValue({ id: '1' }),
    cloneData: vi.fn().mockResolvedValue({ object: 'account', id: '2', sourceId: '1', record: { id: '2' } }),
    updateData: vi.fn().mockResolvedValue({}),
    deleteData: vi.fn().mockResolvedValue({ success: true }),
    batchData: undefined as any,
    createManyData: undefined as any,
    updateManyData: undefined as any,
    deleteManyData: undefined as any,
  };
}

/** Minimal PluginContext mock */
function createMockPluginContext(services: Record<string, any> = {}) {
  return {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (services[name]) return services[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn(),
    trigger: vi.fn().mockResolvedValue(undefined),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    getKernel: vi.fn(),
  };
}

/** Dummy handler */
const noop = vi.fn();

// ---------------------------------------------------------------------------
// RouteManager
// ---------------------------------------------------------------------------

describe('RouteManager', () => {
  let server: ReturnType<typeof createMockServer>;
  let manager: RouteManager;

  beforeEach(() => {
    server = createMockServer();
    manager = new RouteManager(server as any);
  });

  // -- Registration --------------------------------------------------------

  describe('register', () => {
    it('should register a GET route and delegate to server.get', () => {
      manager.register({ method: 'GET', path: '/users', handler: noop });
      expect(server.get).toHaveBeenCalledWith('/users', noop);
      expect(manager.count()).toBe(1);
    });

    it('should register POST, PUT, PATCH, DELETE routes', () => {
      manager.register({ method: 'POST', path: '/a', handler: noop });
      manager.register({ method: 'PUT', path: '/b', handler: noop });
      manager.register({ method: 'PATCH', path: '/c', handler: noop });
      manager.register({ method: 'DELETE', path: '/d', handler: noop });

      expect(server.post).toHaveBeenCalledWith('/a', noop);
      expect(server.put).toHaveBeenCalledWith('/b', noop);
      expect(server.patch).toHaveBeenCalledWith('/c', noop);
      expect(server.delete).toHaveBeenCalledWith('/d', noop);
      expect(manager.count()).toBe(4);
    });

    it('should store metadata on the route entry', () => {
      manager.register({
        method: 'GET',
        path: '/items',
        handler: noop,
        metadata: { summary: 'List items', tags: ['items'] },
      });

      const entry = manager.get('GET', '/items');
      expect(entry).toBeDefined();
      expect(entry!.metadata?.summary).toBe('List items');
      expect(entry!.metadata?.tags).toContain('items');
    });

    it('should throw when a string handler is provided', () => {
      expect(() =>
        manager.register({ method: 'GET', path: '/x', handler: 'someHandler' }),
      ).toThrow(/String-based route handlers/);
    });
  });

  // -- registerMany --------------------------------------------------------

  describe('registerMany', () => {
    it('should register multiple routes at once', () => {
      manager.registerMany([
        { method: 'GET', path: '/a', handler: noop },
        { method: 'POST', path: '/b', handler: noop },
      ]);
      expect(manager.count()).toBe(2);
    });
  });

  // -- Lookup / query -------------------------------------------------------

  describe('get', () => {
    it('should return undefined for unregistered route', () => {
      expect(manager.get('GET', '/nothing')).toBeUndefined();
    });

    it('should return the entry for a registered route', () => {
      manager.register({ method: 'GET', path: '/users', handler: noop });
      const entry = manager.get('GET', '/users');
      expect(entry).toBeDefined();
      expect(entry!.path).toBe('/users');
    });
  });

  describe('getAll', () => {
    it('should return all registered routes', () => {
      manager.register({ method: 'GET', path: '/a', handler: noop });
      manager.register({ method: 'POST', path: '/b', handler: noop });
      expect(manager.getAll()).toHaveLength(2);
    });
  });

  describe('getByMethod', () => {
    it('should filter routes by HTTP method', () => {
      manager.register({ method: 'GET', path: '/a', handler: noop });
      manager.register({ method: 'GET', path: '/b', handler: noop });
      manager.register({ method: 'POST', path: '/c', handler: noop });

      expect(manager.getByMethod('GET')).toHaveLength(2);
      expect(manager.getByMethod('POST')).toHaveLength(1);
      expect(manager.getByMethod('DELETE')).toHaveLength(0);
    });
  });

  describe('getByPrefix', () => {
    it('should filter routes by path prefix', () => {
      manager.register({ method: 'GET', path: '/api/users', handler: noop });
      manager.register({ method: 'GET', path: '/api/items', handler: noop });
      manager.register({ method: 'GET', path: '/other', handler: noop });

      expect(manager.getByPrefix('/api')).toHaveLength(2);
    });
  });

  describe('getByTag', () => {
    it('should filter routes by metadata tag', () => {
      manager.register({
        method: 'GET', path: '/a', handler: noop,
        metadata: { tags: ['users'] },
      });
      manager.register({
        method: 'GET', path: '/b', handler: noop,
        metadata: { tags: ['items'] },
      });
      manager.register({ method: 'GET', path: '/c', handler: noop });

      expect(manager.getByTag('users')).toHaveLength(1);
      expect(manager.getByTag('missing')).toHaveLength(0);
    });
  });

  // -- Unregister -----------------------------------------------------------

  describe('unregister', () => {
    it('should remove a route from the registry', () => {
      manager.register({ method: 'GET', path: '/x', handler: noop });
      expect(manager.count()).toBe(1);

      manager.unregister('GET', '/x');
      expect(manager.count()).toBe(0);
      expect(manager.get('GET', '/x')).toBeUndefined();
    });
  });

  // -- Clear ----------------------------------------------------------------

  describe('clear', () => {
    it('should remove all routes', () => {
      manager.registerMany([
        { method: 'GET', path: '/a', handler: noop },
        { method: 'POST', path: '/b', handler: noop },
      ]);
      manager.clear();
      expect(manager.count()).toBe(0);
    });
  });

  // -- Group ----------------------------------------------------------------

  describe('group', () => {
    it('should create routes with the prefix prepended', () => {
      manager.group('/api/v1', (group) => {
        group.get('/users', noop);
        group.post('/users', noop);
        group.put('/users/:id', noop);
        group.patch('/users/:id', noop);
        group.delete('/users/:id', noop);
      });

      expect(manager.count()).toBe(5);
      expect(manager.get('GET', '/api/v1/users')).toBeDefined();
      expect(manager.get('POST', '/api/v1/users')).toBeDefined();
      expect(manager.get('PUT', '/api/v1/users/:id')).toBeDefined();
      expect(manager.get('PATCH', '/api/v1/users/:id')).toBeDefined();
      expect(manager.get('DELETE', '/api/v1/users/:id')).toBeDefined();
    });

    it('should normalize paths (strip trailing slash on prefix, ensure leading slash on path)', () => {
      manager.group('/api/', (group) => {
        group.get('items', noop);
      });
      expect(manager.get('GET', '/api/items')).toBeDefined();
    });

    it('should allow chaining on group builder methods', () => {
      manager.group('/api', (group) => {
        const result = group
          .get('/a', noop)
          .post('/b', noop);
        expect(result).toBe(group);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// RestServer
// ---------------------------------------------------------------------------

describe('RestServer', () => {
  let server: ReturnType<typeof createMockServer>;
  let protocol: ReturnType<typeof createMockProtocol>;

  beforeEach(() => {
    server = createMockServer();
    protocol = createMockProtocol();
  });

  // -- Constructor & defaults -----------------------------------------------

  describe('constructor', () => {
    it('should create a RestServer with default config', () => {
      const rest = new RestServer(server as any, protocol as any);
      expect(rest).toBeDefined();
      expect(rest.getRouteManager()).toBeInstanceOf(RouteManager);
    });

    it('should accept custom config', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { version: 'v2', basePath: '/custom' },
      } as any);
      expect(rest).toBeDefined();
    });
  });

  // -- registerRoutes -------------------------------------------------------

  describe('registerRoutes', () => {
    it('should register discovery, metadata, UI, CRUD, and batch routes by default', () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const routes = rest.getRoutes();
      expect(routes.length).toBeGreaterThan(0);

      // Expect at least discovery + metadata + CRUD routes
      const paths = routes.map((r) => r.path);
      // Discovery (both basePath and basePath/discovery)
      expect(paths).toContain('/api/v1');
      expect(paths).toContain('/api/v1/discovery');
      // Metadata
      expect(paths.some((p) => p.includes('/meta'))).toBe(true);
      // CRUD
      expect(paths.some((p) => p.includes('/data'))).toBe(true);
    });

    it('should use custom apiPath when specified', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { apiPath: '/custom/path' },
      } as any);
      rest.registerRoutes();

      const paths = rest.getRoutes().map((r) => r.path);
      expect(paths.some((p) => p.startsWith('/custom/path'))).toBe(true);
    });

    it('should skip CRUD routes when enableCrud is false', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { enableCrud: false },
      } as any);
      rest.registerRoutes();

      const tags = rest.getRoutes().flatMap((r) => r.metadata?.tags ?? []);
      expect(tags).not.toContain('crud');
    });

    it('should skip metadata routes when enableMetadata is false', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { enableMetadata: false },
      } as any);
      rest.registerRoutes();

      const routes = rest.getRoutes();
      // Only the PUT /meta/:type/:name is always registered, but enableMetadata=false
      // skips the entire registerMetadataEndpoints call
      expect(routes.every((r) => !r.path.includes('/meta'))).toBe(true);
    });

    it('should skip discovery when enableDiscovery is false', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { enableDiscovery: false },
      } as any);
      rest.registerRoutes();

      const routes = rest.getRoutes();
      // Neither basePath nor basePath/discovery should be registered
      const discoveryRoutes = routes.filter((r) =>
        r.metadata?.tags?.includes('discovery'),
      );
      expect(discoveryRoutes).toHaveLength(0);
    });

    it('should skip batch routes when enableBatch is false', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { enableBatch: false },
      } as any);
      rest.registerRoutes();

      const tags = rest.getRoutes().flatMap((r) => r.metadata?.tags ?? []);
      expect(tags).not.toContain('batch');
    });

    it('should register batch endpoints when protocol implements batch methods', () => {
      protocol.batchData = vi.fn().mockResolvedValue({});
      protocol.createManyData = vi.fn().mockResolvedValue([]);
      protocol.updateManyData = vi.fn().mockResolvedValue([]);
      protocol.deleteManyData = vi.fn().mockResolvedValue([]);

      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const batchRoutes = rest.getRoutes().filter((r) =>
        r.metadata?.tags?.includes('batch'),
      );
      expect(batchRoutes.length).toBeGreaterThan(0);
    });

    it('should register UI view endpoint when enableUi is true', () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const uiRoutes = rest.getRoutes().filter((r) =>
        r.metadata?.tags?.includes('ui'),
      );
      expect(uiRoutes.length).toBeGreaterThan(0);
    });

    it('should not register i18n endpoints (i18n routes are self-registered by service-i18n)', () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const i18nRoutes = rest.getRoutes().filter((r) =>
        r.metadata?.tags?.includes('i18n'),
      );
      expect(i18nRoutes).toHaveLength(0);
    });
  });

  // -- getRouteManager / getRoutes ------------------------------------------

  describe('getRouteManager', () => {
    it('should return the internal RouteManager instance', () => {
      const rest = new RestServer(server as any, protocol as any);
      const rm = rest.getRouteManager();
      expect(rm).toBeInstanceOf(RouteManager);
    });
  });

  describe('getRoutes', () => {
    it('should return an empty array before registerRoutes is called', () => {
      const rest = new RestServer(server as any, protocol as any);
      expect(rest.getRoutes()).toEqual([]);
    });
  });

  describe('getData handler expand/select forwarding', () => {
    function getRoute(rest: any, pathSuffix: string) {
      const routes = rest.getRoutes();
      return routes.find(
        (r: any) => r.method === 'GET' && r.path === `/api/v1/data/${pathSuffix}`,
      );
    }

    it('should pass expand and select query params to protocol.getData', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const getByIdRoute = getRoute(rest, ':object/:id');
      expect(getByIdRoute).toBeDefined();

      // Simulate request with expand and select query params
      const mockReq = {
        params: { object: 'order_item', id: 'oi_123' },
        query: { expand: 'order,product', select: 'name,total' },
      };
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      protocol.getData.mockResolvedValue({
        object: 'order_item',
        id: 'oi_123',
        record: { id: 'oi_123', name: 'Item 1' },
      });

      await getByIdRoute!.handler(mockReq, mockRes);

      expect(protocol.getData).toHaveBeenCalledWith(
        expect.objectContaining({
          object: 'order_item',
          id: 'oi_123',
          expand: 'order,product',
          select: 'name,total',
        }),
      );
    });

    it('should omit expand/select when not present in query', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const getByIdRoute = getRoute(rest, ':object/:id');

      const mockReq = {
        params: { object: 'contact', id: 'c_1' },
        query: {},
      };
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      protocol.getData.mockResolvedValue({
        object: 'contact',
        id: 'c_1',
        record: { id: 'c_1' },
      });

      await getByIdRoute!.handler(mockReq, mockRes);

      // Should NOT have expand or select keys in the call
      const callArg = protocol.getData.mock.calls[protocol.getData.mock.calls.length - 1][0];
      expect(callArg).toEqual({ object: 'contact', id: 'c_1' });
    });
  });

  describe('clone route — POST /data/:object/:id/clone', () => {
    function cloneRoute(rest: any) {
      return rest
        .getRoutes()
        .find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/:id/clone');
    }
    const mockRes = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis() });

    it('registers the clone route alongside CRUD', () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      expect(cloneRoute(rest)).toBeDefined();
    });

    it('forwards object/id and nested overrides to protocol.cloneData and responds 201', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = cloneRoute(rest);

      const req = { params: { object: 'account', id: 'a1' }, body: { overrides: { name: 'Copy' } } };
      const res = mockRes();
      await route!.handler(req, res);

      expect(protocol.cloneData).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'account', id: 'a1', overrides: { name: 'Copy' } }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('treats a bare body (no `overrides` key) as the override map', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = cloneRoute(rest);

      const req = { params: { object: 'account', id: 'a1' }, body: { name: 'Bare' } };
      const res = mockRes();
      await route!.handler(req, res);

      expect(protocol.cloneData).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'account', id: 'a1', overrides: { name: 'Bare' } }),
      );
    });

    it('maps a CLONE_DISABLED protocol error to 403', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = cloneRoute(rest);

      protocol.cloneData.mockRejectedValueOnce(
        Object.assign(new Error('Cloning is disabled'), { code: 'CLONE_DISABLED', status: 403 }),
      );
      const req = { params: { object: 'account', id: 'a1' }, body: {} };
      const res = mockRes();
      await route!.handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CLONE_DISABLED' }));
    });

    it('returns 501 when the protocol does not implement cloneData', async () => {
      const noClone = { ...protocol, cloneData: undefined };
      const rest = new RestServer(server as any, noClone as any);
      rest.registerRoutes();
      const route = cloneRoute(rest);

      const req = { params: { object: 'account', id: 'a1' }, body: {} };
      const res = mockRes();
      await route!.handler(req, res);

      expect(res.status).toHaveBeenCalledWith(501);
    });
  });

  describe('meta routes preview=draft forwarding (ADR-0033/0037)', () => {
    function getMetaRoute(rest: any, method: string, path: string) {
      return rest
        .getRoutes()
        .find((r: any) => r.method === method && r.path === path);
    }
    const mockRes = () => ({
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      header: vi.fn(),
      send: vi.fn(),
    });

    it('GET /meta/:type forwards previewDrafts to protocol.getMetaItems', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type');
      expect(route).toBeDefined();

      await route!.handler(
        { params: { type: 'app' }, query: { preview: 'draft' }, headers: {} },
        mockRes(),
      );
      expect(protocol.getMetaItems).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'app', previewDrafts: true }),
      );
    });

    it('GET /meta/:type omits previewDrafts without the flag', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type');

      await route!.handler(
        { params: { type: 'app' }, query: {}, headers: {} },
        mockRes(),
      );
      const arg = protocol.getMetaItems.mock.calls.at(-1)![0];
      expect(arg).not.toHaveProperty('previewDrafts');
    });

    it('GET /meta/:type/:name forwards previewDrafts and bypasses the cached path', async () => {
      // A cached protocol would normally win; preview must skip it (ETags are
      // keyed on the published checksum).
      protocol.getMetaItemCached = vi.fn();
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type/:name');
      expect(route).toBeDefined();

      await route!.handler(
        { params: { type: 'object', name: 'lead' }, query: { preview: 'draft' }, headers: {} },
        mockRes(),
      );
      expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
      expect(protocol.getMetaItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'object', name: 'lead', previewDrafts: true }),
      );
    });

    it('GET /meta/:type/:name?package= bypasses the cache and threads packageId (ADR-0048)', async () => {
      // A `?package=` read is package-scoped (prefer-local). The cached path
      // keys ETags on type+name only and drops packageId, so it must be skipped
      // when a package scope is requested — otherwise two installed packages
      // shipping the same type/name share one cache entry and the scope hint is
      // silently lost.
      protocol.getMetaItemCached = vi.fn();
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type/:name');
      expect(route).toBeDefined();

      await route!.handler(
        { params: { type: 'doc', name: 'intro' }, query: { package: 'com.objectstack.studio' }, headers: {} },
        mockRes(),
      );
      expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
      expect(protocol.getMetaItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'doc', name: 'intro', packageId: 'com.objectstack.studio' }),
      );
    });
  });

  describe('findData handler expand/populate forwarding', () => {
    function getListRoute(rest: any) {
      const routes = rest.getRoutes();
      return routes.find(
        (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object',
      );
    }

    it('should pass query params including expand to protocol.findData', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const listRoute = getListRoute(rest);
      expect(listRoute).toBeDefined();

      const mockReq = {
        params: { object: 'order_item' },
        query: { expand: 'order,product', top: '10' },
      };
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      protocol.findData.mockResolvedValue({
        object: 'order_item',
        records: [],
        total: 0,
      });

      await listRoute!.handler(mockReq, mockRes);

      expect(protocol.findData).toHaveBeenCalledWith({
        object: 'order_item',
        query: { expand: 'order,product', top: '10' },
      });
    });

    it('should pass populate query param to protocol.findData', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();

      const listRoute = getListRoute(rest);

      const mockReq = {
        params: { object: 'task' },
        query: { populate: 'assignee,project' },
      };
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      protocol.findData.mockResolvedValue({
        object: 'task',
        records: [],
        total: 0,
      });

      await listRoute!.handler(mockReq, mockRes);

      expect(protocol.findData).toHaveBeenCalledWith({
        object: 'task',
        query: { populate: 'assignee,project' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // GET /data/:object/export — streaming CSV / JSON export (M10.21 / C.21)
  // -----------------------------------------------------------------------
  describe('export handler', () => {
    function getExportRoute(rest: any) {
      const routes = rest.getRoutes();
      return routes.find(
        (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
      );
    }

    function makeRes() {
      const chunks: string[] = [];
      const headers: Record<string, string> = {};
      let status = 200;
      const res: any = {
        write: (s: string) => { chunks.push(s); },
        end: vi.fn(),
        header: (n: string, v: string) => { headers[n] = v; return res; },
        status: (code: number) => { status = code; return res; },
        json: vi.fn(),
      };
      return { res, chunks, headers, getStatus: () => status };
    }

    it('streams CSV with header row and quotes risky cells', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getExportRoute(rest);
      expect(route).toBeDefined();

      protocol.findData.mockResolvedValueOnce({
        data: [
          { id: '1', name: 'Acme, Inc.', note: 'line1\nline2' },
          { id: '2', name: 'Beta "Co"', note: null },
        ],
      });
      // Second call returns empty -> ends the stream
      protocol.findData.mockResolvedValueOnce({ data: [] });

      const { res, chunks, headers } = makeRes();
      const req = {
        params: { object: 'account' },
        query: { format: 'csv', fields: 'id,name,note', limit: '500' },
      };

      await route!.handler(req as any, res);

      expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(headers['Content-Disposition']).toMatch(/attachment; filename="account-\d{4}-\d{2}-\d{2}\.csv"/);
      const text = chunks.join('');
      expect(text.startsWith('id,name,note\r\n')).toBe(true);
      expect(text).toContain('1,"Acme, Inc.","line1\nline2"');
      expect(text).toContain('2,"Beta ""Co""",');
      expect(res.end).toHaveBeenCalled();
    });

    it('streams JSON array when format=json', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getExportRoute(rest);

      protocol.findData.mockResolvedValueOnce({
        data: [{ id: 'a' }, { id: 'b' }],
      });
      protocol.findData.mockResolvedValueOnce({ data: [] });

      const { res, chunks, headers } = makeRes();
      await route!.handler({
        params: { object: 'lead' },
        query: { format: 'json' },
      } as any, res);

      expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
      const text = chunks.join('');
      expect(text).toBe('[{"id":"a"},{"id":"b"}]');
    });

    it('rejects invalid JSON in filter query', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res } = makeRes();
      await route!.handler({
        params: { object: 'account' },
        query: { filter: '{not json' },
      } as any, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    });

    it('honours the hard 50k row cap', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getExportRoute(rest);

      // Always return full chunks so the loop is bounded only by `limit`.
      protocol.findData.mockImplementation(async ({ query }: any) => {
        const take = query?.$top ?? 0;
        return { data: Array.from({ length: take }, (_v, i) => ({ id: String((query?.$skip ?? 0) + i) })) };
      });

      const { res, chunks } = makeRes();
      await route!.handler({
        params: { object: 'big' },
        query: { format: 'csv', limit: '999999', fields: 'id' },
      } as any, res);

      const lines = chunks.join('').split('\r\n').filter(Boolean);
      // 1 header + 50 000 rows.
      expect(lines.length).toBe(50_001);
    });
  });

  // -----------------------------------------------------------------------
  // POST /email/send — IEmailService bridge (M11.B1 / M10.7)
  // -----------------------------------------------------------------------
  describe('email send handler', () => {
    function getEmailRoute(rest: any) {
      const routes = rest.getRoutes();
      return routes.find(
        (r: any) => r.method === 'POST' && r.path === '/api/v1/email/send',
      );
    }

    it('returns 501 when no email service provider is wired', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const route = getEmailRoute(rest);
      expect(route).toBeDefined();
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({ body: { to: 'a@b.com', subject: 'Hi', text: 'x' } } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(501);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_IMPLEMENTED' }));
    });

    it('calls email service and returns the SendEmailResult on success', async () => {
      const send = vi.fn(async () => ({ id: 'em-1', status: 'sent', messageId: '<m1@x>' }));
      const provider = async () => ({ send });
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        provider as any,
      );
      rest.registerRoutes();
      const route = getEmailRoute(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({
        body: { to: 'a@b.com', from: 'no@reply.com', subject: 'Hi', text: 'x' },
      } as any, res as any);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'a@b.com', from: 'no@reply.com', subject: 'Hi',
      }));
      expect(res.json).toHaveBeenCalledWith({ id: 'em-1', status: 'sent', messageId: '<m1@x>' });
    });

    it('translates VALIDATION_FAILED errors into 400', async () => {
      const send = vi.fn(async () => { throw new Error('VALIDATION_FAILED: subject is required'); });
      const provider = async () => ({ send });
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        provider as any,
      );
      rest.registerRoutes();
      const route = getEmailRoute(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({ body: { to: 'a@b.com', subject: '', text: 'x' } } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'VALIDATION_FAILED',
        error: 'subject is required',
      }));
    });
  });

  // -----------------------------------------------------------------------
  // /data/:object/:id/shares — ISharingService bridge (M11.C17)
  // -----------------------------------------------------------------------
  describe('sharing endpoints', () => {
    function getShareRoutes(rest: any) {
      const routes = rest.getRoutes();
      return {
        list: routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/:id/shares'),
        grant: routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/:id/shares'),
        revoke: routes.find((r: any) => r.method === 'DELETE' && r.path === '/api/v1/data/:object/:id/shares/:shareId'),
      };
    }

    it('returns 501 when no sharing service provider is wired', async () => {
      const rest = new RestServer(server as any, protocol as any);
      rest.registerRoutes();
      const { list, grant, revoke } = getShareRoutes(rest);
      expect(list && grant && revoke).toBeDefined();
      for (const route of [list, grant, revoke]) {
        const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
        await route!.handler({ params: { object: 'a', id: '1', shareId: 's1' }, body: {} } as any, res as any);
        expect(res.status).toHaveBeenCalledWith(501);
      }
    });

    it('GET returns the rows produced by listShares()', async () => {
      const listShares = vi.fn(async () => [{ id: 'shr_1', recipient_id: 'bob' }]);
      const provider = async () => ({ listShares, grant: vi.fn(), revoke: vi.fn() });
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      rest.registerRoutes();
      const { list } = getShareRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await list!.handler({ params: { object: 'account', id: 'a1' } } as any, res as any);
      expect(listShares).toHaveBeenCalledWith('account', 'a1', expect.anything());
      expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'shr_1', recipient_id: 'bob' }] });
    });

    it('POST creates a grant and returns 201', async () => {
      const grant = vi.fn(async (input: any) => ({ id: 'shr_2', ...input }));
      const provider = async () => ({ listShares: vi.fn(), grant, revoke: vi.fn() });
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      rest.registerRoutes();
      const { grant: route } = getShareRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({
        params: { object: 'account', id: 'a1' },
        body: { recipientId: 'bob', accessLevel: 'edit' },
      } as any, res as any);
      expect(grant).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }),
        expect.anything(),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('POST surfaces VALIDATION_FAILED as 400', async () => {
      const grant = vi.fn(async () => { throw new Error('VALIDATION_FAILED: recipientId is required'); });
      const provider = async () => ({ listShares: vi.fn(), grant, revoke: vi.fn() });
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      rest.registerRoutes();
      const { grant: route } = getShareRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({ params: { object: 'account', id: 'a1' }, body: {} } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    });

    it('DELETE revokes and returns 204', async () => {
      const revoke = vi.fn(async () => undefined);
      const provider = async () => ({ listShares: vi.fn(), grant: vi.fn(), revoke });
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      rest.registerRoutes();
      const { revoke: route } = getShareRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
      await route!.handler({ params: { object: 'account', id: 'a1', shareId: 'shr_X' } } as any, res as any);
      expect(revoke).toHaveBeenCalledWith('shr_X', expect.anything());
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  // -----------------------------------------------------------------------
  // /api/v1/reports — IReportService bridge (M11.C16; promoted to top-level)
  // -----------------------------------------------------------------------
  describe('reports endpoints', () => {
    function getReportRoutes(rest: any) {
      const routes = rest.getRoutes();
      return {
        list:        routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/reports'),
        save:        routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/reports'),
        get:         routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/reports/:id'),
        del:         routes.find((r: any) => r.method === 'DELETE' && r.path === '/api/v1/reports/:id'),
        run:         routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/reports/:id/run'),
        schedule:    routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/reports/:id/schedule'),
        schedules:   routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/reports/:id/schedules'),
        unschedule:  routes.find((r: any) => r.method === 'DELETE' && r.path === '/api/v1/reports/schedules/:scheduleId'),
      };
    }

    function makeRest(provider?: any) {
      const rest = new RestServer(
        server as any, protocol as any, {},
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, provider,
      );
      rest.registerRoutes();
      return rest;
    }

    it('returns 501 when no reports service provider is wired', async () => {
      const rest = makeRest();
      const routes = getReportRoutes(rest);
      const targets = [routes.list, routes.save, routes.get, routes.del, routes.run, routes.schedule, routes.schedules, routes.unschedule];
      for (const route of targets) {
        expect(route).toBeDefined();
        const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
        await route!.handler({ params: { id: 'r1', scheduleId: 's1' }, body: {}, query: {} } as any, res as any);
        expect(res.status).toHaveBeenCalledWith(501);
      }
    });

    it('GET /reports returns rows produced by listReports()', async () => {
      const listReports = vi.fn(async () => [{ id: 'rpt_1', name: 'Open leads' }]);
      const rest = makeRest(async () => ({ listReports }));
      const { list } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await list!.handler({ query: { object: 'lead' } } as any, res as any);
      expect(listReports).toHaveBeenCalledWith({ object: 'lead', ownerId: undefined }, expect.anything());
      expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'rpt_1', name: 'Open leads' }] });
    });

    it('POST /reports creates and returns 201', async () => {
      const saveReport = vi.fn(async (input: any) => ({ id: 'rpt_new', ...input }));
      const rest = makeRest(async () => ({ saveReport }));
      const { save } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await save!.handler({ body: { name: 'X', object: 'lead', query: {} } } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(saveReport).toHaveBeenCalled();
    });

    it('POST /reports surfaces VALIDATION_FAILED as 400', async () => {
      const saveReport = vi.fn(async () => { throw new Error('VALIDATION_FAILED: name is required'); });
      const rest = makeRest(async () => ({ saveReport }));
      const { save } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await save!.handler({ body: {} } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    });

    it('GET /reports/:id returns 404 when missing', async () => {
      const getReport = vi.fn(async () => null);
      const rest = makeRest(async () => ({ getReport }));
      const { get } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await get!.handler({ params: { id: 'rpt_x' } } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('POST /reports/:id/run returns rendered result', async () => {
      const run = vi.fn(async () => ({ reportId: 'r1', rowCount: 2, format: 'csv', body: 'a,b\r\n1,2', rows: [], ranAt: 'now' }));
      const rest = makeRest(async () => ({ run }));
      const { run: route } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({ params: { id: 'r1' } } as any, res as any);
      expect(run).toHaveBeenCalledWith('r1', expect.anything());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ rowCount: 2, body: 'a,b\r\n1,2' }));
    });

    it('POST /reports/:id/run surfaces REPORT_NOT_FOUND as 404', async () => {
      const run = vi.fn(async () => { throw new Error('REPORT_NOT_FOUND: r99'); });
      const rest = makeRest(async () => ({ run }));
      const { run: route } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await route!.handler({ params: { id: 'r99' } } as any, res as any);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('POST /reports/:id/schedule maps body to scheduleReport input', async () => {
      const scheduleReport = vi.fn(async (input: any) => ({ id: 'rsch_1', ...input }));
      const rest = makeRest(async () => ({ scheduleReport }));
      const { schedule } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await schedule!.handler({
        params: { id: 'r1' },
        body: { recipients: ['x@t'], intervalMinutes: 60, format: 'csv' },
      } as any, res as any);
      expect(scheduleReport).toHaveBeenCalledWith(
        expect.objectContaining({ reportId: 'r1', recipients: ['x@t'], intervalMinutes: 60, format: 'csv' }),
        expect.anything(),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('DELETE /reports/schedules/:scheduleId returns 204', async () => {
      const unscheduleReport = vi.fn(async () => undefined);
      const rest = makeRest(async () => ({ unscheduleReport }));
      const { unschedule } = getReportRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
      await unschedule!.handler({ params: { scheduleId: 'rsch_1' } } as any, res as any);
      expect(unscheduleReport).toHaveBeenCalledWith('rsch_1', expect.anything());
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });
});

// ---------------------------------------------------------------------------
// createRestApiPlugin
// ---------------------------------------------------------------------------

describe('createRestApiPlugin', () => {
  it('should return a plugin object with name and version', () => {
    const plugin = createRestApiPlugin();
    expect(plugin.name).toBe('com.objectstack.rest.api');
    expect(plugin.version).toBe('1.0.0');
    expect(typeof plugin.init).toBe('function');
    expect(typeof plugin.start).toBe('function');
  });

  it('should accept custom config', () => {
    const cfg: RestApiPluginConfig = {
      serverServiceName: 'my.server',
      protocolServiceName: 'my.protocol',
    };
    const plugin = createRestApiPlugin(cfg);
    expect(plugin.name).toBe('com.objectstack.rest.api');
  });

  describe('init', () => {
    it('should resolve without error', async () => {
      const plugin = createRestApiPlugin();
      const ctx = createMockPluginContext();
      await expect(plugin.init(ctx as any)).resolves.toBeUndefined();
    });
  });

  describe('start', () => {
    it('should warn and skip when http server is not found', async () => {
      const plugin = createRestApiPlugin();
      const ctx = createMockPluginContext(); // no services
      await plugin.start!(ctx as any);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('HTTP Server'),
      );
    });

    it('should warn and skip when protocol is not found', async () => {
      const mockServer = createMockServer();
      const ctx = createMockPluginContext({ 'http.server': mockServer });
      const plugin = createRestApiPlugin();
      await plugin.start!(ctx as any);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Protocol'),
      );
    });

    it('should register REST routes when both services are present', async () => {
      const mockServer = createMockServer();
      const mockProtocol = createMockProtocol();
      const ctx = createMockPluginContext({
        'http.server': mockServer,
        protocol: mockProtocol,
      });

      const plugin = createRestApiPlugin();
      await plugin.start!(ctx as any);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('REST API successfully registered'),
      );
      // CRUD routes should have been mounted
      expect(mockServer.get).toHaveBeenCalled();
      expect(mockServer.post).toHaveBeenCalled();
    });

    it('should use custom service names from config', async () => {
      const mockServer = createMockServer();
      const mockProtocol = createMockProtocol();
      const ctx = createMockPluginContext({
        'my.server': mockServer,
        'my.protocol': mockProtocol,
      });

      const plugin = createRestApiPlugin({
        serverServiceName: 'my.server',
        protocolServiceName: 'my.protocol',
      });
      await plugin.start!(ctx as any);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('REST API successfully registered'),
      );
    });

    it('should throw and log error when RestServer construction fails', async () => {
      const badServer = {}; // missing methods → will throw
      const mockProtocol = createMockProtocol();
      const ctx = createMockPluginContext({
        'http.server': badServer,
        protocol: mockProtocol,
      });

      const plugin = createRestApiPlugin();
      await expect(plugin.start!(ctx as any)).rejects.toThrow();
      expect(ctx.logger.error).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// PUT /meta/:type/:name — If-Match → parentVersion / X-Actor → actor (PR-10d.4)
// ---------------------------------------------------------------------------

describe('PUT /meta/:type/:name handler — header → request plumbing (PR-10d.4)', () => {
  function getPutRoute(rest: any, path: string) {
    return rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === path);
  }

  it('forwards If-Match header as parentVersion to protocol.saveMetaItem', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    protocol.saveMetaItem = vi.fn().mockResolvedValue({ success: true });
    const rest = new RestServer(server as any, protocol as any);
    rest.registerRoutes();

    const route = getPutRoute(rest, '/api/v1/meta/:type/:name');
    expect(route).toBeDefined();

    const req = {
      params: { type: 'view', name: 'cases' },
      headers: { 'if-match': 'sha256:abc', 'x-actor': 'user_42' },
      body: { name: 'cases', type: 'grid', label: 'X', columns: ['id'] },
    };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await route.handler(req, res);

    expect(protocol.saveMetaItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'view',
        name: 'cases',
        parentVersion: 'sha256:abc',
        actor: 'user_42',
      }),
    );
  });

  it('strips ETag-style quotes from If-Match before forwarding', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    protocol.saveMetaItem = vi.fn().mockResolvedValue({ success: true });
    const rest = new RestServer(server as any, protocol as any);
    rest.registerRoutes();
    const route = getPutRoute(rest, '/api/v1/meta/:type/:name');

    await route.handler(
      {
        params: { type: 'view', name: 'cases' },
        headers: { 'If-Match': '"sha256:xyz"' },
        body: {},
      },
      { json: vi.fn(), status: vi.fn().mockReturnThis() },
    );

    expect(protocol.saveMetaItem).toHaveBeenCalledWith(
      expect.objectContaining({ parentVersion: 'sha256:xyz' }),
    );
  });

  it('omits parentVersion when no If-Match header is present (legacy LWW behaviour preserved)', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    protocol.saveMetaItem = vi.fn().mockResolvedValue({ success: true });
    const rest = new RestServer(server as any, protocol as any);
    rest.registerRoutes();
    const route = getPutRoute(rest, '/api/v1/meta/:type/:name');

    await route.handler(
      {
        params: { type: 'view', name: 'cases' },
        headers: {},
        body: {},
      },
      { json: vi.fn(), status: vi.fn().mockReturnThis() },
    );

    const arg = (protocol.saveMetaItem as any).mock.calls[0][0];
    expect(arg).not.toHaveProperty('parentVersion');
    expect(arg).not.toHaveProperty('actor');
  });

  it('maps a thrown metadata_conflict (409) to a 409 response with the code', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const err: any = new Error('parentVersion mismatch');
    err.code = 'metadata_conflict';
    err.status = 409;
    protocol.saveMetaItem = vi.fn().mockRejectedValue(err);
    const rest = new RestServer(server as any, protocol as any);
    rest.registerRoutes();
    const route = getPutRoute(rest, '/api/v1/meta/:type/:name');

    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await route.handler(
      { params: { type: 'view', name: 'cases' }, headers: { 'if-match': 'sha256:stale' }, body: {} },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'metadata_conflict' }));
  });
});

// ---------------------------------------------------------------------------
// RestServer — project-scoped routing (Phase 2)
// ---------------------------------------------------------------------------

describe('RestServer project-scoped routing', () => {
  it('only registers unscoped routes by default', () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any);
    rest.registerRoutes();

    const paths = rest.getRoutes().map(r => r.path);
    expect(paths).toContain('/api/v1/data/:object');
    expect(paths.some(p => p.includes('/environments/:environmentId'))).toBe(false);
    // ADR-0033 drafts list endpoint, registered BEFORE the greedy `/meta/:type`
    // param route so `_drafts` isn't captured as a type name.
    expect(paths).toContain('/api/v1/meta/_drafts');
    expect(paths.indexOf('/api/v1/meta/_drafts')).toBeLessThan(paths.indexOf('/api/v1/meta/:type'));
  });

  it("registers both unscoped and scoped routes in 'auto' mode", () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any, {
      api: { enableProjectScoping: true, projectResolution: 'auto' } as any,
    } as any);
    rest.registerRoutes();

    const paths = rest.getRoutes().map(r => r.path);
    expect(paths).toContain('/api/v1/data/:object');
    expect(paths).toContain('/api/v1/environments/:environmentId/data/:object');
    expect(paths).toContain('/api/v1/meta');
    expect(paths).toContain('/api/v1/environments/:environmentId/meta');
  });

  it("only registers scoped routes in 'required' mode", () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any, {
      api: { enableProjectScoping: true, projectResolution: 'required' } as any,
    } as any);
    rest.registerRoutes();

    const paths = rest.getRoutes().map(r => r.path);
    expect(paths).toContain('/api/v1/environments/:environmentId/data/:object');
    expect(paths).not.toContain('/api/v1/data/:object');
  });

  it('scoped CRUD handler forwards req.params.environmentId into the protocol call', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any, {
      api: { enableProjectScoping: true, projectResolution: 'required' } as any,
    } as any);
    rest.registerRoutes();

    const listRoute = rest
      .getRoutes()
      .find(r => r.path === '/api/v1/environments/:environmentId/data/:object' && r.method === 'GET');
    expect(listRoute).toBeDefined();

    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await listRoute!.handler(
      { params: { environmentId: 'proj-123', object: 'task' }, query: {} },
      res,
    );

    expect(protocol.findData).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'task', environmentId: 'proj-123' }),
    );
  });

  it('unscoped handler in auto mode does NOT set environmentId on the protocol call', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any, {
      api: { enableProjectScoping: true, projectResolution: 'auto' } as any,
    } as any);
    rest.registerRoutes();

    const unscoped = rest
      .getRoutes()
      .find(r => r.path === '/api/v1/data/:object' && r.method === 'GET');
    expect(unscoped).toBeDefined();

    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await unscoped!.handler(
      { params: { object: 'task' }, query: {} },
      res,
    );

    expect(protocol.findData).toHaveBeenCalledWith(
      expect.not.objectContaining({ environmentId: expect.anything() }),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveProtocol resolution chain — hostname, X-Environment-Id header,
// default fallback, control-plane.
// ---------------------------------------------------------------------------

describe('RestServer.resolveProtocol', () => {
  function makeKernel(label: string) {
    const projectProtocol = { __label: label } as any;
    return {
      getServiceAsync: vi.fn().mockResolvedValue(projectProtocol),
      __projectProtocol: projectProtocol,
    };
  }

  function makeFixture(opts: {
    envRegistry?: { resolveByHostname?: any; resolveById?: any } | undefined;
    defaultProvider?: () => string | undefined;
    kernels?: Record<string, any>;
  }) {
    const server = createMockServer();
    const controlProtocol = createMockProtocol();
    const kernels = opts.kernels ?? {};
    const kernelManager = {
      getOrCreate: vi.fn(async (id: string) => {
        const k = kernels[id];
        if (!k) throw new Error(`unknown project ${id}`);
        return k;
      }),
    };
    const rest = new RestServer(
      server as any,
      controlProtocol as any,
      {},
      kernelManager as any,
      opts.envRegistry as any,
      opts.defaultProvider,
    );
    return { rest, controlProtocol, kernelManager, kernels };
  }

  it('routes to project kernel when hostname resolves', async () => {
    const projectKernel = makeKernel('proj_a');
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue({ environmentId: 'proj_a' }),
        resolveById: vi.fn(),
      },
      kernels: { proj_a: projectKernel },
    });
    const result = await (f.rest as any).resolveProtocol(undefined, {
      headers: { host: 'a.example.com' },
    });
    expect(result).toBe(projectKernel.__projectProtocol);
    expect(f.kernelManager.getOrCreate).toHaveBeenCalledWith('proj_a');
  });

  it('caches hostname→env resolution within the TTL and refreshes after it (P1-4)', async () => {
    const projectKernel = makeKernel('proj_a');
    const resolveByHostname = vi.fn().mockResolvedValue({ environmentId: 'proj_a' });
    const f = makeFixture({
      envRegistry: { resolveByHostname, resolveById: vi.fn() },
      kernels: { proj_a: projectKernel },
    });
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const req = { headers: { host: 'a.example.com' } };
      await (f.rest as any).resolveProtocol(undefined, req);
      await (f.rest as any).resolveProtocol(undefined, req);
      await (f.rest as any).resolveProtocol(undefined, req);
      expect(resolveByHostname).toHaveBeenCalledTimes(1); // 2nd/3rd served from cache

      now += 31_000; // past the 30s TTL
      await (f.rest as any).resolveProtocol(undefined, req);
      expect(resolveByHostname).toHaveBeenCalledTimes(2); // refreshed
    } finally {
      spy.mockRestore();
    }
  });

  it('caches a negative result so unknown hosts do not hammer the registry (P1-4)', async () => {
    const resolveByHostname = vi.fn().mockResolvedValue(null);
    const f = makeFixture({
      envRegistry: { resolveByHostname, resolveById: vi.fn() },
      defaultProvider: () => 'proj_local',
      kernels: { proj_local: makeKernel('proj_local') },
    });
    const req = { headers: { host: 'unknown.example.com' } };
    await (f.rest as any).resolveProtocol(undefined, req);
    await (f.rest as any).resolveProtocol(undefined, req);
    expect(resolveByHostname).toHaveBeenCalledTimes(1); // negative result cached
  });

  it('routes via X-Environment-Id header when hostname resolution fails', async () => {
    const projectKernel = makeKernel('proj_b');
    const resolveById = vi.fn().mockResolvedValue({ /* truthy driver */ });
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue(null),
        resolveById,
      },
      kernels: { proj_b: projectKernel },
    });
    const result = await (f.rest as any).resolveProtocol(undefined, {
      headers: { host: 'unknown.example.com', 'x-environment-id': 'proj_b' },
    });
    expect(result).toBe(projectKernel.__projectProtocol);
    expect(resolveById).toHaveBeenCalledWith('proj_b');
    expect(f.kernelManager.getOrCreate).toHaveBeenCalledWith('proj_b');
  });

  it('reads X-Environment-Id from Fetch-style headers.get()', async () => {
    const projectKernel = makeKernel('proj_c');
    const resolveById = vi.fn().mockResolvedValue({});
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue(null),
        resolveById,
      },
      kernels: { proj_c: projectKernel },
    });
    const headers = new Map<string, string>([['x-environment-id', 'proj_c']]);
    const fetchHeaders = {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    };
    const result = await (f.rest as any).resolveProtocol(undefined, {
      headers: fetchHeaders,
    });
    expect(result).toBe(projectKernel.__projectProtocol);
    expect(resolveById).toHaveBeenCalledWith('proj_c');
  });

  it('ignores X-Environment-Id when envRegistry rejects the id', async () => {
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue(null),
        // resolveById returns null → unknown project, must not route there
        resolveById: vi.fn().mockResolvedValue(null),
      },
      defaultProvider: () => undefined,
    });
    const result = await (f.rest as any).resolveProtocol(undefined, {
      headers: { 'x-environment-id': 'proj_bogus' },
    });
    expect(result).toBe(f.controlProtocol);
    expect(f.kernelManager.getOrCreate).not.toHaveBeenCalled();
  });

  it('falls back to defaultEnvironmentIdProvider when host & header miss', async () => {
    const projectKernel = makeKernel('proj_local');
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue(null),
        resolveById: vi.fn(),
      },
      defaultProvider: () => 'proj_local',
      kernels: { proj_local: projectKernel },
    });
    const result = await (f.rest as any).resolveProtocol(undefined, {
      headers: { host: 'localhost' },
    });
    expect(result).toBe(projectKernel.__projectProtocol);
    expect(f.kernelManager.getOrCreate).toHaveBeenCalledWith('proj_local');
  });

  it('returns control-plane protocol when nothing resolves', async () => {
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn().mockResolvedValue(null),
        resolveById: vi.fn().mockResolvedValue(null),
      },
      defaultProvider: () => undefined,
    });
    const result = await (f.rest as any).resolveProtocol(undefined, {
      headers: { host: 'localhost', 'x-environment-id': 'proj_unknown' },
    });
    expect(result).toBe(f.controlProtocol);
    expect(f.kernelManager.getOrCreate).not.toHaveBeenCalled();
  });

  it('always returns control-plane for the reserved "platform" id', async () => {
    const f = makeFixture({
      envRegistry: {
        resolveByHostname: vi.fn(),
        resolveById: vi.fn(),
      },
      defaultProvider: () => 'proj_local',
    });
    const result = await (f.rest as any).resolveProtocol('platform', {
      headers: { 'x-environment-id': 'proj_local' },
    });
    expect(result).toBe(f.controlProtocol);
    expect(f.kernelManager.getOrCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// mapDataError — schema-mismatch & required-field violations must surface as
// structured 4xx, never a leaked 500 DATABASE_ERROR (repro: B7 POST
// /data/sys_team with a body whose fields don't match the table).
// ---------------------------------------------------------------------------
describe('mapDataError — schema/constraint envelopes', () => {
  const sqliteError = (message: string, code = 'SQLITE_ERROR') =>
    Object.assign(new Error(message), { code });

  it('maps SQLite "has no column named" → 400 INVALID_FIELD with the field', () => {
    const r = mapDataError(
      sqliteError(
        "insert into `sys_team` (`id`, `label`, `name`) values (?, ?, ?) returning * - table sys_team has no column named label",
      ),
      'sys_team',
    );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_FIELD');
    expect(r.body.field).toBe('label');
    expect(r.body.object).toBe('sys_team');
    expect(String(r.body.error)).not.toMatch(/insert into|sqlite/i);
  });

  it('maps SQLite "no such column" → 400 INVALID_FIELD', () => {
    const r = mapDataError(sqliteError('no such column: bogus'), 'widget');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_FIELD');
    expect(r.body.field).toBe('bogus');
  });

  it('maps MySQL "Unknown column" → 400 INVALID_FIELD', () => {
    const r = mapDataError(sqliteError("Unknown column 'label' in 'field list'", 'ER_BAD_FIELD_ERROR'), 'sys_team');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_FIELD');
    expect(r.body.field).toBe('label');
  });

  it('maps Postgres "column ... of relation ... does not exist" → 400 INVALID_FIELD (not 404 object_not_found)', () => {
    const r = mapDataError(
      sqliteError('column "label" of relation "sys_team" does not exist', '42703'),
      'sys_team',
    );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_FIELD');
    expect(r.body.field).toBe('label');
  });

  it('maps SQLite NOT NULL constraint → 400 VALIDATION_FAILED with required field', () => {
    const r = mapDataError(
      sqliteError(
        "insert into `sys_team` ... - NOT NULL constraint failed: sys_team.organization_id",
        'SQLITE_CONSTRAINT_NOTNULL',
      ),
      'sys_team',
    );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(r.body.fields).toEqual([
      { field: 'organization_id', code: 'required', message: 'organization_id is required' },
    ]);
  });

  it('maps Postgres not-null violation → 400 VALIDATION_FAILED', () => {
    const r = mapDataError(
      sqliteError('null value in column "organization_id" of relation "sys_team" violates not-null constraint', '23502'),
      'sys_team',
    );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect((r.body.fields as any[])[0].field).toBe('organization_id');
  });

  it('still hides genuine SQL leaks (unrecognized driver dump) behind a generic 500', () => {
    const r = mapDataError(sqliteError('SQLITE_IOERR: disk I/O error', 'SQLITE_IOERR'), 'sys_team');
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('DATABASE_ERROR');
    expect(String(r.body.error)).not.toMatch(/disk i\/o/i);
  });

  it('still maps unique-constraint violations to 409 (unchanged)', () => {
    const r = mapDataError(
      sqliteError('UNIQUE constraint failed: sys_team.name, sys_team.organization_id', 'SQLITE_CONSTRAINT_UNIQUE'),
      'sys_team',
    );
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('UNIQUE_VIOLATION');
  });
});

// ---------------------------------------------------------------------------
// Discovery — MCP advertisement (#152)
// ---------------------------------------------------------------------------

describe('discovery — routes.mcp (ADR-0036, #152)', () => {
  function discoveryHandler() {
    const server = createMockServer();
    const protocol = createMockProtocol();
    // protocol discovery carries a `routes` object the server augments.
    (protocol.getDiscovery as any) = vi.fn().mockResolvedValue({ routes: { data: '', metadata: '' } });
    const rest = new RestServer(server as any, protocol as any);
    rest.registerRoutes();
    const entry = rest.getRouteManager().get('GET', '/api/v1/discovery');
    if (!entry) throw new Error('discovery route not registered');
    return entry.handler as (req: any, res: any) => Promise<void>;
  }

  async function invoke(handler: (req: any, res: any) => Promise<void>) {
    let body: any;
    const res: any = { json: (b: any) => { body = b; }, status: () => res };
    await handler({ params: {} }, res);
    return body;
  }

  const prev = process.env.OS_MCP_SERVER_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
  });

  it('advertises routes.mcp when OS_MCP_SERVER_ENABLED=true', async () => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    const body = await invoke(discoveryHandler());
    expect(body.routes.mcp).toBe('/api/v1/mcp');
  });

  it('omits routes.mcp when MCP is not enabled (opt-in)', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const body = await invoke(discoveryHandler());
    expect(body.routes.mcp).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Metadata translation — envelope unwrapping
//
// Regression guard for the Setup-app i18n gap: `getMetaItem` returns an
// envelope `{ type, name, item, ... }` whose translatable document (and its
// `navigation` tree) is nested at `.item`. Translating the envelope's top
// level instead of the inner doc left every nav label in English. The
// single-item app route bypasses the HTTP cache (for per-user RBAC
// filtering), so it only ever sees the envelope shape.
// ──────────────────────────────────────────────────────────────────────────
describe('RestServer metadata translation — envelope unwrap', () => {
  // Minimal i18n service exposing one zh-CN bundle for the `setup` app.
  const fakeI18n = {
    getLocales: () => ['zh-CN'],
    getDefaultLocale: () => 'zh-CN',
    getTranslations: (locale: string) =>
      locale === 'zh-CN'
        ? {
            apps: {
              setup: {
                label: '系统设置',
                navigation: {
                  group_configuration: { label: '配置' },
                  nav_settings_storage: { label: '文件存储' },
                },
              },
            },
          }
        : undefined,
  };
  const zhReq = { headers: { 'accept-language': 'zh-CN' } };
  // A fresh app document each call (helpers must not mutate the input).
  const makeDoc = () => ({
    name: 'setup',
    label: 'Setup',
    navigation: [
      {
        id: 'group_configuration',
        type: 'group',
        label: 'Configuration',
        children: [{ id: 'nav_settings_storage', type: 'url', label: 'File Storage' }],
      },
    ],
  });

  it('translates the inner document of a getMetaItem envelope', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any);
    const envelope = { type: 'app', name: 'setup', item: makeDoc(), lock: null };
    const out = await (rest as any).translateMetaItem(zhReq, 'app', undefined, envelope, fakeI18n);
    // Envelope shape preserved …
    expect(out.type).toBe('app');
    expect(out.name).toBe('setup');
    expect(out.lock).toBeNull();
    // … and the nested doc — not the envelope top level — is translated.
    expect(out.item.label).toBe('系统设置');
    expect(out.item.navigation[0].label).toBe('配置');
    expect(out.item.navigation[0].children[0].label).toBe('文件存储');
  });

  it('still translates a bare (already-unwrapped) document', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any);
    const out = await (rest as any).translateMetaItem(zhReq, 'app', undefined, makeDoc(), fakeI18n);
    expect(out.label).toBe('系统设置');
    expect(out.navigation[0].children[0].label).toBe('文件存储');
  });

  it('translates list responses in the `{ items: [...] }` envelope shape', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any);
    // translateMetaItems resolves the i18n service itself; stub the lookup.
    (rest as any).resolveI18nService = async () => fakeI18n;
    const listEnvelope = { items: [{ type: 'app', name: 'setup', item: makeDoc() }] };
    const out = await (rest as any).translateMetaItems(zhReq, 'app', undefined, listEnvelope);
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items[0].item.navigation[0].children[0].label).toBe('文件存储');
  });

  it('translates a bare array of unwrapped documents', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any);
    (rest as any).resolveI18nService = async () => fakeI18n;
    const out = await (rest as any).translateMetaItems(zhReq, 'app', undefined, [makeDoc()]);
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].navigation[0].children[0].label).toBe('文件存储');
  });
});

// ---------------------------------------------------------------------------
// ADR-0045 — hidden-app visibility gate (filterAppForUser)
// ---------------------------------------------------------------------------

describe('filterAppForUser — ADR-0045 hidden-app gate', () => {
  const make = () => new RestServer(createMockServer() as any, createMockProtocol() as any);
  const hiddenApp = { name: 'production_management', hidden: true, navigation: [] };
  const visibleApp = { name: 'crm', navigation: [] };

  it('drops a hidden app for users without builder access', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(hiddenApp, new Set<string>())).toBeNull();
    expect(rest.filterAppForUser(hiddenApp, new Set(['manage_users']))).toBeNull();
  });

  it('returns a hidden app to builders (studio.access or setup.access)', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(hiddenApp, new Set(['studio.access']))?.name).toBe('production_management');
    expect(rest.filterAppForUser(hiddenApp, new Set(['setup.access']))?.name).toBe('production_management');
  });

  it('leaves visible apps untouched for everyone', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(visibleApp, new Set<string>())?.name).toBe('crm');
  });

  it('still applies requiredPermissions to hidden apps builders can see', () => {
    const rest: any = make();
    const gated = { ...hiddenApp, requiredPermissions: ['manage_platform_settings'] };
    expect(rest.filterAppForUser(gated, new Set(['studio.access']))).toBeNull();
    expect(
      rest.filterAppForUser(gated, new Set(['studio.access', 'manage_platform_settings']))?.name,
    ).toBe('production_management');
  });
});

// ---------------------------------------------------------------------------
// ADR-0057 D10 — requiresService capability gate (filterAppForUser)
// ---------------------------------------------------------------------------

describe('filterAppForUser — ADR-0057 D10 requiresService gate', () => {
  const make = () => new RestServer(createMockServer() as any, createMockProtocol() as any);
  const app = () => ({
    name: 'setup',
    navigation: [
      { id: 'nav_users', type: 'object' },
      { id: 'nav_business_units', type: 'object', requiresObject: 'sys_business_unit' },
      { id: 'nav_organizations', type: 'object', requiresService: 'org-scoping' },
      { id: 'nav_invitations', type: 'object', requiresService: 'org-scoping' },
    ],
  });
  const ids = (a: any): string[] => (a?.navigation ?? []).map((e: any) => e.id);

  it('drops requiresService entries when the gate reports the service absent', () => {
    const rest: any = make();
    const out = rest.filterAppForUser(app(), new Set<string>(), (n: string) => n !== 'org-scoping');
    expect(ids(out)).toEqual(['nav_users', 'nav_business_units']);
  });

  it('keeps requiresService entries when the service is present', () => {
    const rest: any = make();
    const out = rest.filterAppForUser(app(), new Set<string>(), () => true);
    expect(ids(out)).toContain('nav_organizations');
    expect(ids(out)).toContain('nav_invitations');
  });

  it('fail-open: with no service gate, requiresService entries are kept (prior behaviour)', () => {
    const rest: any = make();
    expect(ids(rest.filterAppForUser(app(), new Set<string>()))).toContain('nav_organizations');
  });

  it('the service gate does not touch requiresObject entries (client-side concern)', () => {
    const rest: any = make();
    const out = rest.filterAppForUser(app(), new Set<string>(), () => false);
    expect(ids(out)).toContain('nav_business_units');
    expect(ids(out)).not.toContain('nav_organizations');
  });

  it('resolveRegisteredServices probes only referenced services and reports presence', async () => {
    const rest: any = make();
    const kernel = { getServiceAsync: async (n: string) => { if (n === 'org-scoping') return {}; throw new Error('not registered'); } };
    const reg = await rest.resolveRegisteredServices(kernel, [app()]);
    expect(reg.has('org-scoping')).toBe(true);
    expect(reg.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Object API exposure — enable.apiEnabled / enable.apiMethods (ADR-0049 #1889)
// ---------------------------------------------------------------------------

describe('RestServer — object API exposure (apiEnabled / apiMethods)', () => {
  function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
  }
  // Build a server with one object whose `enable` block is under test.
  function setup(enable: any | undefined) {
    const server = createMockServer();
    const protocol = createMockProtocol();
    protocol.batchData = vi.fn().mockResolvedValue({});
    protocol.createManyData = vi.fn().mockResolvedValue([]);
    protocol.updateManyData = vi.fn().mockResolvedValue([]);
    protocol.deleteManyData = vi.fn().mockResolvedValue([]);
    protocol.getMetaItems = vi.fn().mockResolvedValue(
      enable === undefined
        ? [{ name: 'widget' }]
        : [{ name: 'widget', enable }],
    );
    const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    return { rest, protocol };
  }
  async function invoke(rest: any, method: string, path: string, params: any, body?: any) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`route not found: ${method} ${path}`);
    const res = makeRes();
    await route.handler({ method, params, query: {}, body: body ?? {} }, res);
    return res;
  }
  const LIST = '/api/v1/data/:object';
  const BY_ID = '/api/v1/data/:object/:id';

  it('apiEnabled:false → 404 on list, and the data engine is never called', async () => {
    const { rest, protocol } = setup({ apiEnabled: false });
    const res = await invoke(rest, 'GET', LIST, { object: 'widget' });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('OBJECT_API_DISABLED');
    expect(protocol.findData).not.toHaveBeenCalled();
  });

  it('apiEnabled:false → 404 on create (write blocked too)', async () => {
    const { rest, protocol } = setup({ apiEnabled: false });
    const res = await invoke(rest, 'POST', LIST, { object: 'widget' }, { a: 1 });
    expect(res.statusCode).toBe(404);
    expect(protocol.createData).not.toHaveBeenCalled();
  });

  it('apiMethods whitelist → disallowed op returns 405', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list'] });
    const res = await invoke(rest, 'POST', LIST, { object: 'widget' }, { a: 1 });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(res.body.allowed).toEqual(['get', 'list']);
    expect(protocol.createData).not.toHaveBeenCalled();
  });

  it('apiMethods whitelist → allowed op passes through to the engine', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list'] });
    const res = await invoke(rest, 'GET', LIST, { object: 'widget' });
    expect(res.statusCode).toBe(200);
    expect(protocol.findData).toHaveBeenCalledTimes(1);
  });

  it('default object (no enable block) is unaffected — no regression', async () => {
    const { rest, protocol } = setup(undefined);
    const res = await invoke(rest, 'GET', LIST, { object: 'widget' });
    expect(res.statusCode).toBe(200);
    expect(protocol.findData).toHaveBeenCalledTimes(1);
  });

  it('apiEnabled:true explicit → passes', async () => {
    const { rest, protocol } = setup({ apiEnabled: true });
    await invoke(rest, 'GET', BY_ID, { object: 'widget', id: '1' });
    expect(protocol.getData).toHaveBeenCalledTimes(1);
  });

  it('unknown object (not in metadata) is not blocked by the guard', async () => {
    const { rest, protocol } = setup({ apiEnabled: false }); // only 'widget' is hidden
    const res = await invoke(rest, 'GET', LIST, { object: 'other' });
    expect(res.statusCode).toBe(200);
    expect(protocol.findData).toHaveBeenCalledTimes(1);
  });

  it('apiEnabled:false also blocks bulk createMany', async () => {
    const { rest, protocol } = setup({ apiEnabled: false });
    const res = await invoke(rest, 'POST', '/api/v1/data/:object/createMany', { object: 'widget' }, []);
    expect(res.statusCode).toBe(404);
    expect(protocol.createManyData).not.toHaveBeenCalled();
  });
});
