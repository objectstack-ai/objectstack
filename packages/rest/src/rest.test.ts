// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ExcelJS from 'exceljs';
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
      // The producer's key is `routes` (`ApiRoutesSchema`, required by
      // `DiscoverySchema`). `endpoints` was a dispatcher-only verbatim copy of
      // it, retired in #4828 — a double that spells it is teaching a shape no
      // producer ever emitted (#5674). Copy this mock, not that one.
      routes: { data: '', metadata: '', ui: '', auth: '/auth' },
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

// The platform default is secure-by-default (`requireAuth` defaults to true,
// ADR-0056 D2). These unit tests dispatch route handlers with NO auth context
// on purpose — they exercise routing/CRUD mechanics, not the auth gate (that
// is covered by rest-auth-gate.test.ts + the anonymous-deny dogfood proof) —
// so they opt out explicitly, like an intentionally-public deployment would.
const ANON_API = { api: { requireAuth: false } };

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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();

      const paths = rest.getRoutes().map((r) => r.path);
      expect(paths.some((p) => p.startsWith('/custom/path'))).toBe(true);
    });

    it('should skip CRUD routes when enableCrud is false', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { enableCrud: false },
      } as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();

      const tags = rest.getRoutes().flatMap((r) => r.metadata?.tags ?? []);
      expect(tags).not.toContain('crud');
    });

    it('should skip metadata routes when enableMetadata is false', () => {
      const rest = new RestServer(server as any, protocol as any, {
        api: { enableMetadata: false },
      } as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();

      const tags = rest.getRoutes().flatMap((r) => r.metadata?.tags ?? []);
      expect(tags).not.toContain('batch');
    });

    it('should register batch endpoints when protocol implements batch methods', () => {
      protocol.batchData = vi.fn().mockResolvedValue({});
      protocol.createManyData = vi.fn().mockResolvedValue([]);
      protocol.updateManyData = vi.fn().mockResolvedValue([]);
      protocol.deleteManyData = vi.fn().mockResolvedValue([]);

      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();

      const batchRoutes = rest.getRoutes().filter((r) =>
        r.metadata?.tags?.includes('batch'),
      );
      expect(batchRoutes.length).toBeGreaterThan(0);
    });

    it('should register UI view endpoint when enableUi is true', () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();

      const uiRoutes = rest.getRoutes().filter((r) =>
        r.metadata?.tags?.includes('ui'),
      );
      expect(uiRoutes.length).toBeGreaterThan(0);
    });

    it('should not register i18n endpoints (i18n routes are self-registered by service-i18n)', () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      const rm = rest.getRouteManager();
      expect(rm).toBeInstanceOf(RouteManager);
    });
  });

  describe('getRoutes', () => {
    it('should return an empty array before registerRoutes is called', () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      // expand/select absent; the resolved caller context IS forwarded (#3963).
      expect(callArg).toEqual({ object: 'contact', id: 'c_1', context: { userId: 'test-user' } });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      expect(cloneRoute(rest)).toBeDefined();
    });

    it('forwards object/id and nested overrides to protocol.cloneData and responds 201', async () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, noClone as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

  describe('meta book/doc audience gating (ADR-0046 §6.7 / ADR-0090)', () => {
    function getMetaRoute(rest: any, method: string, path: string) {
      return rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    }
    const mockRes = () => ({
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      header: vi.fn(),
      send: vi.fn(),
    });
    const BOOKS = [
      { name: 'pub_book', audience: 'public', groups: [{ key: 'g', label: 'G', include: 'pub_*' }], _packageId: 'pkg' },
      { name: 'org_book', groups: [{ key: 'g', label: 'G', include: 'org_*' }], _packageId: 'pkg' },
      { name: 'gated_book', audience: { permissionSet: 'crm_admin' }, groups: [{ key: 'g', label: 'G', include: 'gated_*' }], _packageId: 'pkg' },
    ];
    const DOCS = [
      { name: 'pub_intro', _packageId: 'pkg' },
      { name: 'org_intro', _packageId: 'pkg' },
      { name: 'gated_setup', _packageId: 'pkg' },
    ];
    const metaByType = (books: any[] = BOOKS, docs: any[] = DOCS) =>
      vi.fn().mockImplementation(async ({ type }: any) =>
        type === 'book' ? books : type === 'doc' ? docs : []);

    it('tree: anonymous caller is 401ed off a non-public book', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/book/:name/tree');
      const res = mockRes();
      await route!.handler({ params: { name: 'org_book' }, query: {}, headers: {} }, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('tree: anonymous caller gets a public book, with non-public docs filtered OUT of the tree', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/book/:name/tree');
      const res = mockRes();
      await route!.handler({ params: { name: 'pub_book' }, query: {}, headers: {} }, res);
      expect(res.status).not.toHaveBeenCalledWith(401);
      const tree = res.json.mock.calls.at(-1)![0];
      const docsInTree = tree.groups.flatMap((g: any) => g.entries.map((e: any) => e.doc));
      expect(docsInTree).toContain('pub_intro');
      // org_intro / gated_setup are claimed by other books; the orphan pass
      // would render them, but the audience filter must drop them for anon.
      expect(docsInTree).not.toContain('org_intro');
      expect(docsInTree).not.toContain('gated_setup');
    });

    it('tree: authenticated non-holder is 403ed off a permission-set-gated book (fail closed without security service)', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = vi.fn().mockResolvedValue({ userId: 'u1' });
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/book/:name/tree');
      const res = mockRes();
      await route!.handler({ params: { name: 'gated_book' }, query: {}, headers: {} }, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('tree: a holder resolved through the security service opens the gated book', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = vi.fn().mockResolvedValue({ userId: 'u1' });
      (rest as any).securityServiceProvider = async () => ({
        resolvePermissionSetNames: async () => ['member_default', 'crm_admin'],
      });
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/book/:name/tree');
      const res = mockRes();
      await route!.handler({ params: { name: 'gated_book' }, query: {}, headers: {} }, res);
      expect(res.status).not.toHaveBeenCalledWith(401);
      expect(res.status).not.toHaveBeenCalledWith(403);
      const tree = res.json.mock.calls.at(-1)![0];
      const docsInTree = tree.groups.flatMap((g: any) => g.entries.map((e: any) => e.doc));
      expect(docsInTree).toContain('gated_setup');
    });

    it('list: anonymous /meta/book returns only public books', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type');
      const res = mockRes();
      await route!.handler({ params: { type: 'book' }, query: {}, headers: {} }, res);
      const body = res.json.mock.calls.at(-1)![0];
      expect(body.map((b: any) => b.name)).toEqual(['pub_book']);
    });

    it('list: anonymous /meta/doc returns only docs whose effective audience is public', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type');
      const res = mockRes();
      await route!.handler({ params: { type: 'doc' }, query: {}, headers: {} }, res);
      const body = res.json.mock.calls.at(-1)![0];
      expect(body.map((d: any) => d.name)).toEqual(['pub_intro']);
    });

    it('list: authenticated member sees org + public docs but not gated-only docs', async () => {
      protocol.getMetaItems = metaByType();
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = vi.fn().mockResolvedValue({ userId: 'u1' });
      (rest as any).securityServiceProvider = async () => ({
        resolvePermissionSetNames: async () => ['member_default'],
      });
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type');
      const res = mockRes();
      await route!.handler({ params: { type: 'doc' }, query: {}, headers: {} }, res);
      const body = res.json.mock.calls.at(-1)![0];
      expect(body.map((d: any) => d.name).sort()).toEqual(['org_intro', 'pub_intro']);
    });

    it('item: anonymous GET of an org-only doc is 401; of a public-claimed doc succeeds', async () => {
      protocol.getMetaItems = metaByType();
      // `getMetaItem` answers the `{ type, name, item }` envelope (#5563) — the
      // audience gate reads the document's `audience`, so it must reach through
      // `item`, and the served body keeps the envelope around it.
      protocol.getMetaItem = vi.fn().mockImplementation(async ({ type, name }: any) => ({
        type, name, item: DOCS.find((d) => d.name === name),
      }));
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type/:name');
      const resDenied = mockRes();
      await route!.handler({ params: { type: 'doc', name: 'org_intro' }, query: {}, headers: {} }, resDenied);
      expect(resDenied.status).toHaveBeenCalledWith(401);
      const resOk = mockRes();
      await route!.handler({ params: { type: 'doc', name: 'pub_intro' }, query: {}, headers: {} }, resOk);
      expect(resOk.status).not.toHaveBeenCalledWith(401);
      const okBody = resOk.json.mock.calls.at(-1)![0];
      expect(okBody).toMatchObject({ type: 'doc', name: 'pub_intro' });
      expect(okBody.item).toMatchObject({ name: 'pub_intro' });
    });

    it('item: gated book GET bypasses the shared cache and 403s a non-holder', async () => {
      protocol.getMetaItemCached = vi.fn();
      protocol.getMetaItems = metaByType();
      protocol.getMetaItem = vi.fn().mockResolvedValue({
        type: 'book', name: 'gated_book', item: BOOKS[2],
      });
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = vi.fn().mockResolvedValue({ userId: 'u1' });
  rest.registerRoutes();
      const route = getMetaRoute(rest, 'GET', '/api/v1/meta/:type/:name');
      const res = mockRes();
      await route!.handler({ params: { type: 'book', name: 'gated_book' }, query: {}, headers: {} }, res);
      expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('meta single-item Cache-Control header (cached path)', () => {
    function getMetaItemRoute(rest: any) {
      return rest
        .getRoutes()
        .find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    }
    const mockRes = () => ({
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      header: vi.fn(),
      send: vi.fn(),
    });
    const cacheControlOf = (res: any) =>
      res.header.mock.calls.find((c: any[]) => c[0] === 'Cache-Control')?.[1];

    it('emits a revalidate-always header (no max-age TTL) for object meta reads', async () => {
      // Object metadata is invalidated by publish, so the response must force an
      // ETag revalidation rather than pin a stale schema for up to an hour — the
      // AI-build "New" form kept showing pre-publish fields under the old
      // `max-age=3600`. Mirrors the shape protocol.getMetaItemCached now returns.
      protocol.getMetaItemCached = vi.fn().mockResolvedValue({
        data: { name: 'lead' },
        etag: { value: 'abc', weak: false },
        cacheControl: { directives: ['private', 'no-cache'] },
        notModified: false,
      });
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getMetaItemRoute(rest);
      expect(route).toBeDefined();

      const res = mockRes();
      await route!.handler(
        { params: { type: 'object', name: 'lead' }, query: {}, headers: {} },
        res,
      );

      expect(protocol.getMetaItemCached).toHaveBeenCalled();
      expect(cacheControlOf(res)).toBe('private, no-cache');
      expect(cacheControlOf(res)).not.toMatch(/max-age/);
    });

    it('appends max-age once and never the malformed bare-token duplicate', async () => {
      // Regression guard: a `max-age` placeholder directive in the array plus a
      // `maxAge` value used to concatenate into `public, max-age, max-age=3600`.
      // The bare token must be stripped so the header is a single well-formed
      // `max-age=N`.
      protocol.getMetaItemCached = vi.fn().mockResolvedValue({
        data: { name: 'lead' },
        etag: { value: 'abc', weak: false },
        cacheControl: { directives: ['public', 'max-age'], maxAge: 3600 },
        notModified: false,
      });
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getMetaItemRoute(rest);

      const res = mockRes();
      await route!.handler(
        { params: { type: 'object', name: 'lead' }, query: {}, headers: {} },
        res,
      );

      expect(cacheControlOf(res)).toBe('public, max-age=3600');
      expect(cacheControlOf(res)).not.toContain('max-age,');
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        context: { userId: 'test-user' },
      });
    });

    it('should pass populate query param to protocol.findData', async () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        context: { userId: 'test-user' },
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      expect(headers['Content-Disposition']).toMatch(/attachment; filename="account-\d{8}-\d{6}\.csv"; filename\*=UTF-8''/);
      const text = chunks.join('');
      expect(text.startsWith('id,name,note\r\n')).toBe(true);
      expect(text).toContain('1,"Acme, Inc.","line1\nline2"');
      expect(text).toContain('2,"Beta ""Co""",');
      expect(res.end).toHaveBeenCalled();
    });

    it('streams JSON array when format=json', async () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

    // [#4181] Was `INVALID_REQUEST`. The list path now rejects the same input
    // with the purpose-built `INVALID_FILTER` (the standard-catalog code #4121
    // introduced for malformed filter arrays), so export moves onto it too —
    // otherwise a client handling "my filter was refused" needs two codes
    // depending on which URL it called. Deliberate wire change; the status and
    // the message are unchanged.
    it('rejects invalid JSON in filter query with the shared malformed-filter code', async () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res } = makeRes();
      await route!.handler({
        params: { object: 'account' },
        query: { filter: '{not json' },
      } as any, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_FILTER', error: 'filter must be JSON' }),
      );
    });

    // [#4181] The sibling guard one block down: an unparseable `orderby` used to
    // fall through to `undefined` and export UNSORTED. Keeps `INVALID_REQUEST` —
    // a sort is not a filter, and the row set was never wrong.
    it('rejects invalid JSON in orderby query instead of exporting unsorted', async () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
      rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res } = makeRes();
      await route!.handler({
        params: { object: 'account' },
        query: { orderby: '{not json' },
      } as any, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_REQUEST', error: 'orderby must be JSON' }),
      );
    });

    it('honours the hard 50k row cap', async () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

    // Binary-aware response double for the xlsx path (chunks are Buffers).
    function makeBinRes() {
      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};
      const res: any = {
        write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
        end: vi.fn(),
        header: (n: string, v: string) => { headers[n] = v; return res; },
        status: () => res,
        json: vi.fn(),
      };
      return { res, getBuffer: () => Buffer.concat(chunks), headers };
    }

    // Schema exercising every formatted field type. The export route reads it via
    // the real metadata accessor `getMetaItem({type:'object', name})`, which
    // returns an envelope whose `.item` is the schema document (see
    // export-integration.test.ts for the same path against a real engine).
    const TASK_SCHEMA = {
      fields: [
        { name: 'id', type: 'text', label: 'ID' },
        { name: 'title', type: 'text', label: '标题' },
        { name: 'done', type: 'boolean', label: '完成' },
        { name: 'priority', type: 'select', label: '优先级', options: [
          { label: '高', value: 'high' }, { label: '低', value: 'low' },
        ] },
        { name: 'due', type: 'date', label: '截止' },
        { name: 'owner', type: 'lookup', label: '负责人', reference: 'user', displayField: 'name' },
      ],
    };

    function protocolWithSchema(rows: any[]) {
      const p: any = createMockProtocol();
      // Real accessor: getMetaItem returns the `{type, name, item}` envelope.
      p.getMetaItem = vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: TASK_SCHEMA });
      p.findData = vi.fn()
        .mockResolvedValueOnce({ data: rows })
        .mockResolvedValue({ data: [] });
      return p;
    }

    // The stored row carries raw values; `owner` is an $expand-ed record.
    const RAW_TASK_ROW = {
      id: '1', title: '写代码', done: true, priority: 'high',
      due: '2026-06-30T00:00:00.000Z', owner: { id: 'u1', name: '张三' },
    };

    it('formats values readably in CSV using field metadata', async () => {
      const p = protocolWithSchema([RAW_TASK_ROW]);
      const rest = new RestServer(server as any, p as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res, chunks, headers } = makeRes();
      await route!.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, res);

      expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
      const lines = chunks.join('').split('\r\n');
      // Header row uses schema labels, columns derived from the schema order.
      expect(lines[0]).toBe('ID,标题,完成,优先级,截止,负责人');
      // boolean→是, select→label, date→YYYY-MM-DD, lookup→displayField name.
      expect(lines[1]).toBe('1,写代码,是,高,2026-06-30,张三');
    });

    it('omits the header row when header=false', async () => {
      const p = protocolWithSchema([RAW_TASK_ROW]);
      const rest = new RestServer(server as any, p as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res, chunks } = makeRes();
      await route!.handler({ params: { object: 'task' }, query: { format: 'csv', header: 'false' } } as any, res);

      const lines = chunks.join('').split('\r\n').filter(Boolean);
      // No label header — the first line is the data row.
      expect(lines[0]).toBe('1,写代码,是,高,2026-06-30,张三');
    });

    it('injects $expand for reference fields into the findData query', async () => {
      const p = protocolWithSchema([RAW_TASK_ROW]);
      const rest = new RestServer(server as any, p as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res } = makeRes();
      await route!.handler({ params: { object: 'task' }, query: { format: 'csv' } } as any, res);

      expect(p.findData).toHaveBeenCalled();
      const firstQuery = p.findData.mock.calls[0][0].query;
      expect(firstQuery.$expand).toBe('owner');
    });

    it('formats values readably in JSON, leaving unknown keys untouched', async () => {
      const p = protocolWithSchema([{ ...RAW_TASK_ROW, extra: 'keep' }]);
      const rest = new RestServer(server as any, p as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res, chunks, headers } = makeRes();
      await route!.handler({ params: { object: 'task' }, query: { format: 'json' } } as any, res);

      expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
      const parsed = JSON.parse(chunks.join(''));
      expect(parsed[0]).toMatchObject({
        done: '是', priority: '高', due: '2026-06-30', owner: '张三', extra: 'keep',
      });
    });

    it('streams a valid xlsx workbook with formatted cells', async () => {
      const p = protocolWithSchema([RAW_TASK_ROW]);
      const rest = new RestServer(server as any, p as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      const { res, getBuffer, headers } = makeBinRes();
      await route!.handler({ params: { object: 'task' }, query: { format: 'xlsx' } } as any, res);

      expect(headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(headers['Content-Disposition']).toMatch(/attachment; filename="task-\d{8}-\d{6}\.xlsx"; filename\*=UTF-8''/);
      expect(headers['X-Export-Format']).toBe('xlsx');
      expect(res.end).toHaveBeenCalled();

      const buf = getBuffer();
      // xlsx is a zip — verify the PK signature, then round-trip the content.
      expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.getWorksheet('Export');
      expect(ws).toBeDefined();
      // row.values is 1-indexed (values[0] is empty).
      expect(ws!.getRow(1).values).toEqual([undefined, 'ID', '标题', '完成', '优先级', '截止', '负责人']);
      expect(ws!.getRow(2).values).toEqual([undefined, '1', '写代码', '是', '高', '2026-06-30', '张三']);
    });

    // Regression: the router is first-match-wins with no specificity sorting,
    // so the static-literal `GET /data/:object/export` route MUST be registered
    // BEFORE the greedy `GET /data/:object/:id` matcher. Otherwise a request to
    // `/data/<object>/export` is captured by `:id` ("export" treated as a record
    // id) and 404s with RECORD_NOT_FOUND instead of streaming the export.
    it('registers GET /export ahead of the greedy GET /:object/:id matcher', () => {
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const routes = rest.getRoutes();

      const exportIdx = routes.findIndex(
        (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
      );
      const getByIdIdx = routes.findIndex(
        (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/:id',
      );

      expect(exportIdx).toBeGreaterThanOrEqual(0);
      expect(getByIdIdx).toBeGreaterThanOrEqual(0);
      // First match wins → the more-specific export route must come first.
      expect(exportIdx).toBeLessThan(getByIdIdx);
    });

    // Regression: the header row must carry the same localized field labels the
    // UI renders (Accept-Language / ?locale=), not the raw `field.label` from the
    // object schema. The route translates the schema via `translateMetaItem`
    // before building the header, so a locale switch flips the header language.
    it('localizes the export header row to the request locale', async () => {
      // Schema field labels are deliberately distinct from the bundle so a
      // green assertion proves the bundle was applied (not the raw labels).
      const NAMED_SCHEMA = {
        name: 'task',
        fields: [
          { name: 'id', type: 'text', label: 'ID' },
          { name: 'title', type: 'text', label: 'RawTitle' },
          { name: 'done', type: 'boolean', label: 'RawDone' },
        ],
      };
      const bundle: Record<string, any> = {
        en: { objects: { task: { fields: { title: { label: 'Title' }, done: { label: 'Done' } } } } },
        zh: { objects: { task: { fields: { title: { label: '标题' }, done: { label: '完成' } } } } },
      };
      const i18n = {
        getLocales: () => ['en', 'zh'],
        getTranslations: (l: string) => bundle[l],
        getDefaultLocale: () => 'en',
      };

      const p: any = createMockProtocol();
      p.getMetaItem = vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: NAMED_SCHEMA });
      // First page returns one row, subsequent pages are empty (ends the stream).
      p.findData = vi.fn(async ({ query }: any) =>
        (query?.$skip ?? 0) === 0 ? { data: [{ id: '1', title: 'x', done: true }] } : { data: [] },
      );

      // i18nServiceProvider is the 14th constructor arg (after server, protocol,
      // config, and the 10 service providers preceding it).
      const rest = new RestServer(
        server as any, p as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        async () => i18n as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const route = getExportRoute(rest);

      // locale=zh → Chinese header; `id` has no override so it keeps its label.
      const zh = makeRes();
      await route!.handler({
        params: { object: 'task' },
        query: { format: 'csv', fields: 'id,title,done', locale: 'zh' },
        headers: {},
      } as any, zh.res);
      expect(zh.chunks.join('').split('\r\n')[0]).toBe('ID,标题,完成');

      // Default locale (en, no ?locale=) → English header from the bundle,
      // i.e. 'Title'/'Done', never the raw 'RawTitle'/'RawDone'.
      const en = makeRes();
      await route!.handler({
        params: { object: 'task' },
        query: { format: 'csv', fields: 'id,title,done' },
        headers: {},
      } as any, en.res);
      expect(en.chunks.join('').split('\r\n')[0]).toBe('ID,Title,Done');
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        provider as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        provider as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      const rest = new RestServer(server as any, protocol as any, ANON_API as any);
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, provider as any,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
      const { revoke: route } = getShareRoutes(rest);
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
      await route!.handler({ params: { object: 'account', id: 'a1', shareId: 'shr_X' } } as any, res as any);
      expect(revoke).toHaveBeenCalledWith(
        'shr_X',
        expect.anything(),
        // [ADR-0111 D4] The URL's record is forwarded as the revoke scope
        // so a share id cannot be revoked through an unrelated path.
        { object: 'account', recordId: 'a1' },
      );
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
        server as any, protocol as any, ANON_API as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, provider,
      );
      (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
    const rest = new RestServer(server as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
    const rest = new RestServer(server as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
    const rest = new RestServer(server as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

  it('maps a thrown METADATA_CONFLICT (409) to a 409 response with the code', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const err: any = new Error('parentVersion mismatch');
    err.code = 'METADATA_CONFLICT';
    err.status = 409;
    protocol.saveMetaItem = vi.fn().mockRejectedValue(err);
    const rest = new RestServer(server as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
    const route = getPutRoute(rest, '/api/v1/meta/:type/:name');

    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await route.handler(
      { params: { type: 'view', name: 'cases' }, headers: { 'if-match': 'sha256:stale' }, body: {} },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'METADATA_CONFLICT' }));
  });
});

// ---------------------------------------------------------------------------
// RestServer — project-scoped routing (Phase 2)
// ---------------------------------------------------------------------------

describe('RestServer project-scoped routing', () => {
  it('only registers unscoped routes by default', () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' } as any,
    } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'required' } as any,
    } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();

    const paths = rest.getRoutes().map(r => r.path);
    expect(paths).toContain('/api/v1/environments/:environmentId/data/:object');
    expect(paths).not.toContain('/api/v1/data/:object');
  });

  it('scoped CRUD handler forwards req.params.environmentId into the protocol call', async () => {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const rest = new RestServer(server as any, protocol as any, {
      api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'required' } as any,
    } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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
      api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' } as any,
    } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

  // #2707: plugin-audit's engine hook rejects sys_comment creation when the
  // TARGET object declares `enable.feeds: false`. The generic data routes map
  // errors through mapDataError (not sendError's `.status` passthrough), so
  // the code needs its own branch — without it the 403 degraded to the
  // catch-all 400 (caught live in the runtime smoke test).
  // #3828: an object whose declared datasource is refused by the host policy,
  // or failed to connect under OS_ALLOW_DRIVER_CONNECT_FAILURE. Nothing about
  // the REQUEST is wrong, so 4xx lies; and it is a dependency/policy state that
  // may clear, so 503 is more honest (and more actionable to a proxy) than 500.
  it('maps ERR_DATASOURCE_UNAVAILABLE → 503 with the datasource and reason class', () => {
    const r = mapDataError(
      Object.assign(
        new Error(
          "[ObjectQL] Datasource 'analytics' configured for object 'visit' is declared but not connected: " +
          "the host's datasource connect policy refused it. External datasources require the Scale plan. " +
          'See the startup logs or Setup → Datasources for the cause.',
        ),
        { code: 'ERR_DATASOURCE_UNAVAILABLE', datasource: 'analytics', kind: 'blocked' },
      ),
      'visit',
    );
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
    expect(r.body.datasource).toBe('analytics');
    expect(r.body.reason).toBe('blocked');
    expect(r.body.object).toBe('visit');
    // The message is sanitised at the throw site, so it passes through as-is.
    expect(String(r.body.error)).toContain('require the Scale plan');
  });

  it('does not downgrade ERR_DATASOURCE_UNAVAILABLE to the generic 400 catch-all', () => {
    const r = mapDataError(
      Object.assign(new Error("Datasource 'x' ... is declared but not connected"), {
        code: 'ERR_DATASOURCE_UNAVAILABLE',
        kind: 'failed',
      }),
    );
    expect(r.status).toBe(503);
  });

  it('maps FEEDS_DISABLED → 403 with the gated target object', () => {
    const r = mapDataError(
      Object.assign(new Error("Comments are disabled for object 'gate_probe' (enable.feeds: false)"), {
        code: 'FEEDS_DISABLED',
        status: 403,
        object: 'gate_probe',
      }),
      'sys_comment',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FEEDS_DISABLED');
    // Prefers the gated target object over the route's object (sys_comment).
    expect(r.body.object).toBe('gate_probe');
  });

  // #2727: same shape for the opt-in attachments gate on sys_attachment.
  it('maps FILES_DISABLED → 403 with the gated target object', () => {
    const r = mapDataError(
      Object.assign(new Error("File attachments are not enabled for object 'crm_lead' (requires enable.files: true)"), {
        code: 'FILES_DISABLED',
        status: 403,
        object: 'crm_lead',
      }),
      'sys_attachment',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FILES_DISABLED');
    expect(r.body.object).toBe('crm_lead');
  });

  // #2755: attachment access gates from service-storage's engine hooks —
  // same generic-data-path rationale as the capability gates above.
  it('maps ATTACHMENT_PARENT_ACCESS → 403 with the parent object', () => {
    const r = mapDataError(
      Object.assign(new Error('Cannot attach to crm_lead/rec1: the parent record does not exist or you do not have access to it'), {
        code: 'ATTACHMENT_PARENT_ACCESS',
        status: 403,
        object: 'crm_lead',
      }),
      'sys_attachment',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ATTACHMENT_PARENT_ACCESS');
    expect(r.body.object).toBe('crm_lead');
  });

  // #4630: the sys_comment record-level gates from plugin-audit's engine
  // hooks. They reuse the STANDARD catalog code rather than a bespoke
  // COMMENT_* one, so this asserts the same object-preference the sibling
  // gates get — the generic 4xx passthrough would report `sys_comment`.
  it('maps RECORD_NOT_ACCESSIBLE → 403 with the record\'s object, not the comment table', () => {
    const r = mapDataError(
      Object.assign(
        new Error('Cannot comment on crm_opportunity/1A7n: the record does not exist or you cannot read it'),
        { code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: 'crm_opportunity' },
      ),
      'sys_comment',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('RECORD_NOT_ACCESSIBLE');
    expect(r.body.object).toBe('crm_opportunity');
  });

  it('maps RECORD_NOT_ACCESSIBLE without a parent object (malformed thread_id) → 403', () => {
    const r = mapDataError(
      Object.assign(new Error('Cannot comment: thread_id "crm_opportunity:" does not name a record'), {
        code: 'RECORD_NOT_ACCESSIBLE',
        status: 403,
      }),
      'sys_comment',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('RECORD_NOT_ACCESSIBLE');
    expect(r.body.object).toBe('sys_comment');
  });

  it('maps ATTACHMENT_DELETE_DENIED → 403', () => {
    const r = mapDataError(
      Object.assign(new Error('Cannot delete attachment a1: only the uploader or a user who can edit the parent record (crm_lead/rec1) may delete it'), {
        code: 'ATTACHMENT_DELETE_DENIED',
        status: 403,
        object: 'crm_lead',
      }),
      'sys_attachment',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ATTACHMENT_DELETE_DENIED');
    expect(r.body.object).toBe('crm_lead');
  });

  // #2926 ⑦: plugin-sharing's record-scope denial throws with an explicit
  // status 403 + code FORBIDDEN, but the generic data routes bypass
  // sendError's `.status` passthrough — mapDataError must honor the
  // explicit status itself or the 403 degrades to the catch-all 400.
  it('passes through an explicit 4xx status + code (sharing FORBIDDEN → 403)', () => {
    const r = mapDataError(
      Object.assign(new Error('FORBIDDEN: insufficient privileges to update showcase_inquiry rec1'), {
        code: 'FORBIDDEN',
        status: 403,
      }),
      'showcase_inquiry',
    );
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN');
    expect(r.body.object).toBe('showcase_inquiry');
    expect(r.body.error).toContain('insufficient privileges');
  });

  it('does NOT pass through an explicit 5xx status (message stays sanitized)', () => {
    const r = mapDataError(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432 (internal pool)'), { status: 502 }),
    );
    // 5xx bypasses the passthrough and falls into the sanitizing heuristics.
    expect(r.status).not.toBe(502);
    expect(r.body.code).not.toBe('FORBIDDEN');
    // [#5489] Both negatives above were satisfied by the OLD landing as well —
    // a 400 carrying `connect ECONNREFUSED 10.0.0.5:5432 (internal pool)`
    // verbatim, which is a server fault wearing a client-error status AND the
    // leak the sanitizing heuristics were supposed to stop. Pinned positively
    // now that the terminal branch is a sanitised 500.
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('INTERNAL_ERROR');
    expect(String(r.body.error)).not.toContain('ECONNREFUSED');
  });

  // [#5423] This case used to assert the oversized message became the literal
  // 'Request failed'. The BOUND is still the guard — an oversized message must
  // not reach the client whole — but it is now enforced by truncating rather
  // than by erasing the body text. Full coverage of the new disposition lives
  // in `rest-4xx-message-truncation.test.ts`.
  it('guards the passthrough message length (oversized → truncated, not erased)', () => {
    const r = mapDataError(Object.assign(new Error('x'.repeat(600)), { status: 403, code: 'FORBIDDEN' }));
    expect(r.status).toBe(403);
    expect(r.body.error).not.toBe('Request failed');
    expect(String(r.body.error)).toHaveLength(500);
    expect(String(r.body.error).endsWith('…')).toBe(true);
  });

  it('keeps CONCURRENT_UPDATE 409 structured fields despite its own status property', () => {
    const r = mapDataError(
      Object.assign(new Error('Record was modified'), {
        code: 'CONCURRENT_UPDATE',
        status: 409,
        currentVersion: 7,
        currentRecord: { id: 'r1' },
      }),
      'sys_task',
    );
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONCURRENT_UPDATE');
    expect(r.body.currentVersion).toBe(7);
    expect(r.body.currentRecord).toEqual({ id: 'r1' });
  });

  it('keeps DELETE_RESTRICTED 409 structured fields despite its own status property', () => {
    const r = mapDataError(
      Object.assign(new Error('Cannot delete sys_position (p1): 1 dependent record'), {
        code: 'DELETE_RESTRICTED',
        status: 409,
        dependentObject: 'sys_position_permission_set',
        dependentCount: 1,
      }),
      'sys_position',
    );
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DELETE_RESTRICTED');
    expect(r.body.dependentCount).toBe(1);
  });

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

  // #4134: the READ half of the same knowledge. The protocol's list normalizer
  // throws a structured INVALID_FIELD rather than letting `?pageSize=5` become
  // a `where.pageSize` predicate that can only return 200 + an empty list.
  // The envelope must match the driver-string branch above field-for-field —
  // one condition, one wire shape, whichever layer noticed it.
  it('maps a structured read-path INVALID_FIELD → 400 with the field (same shape as the write path)', () => {
    const r = mapDataError(
      Object.assign(new Error("Unknown field 'pageSize' on object 'showcase_task'. Did you mean the 'top' query parameter?"), {
        code: 'INVALID_FIELD',
        status: 400,
        field: 'pageSize',
        fields: ['pageSize'],
        object: 'showcase_task',
      }),
      'showcase_task',
    );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_FIELD');
    expect(r.body.field).toBe('pageSize');
    expect(r.body.object).toBe('showcase_task');
    expect(String(r.body.error)).toContain("Unknown field 'pageSize'");
  });

  it('does not let the generic 4xx passthrough swallow INVALID_FIELD\'s `field`', () => {
    // The passthrough branch keeps `code` but drops every structured field, so
    // the dedicated branch has to win the ordering.
    const r = mapDataError(
      Object.assign(new Error("Unknown field 'zzzz' on object 'widget'"), {
        code: 'INVALID_FIELD',
        status: 400,
        field: 'zzzz',
      }),
      'widget',
    );
    expect(r.body.field).toBe('zzzz');
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
    // #2186: reaching this branch means metadata did not require the field, so
    // it is physical-schema drift — surface an actionable hint without breaking
    // the back-compat envelope.
    expect(String(r.body.hint)).toMatch(/os migrate/);
    expect(String(r.body.hint)).toMatch(/drifted from metadata/);
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

  // A sandboxed hook deliberately throwing a business rule (e.g. a
  // referential-integrity guard blocking a delete) must surface only the
  // business message to the client — never the sandbox's
  // `hook '<name>' threw: Error: …` debug wrapper, which reads as English
  // noise in the console's error toast. The wrapper stays in server logs.
  it('unwraps SandboxError.innerMessage → 400 with only the business message', () => {
    const err = Object.assign(
      new Error("hook 'pm_ref_base' threw: Error: 制作基地被「项目主计划批次」引用(3 条),删除被阻断,请先解除引用"),
      { name: 'SandboxError', innerMessage: '制作基地被「项目主计划批次」引用(3 条),删除被阻断,请先解除引用' },
    );
    const r = mapDataError(err, 'pm_base');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('制作基地被「项目主计划批次」引用(3 条),删除被阻断,请先解除引用');
    expect(r.body.object).toBe('pm_base');
    // No `code`: older bundled clients prepend any code to the message,
    // which would reintroduce the English noise this unwrap removes.
    expect(r.body.code).toBeUndefined();
  });

  it('strips the sandbox debug wrapper from the raw message when innerMessage was lost', () => {
    const r = mapDataError(new Error("hook 'pm_ref_base' threw: Error: 删除被阻断,请先解除引用"), 'pm_base');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('删除被阻断,请先解除引用');
    expect(r.body.code).toBeUndefined();
  });

  it('keeps non-default error names when stripping the wrapper (genuine script bugs stay identifiable)', () => {
    const r = mapDataError(new Error("hook 'pm_ref_base' threw: TypeError: cannot read properties of undefined"), 'pm_base');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('TypeError: cannot read properties of undefined');
  });

  it("unwraps an action body's wrapper the same way", () => {
    const err = Object.assign(new Error("action 'approve' threw: Error: 线索信息不完整"), {
      name: 'SandboxError',
      innerMessage: '线索信息不完整',
    });
    const r = mapDataError(err);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('线索信息不完整');
    expect(r.body.object).toBeUndefined();
  });

  // [#3770] The protocol's registry gate is now the PRIMARY producer of the
  // unknown-object 404 — it answers from the schema registry before the name
  // ever becomes a table name, instead of the REST layer inferring it from a
  // driver's error string. Both producers must land on ONE wire envelope, or
  // a client keying on `code` sees which layer noticed rather than what
  // happened.
  const objectNotFound = (object: string) =>
    Object.assign(new Error(`Object '${object}' not found`), {
      code: 'OBJECT_NOT_FOUND',
      status: 404,
      object,
    });

  it('maps the protocol registry gate OBJECT_NOT_FOUND → 404 OBJECT_NOT_FOUND', () => {
    const r = mapDataError(objectNotFound('ghost'), 'ghost');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    expect(r.body.object).toBe('ghost');
  });

  it('emits the identical envelope whether the gate or the driver detected it', () => {
    const fromGate = mapDataError(objectNotFound('ghost'), 'ghost');
    const fromDriver = mapDataError(sqliteError('no such table: ghost'), 'ghost');
    expect(fromGate).toEqual(fromDriver);
  });

  it('names the object from the error itself when the caller passes none', () => {
    const r = mapDataError(objectNotFound('ghost'));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    expect(r.body.object).toBe('ghost');
  });

  // Inverted by ADR-0112. This used to assert the opposite — that the wire code
  // was NOT the internal SCREAMING one — because the data routes were believed
  // to speak a lowercase dialect, so `mapDataError` downcased on the way out.
  // There is one vocabulary now, and OBJECT_NOT_FOUND is a member of it, so the
  // translation step is what would be wrong. The invariant still worth pinning
  // is that no translation happens at all: what the gate threw is what ships.
  it('ships the catalog code unchanged — no per-route dialect translation', () => {
    const thrown = objectNotFound('ghost');
    const r = mapDataError(thrown, 'ghost');
    expect(r.body.code).toBe(thrown.code);
  });
});

// ---------------------------------------------------------------------------
// Discovery — MCP advertisement (#152)
// ---------------------------------------------------------------------------

describe('discovery — routes.mcp (ADR-0036, #152)', () => {
  /**
   * `serviceExists` omitted → the server cannot probe whether MCP is actually
   * serveable, so it keeps the flag-only answer (fail-open, ADR-0057 D10).
   * Pass one to exercise the service-aware gate added for #4024.
   */
  function discoveryHandler(serviceExists?: (name: string) => boolean) {
    const server = createMockServer();
    const protocol = createMockProtocol();
    // protocol discovery carries a `routes` object the server augments.
    (protocol.getDiscovery as any) = vi.fn().mockResolvedValue({ routes: { data: '', metadata: '' } });
    // Discovery is a control-plane route (auth-gate allowlisted), so no
    // authenticated context is needed here.
    const rest = new RestServer(
      server as any, protocol as any, ANON_API as any,
      undefined, // kernelManager
      undefined, // envRegistry
      undefined, // defaultEnvironmentIdProvider
      undefined, // authServiceProvider
      undefined, // objectQLProvider
      undefined, // emailServiceProvider
      undefined, // sharingServiceProvider
      undefined, // reportsServiceProvider
      undefined, // approvalsServiceProvider
      undefined, // sharingRulesServiceProvider
      undefined, // i18nServiceProvider
      undefined, // analyticsServiceProvider
      undefined, // settingsServiceProvider
      serviceExists,
    );
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

  it('advertises routes.mcp by default — unset env means enabled (core capability)', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const body = await invoke(discoveryHandler());
    expect(body.routes.mcp).toBe('/api/v1/mcp');
  });

  it('omits routes.mcp when MCP is explicitly disabled (opt-out)', async () => {
    process.env.OS_MCP_SERVER_ENABLED = 'false';
    const body = await invoke(discoveryHandler());
    expect(body.routes.mcp).toBeUndefined();
  });

  // ── #4024: enabled ≠ serveable ──────────────────────────────────────────
  // The flag alone used to decide this. But @objectstack/rest has no
  // @objectstack/mcp dependency, mounts no /mcp route and performs no
  // auto-load — that lockstep belongs to `os serve`. So an embedder without
  // plugin-mcp advertised /mcp here and got 501 from the runtime dispatcher,
  // which is the `declared ≠ enforced` failure #3369 forbids.

  it('omits routes.mcp when enabled but the mcp service is absent (#4024)', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED; // default-on
    const body = await invoke(discoveryHandler((name) => name !== 'mcp'));
    expect(
      body.routes.mcp,
      'enabled-but-unserveable must not be advertised — it would 501',
    ).toBeUndefined();
  });

  it('advertises routes.mcp when enabled AND the mcp service is present (#4024)', async () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    const body = await invoke(discoveryHandler(() => true));
    expect(body.routes.mcp).toBe('/api/v1/mcp');
  });

  it('keeps the flag-only answer when the host cannot be probed (fail-open, ADR-0057 D10)', async () => {
    // No kernelManager and no serviceExistsProvider → "unknown", not "absent".
    // Hiding a working endpoint here would be the opposite over-correction, and
    // the dispatcher's own service-aware discovery stays authoritative.
    delete process.env.OS_MCP_SERVER_ENABLED;
    const body = await invoke(discoveryHandler());
    expect(body.routes.mcp).toBe('/api/v1/mcp');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// discovery — capabilities.transactionalBatch (#3298 / #1604 / ADR-0034)
//
// The atomic cross-object batch bit must be broadcast so clients negotiate
// declaratively instead of runtime-probing POST /batch for 404/405/501. The
// rest-server producer ANDs the runtime-engine signal (from the protocol,
// derived from `engine.transaction`) with whether IT mounts the route
// (`api.enableBatch`) — declared === enforced.
// ──────────────────────────────────────────────────────────────────────────
describe('discovery — capabilities.transactionalBatch (#3298)', () => {
  /**
   * Build the /discovery handler for a server whose protocol advertises the
   * given runtime batch support, under the given api config.
   */
  function discoveryHandler(opts: { runtimeTx?: boolean; api?: any } = {}) {
    const server = createMockServer();
    const protocol = createMockProtocol();
    const capabilities =
      opts.runtimeTx === undefined
        ? undefined
        : { transactionalBatch: { enabled: opts.runtimeTx } };
    (protocol.getDiscovery as any) = vi.fn().mockResolvedValue({
      routes: { data: '', metadata: '' },
      ...(capabilities ? { capabilities } : {}),
    });
    const rest = new RestServer(
      server as any,
      protocol as any,
      { api: opts.api ?? { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

  it('advertises transactionalBatch=true when the runtime supports it and /batch is mounted (default)', async () => {
    const body = await invoke(discoveryHandler({ runtimeTx: true }));
    expect(body.capabilities.transactionalBatch.enabled).toBe(true);
    // The description is carried so the capability is self-documenting.
    expect(body.capabilities.transactionalBatch.description).toContain('POST {basePath}/batch');
  });

  it('reports transactionalBatch=false when api.enableBatch is off — the /batch route is not mounted', async () => {
    const body = await invoke(
      discoveryHandler({ runtimeTx: true, api: { requireAuth: false, enableBatch: false } }),
    );
    expect(body.capabilities.transactionalBatch.enabled).toBe(false);
  });

  it('reports transactionalBatch=false when the runtime engine cannot honour a transaction', async () => {
    const body = await invoke(discoveryHandler({ runtimeTx: false }));
    expect(body.capabilities.transactionalBatch.enabled).toBe(false);
  });

  it('always populates the bit even if the protocol omitted capabilities (no declared-but-unpopulated gap)', async () => {
    const body = await invoke(discoveryHandler({ /* protocol returns no capabilities */ }));
    expect(body.capabilities).toBeDefined();
    expect(body.capabilities.transactionalBatch.enabled).toBe(false);
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
//
// [#5563] Which helper does the unwrapping changed: `translateMetaItem` now
// takes the DOCUMENT and `translateMetaEnvelope` is the envelope-aware entry
// the single-item routes call, instead of one helper sniffing at runtime which
// of two shapes the route happened to receive. The guarded behaviour is
// unchanged and still asserted below — the inner doc's labels, never the
// envelope's top level.
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
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
    const envelope = { type: 'app', name: 'setup', item: makeDoc(), lock: null };
    const out = await (rest as any).translateMetaEnvelope(
      zhReq, 'app', undefined, envelope, envelope.item, fakeI18n,
    );
    // Envelope shape preserved …
    expect(out.type).toBe('app');
    expect(out.name).toBe('setup');
    expect(out.lock).toBeNull();
    // … and the nested doc — not the envelope top level — is translated.
    expect(out.item.label).toBe('系统设置');
    expect(out.item.navigation[0].label).toBe('配置');
    expect(out.item.navigation[0].children[0].label).toBe('文件存储');
  });

  it('translates the document handed to it directly', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
    const out = await (rest as any).translateMetaItem(zhReq, 'app', undefined, makeDoc(), fakeI18n);
    expect(out.label).toBe('系统设置');
    expect(out.navigation[0].children[0].label).toBe('文件存储');
  });

  it('translates list responses in the `{ items: [...] }` envelope shape', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
    // translateMetaItems resolves the i18n service itself; stub the lookup.
    (rest as any).resolveI18nService = async () => fakeI18n;
    // The list envelope is the OUTER `{ type, items }`; its ELEMENTS are
    // metadata documents (`getMetaItems` decorates documents, it does not wrap
    // each one in a per-item envelope). The fixture used to spell the elements
    // as `{ type, name, item }` — a shape the producer never emits — which is
    // why the per-element sniff looked necessary.
    const listEnvelope = { type: 'app', items: [makeDoc()] };
    const out = await (rest as any).translateMetaItems(zhReq, 'app', undefined, listEnvelope);
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items[0].label).toBe('系统设置');
    expect(out.items[0].navigation[0].children[0].label).toBe('文件存储');
  });

  it('translates a bare array of unwrapped documents', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
    (rest as any).resolveI18nService = async () => fakeI18n;
    const out = await (rest as any).translateMetaItems(zhReq, 'app', undefined, [makeDoc()]);
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].navigation[0].children[0].label).toBe('文件存储');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Page metadata translation (objectstack#3589)
//
// Plugin-carried Setup pages hard-code their `page:header` copy in metadata.
// `page` was missing from TRANSLATABLE_META_TYPES, so the REST boundary
// returned those pages untranslated no matter what the bundle held.
// ──────────────────────────────────────────────────────────────────────────
describe('RestServer metadata translation — page documents', () => {
  const fakeI18n = {
    getLocales: () => ['zh-CN'],
    getDefaultLocale: () => 'zh-CN',
    getTranslations: (locale: string) =>
      locale === 'zh-CN'
        ? {
            pages: {
              connect_agent: {
                label: '连接智能体',
                subtitle: '让任意支持 MCP 的 AI 客户端受控访问此环境。',
              },
            },
          }
        : undefined,
  };
  const zhReq = { headers: { 'accept-language': 'zh-CN' } };
  const makePage = () => ({
    name: 'connect_agent',
    label: 'Connect an Agent',
    regions: [
      {
        name: 'header',
        components: [
          {
            type: 'page:header',
            properties: { title: 'Connect an Agent', subtitle: 'Give any MCP-capable client…', icon: 'bot' },
          },
        ],
      },
    ],
  });

  it('translates the page:header copy inside a getMetaItem envelope', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
    const envelope = { type: 'page', name: 'connect_agent', item: makePage(), lock: null };
    const out = await (rest as any).translateMetaEnvelope(
      zhReq, 'page', undefined, envelope, envelope.item, fakeI18n,
    );
    expect(out.name).toBe('connect_agent');
    expect(out.item.label).toBe('连接智能体');
    expect(out.item.regions[0].components[0].properties.title).toBe('连接智能体');
    expect(out.item.regions[0].components[0].properties.subtitle).toBe('让任意支持 MCP 的 AI 客户端受控访问此环境。');
    expect(out.item.regions[0].components[0].properties.icon).toBe('bot');
  });

  it('translates page documents in a list response', async () => {
    const rest = new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
    (rest as any).resolveI18nService = async () => fakeI18n;
    const out = await (rest as any).translateMetaItems(zhReq, 'page', undefined, [makePage()]);
    expect(out[0].regions[0].components[0].properties.title).toBe('连接智能体');
  });
});

// ---------------------------------------------------------------------------
// ADR-0045 §3 (revised 2026-08, #4829) — the PUBLISH gate (filterAppForUser)
//
// Two keys, two contracts, pinned in both directions because conflating them is
// the defect this block exists to prevent recurring:
//
//   `_unpublished: true`  machine-managed publish gate — externally
//                         unobservable, builders only. THIS is what the gate reads.
//   `hidden: true`        navigation presentation — not in the App Switcher,
//                         surfaced via the avatar menu. Fully routable and
//                         permission-checked for EVERY user; the gate ignores it.
//
// Until #4829 this suite pinned the gate on `hidden`, which is why the
// regression it caused survived: the platform's own `account` app is authored
// `hidden: true` (see `platform-objects`' ACCOUNT_APP, "Surface via the avatar
// dropdown, not the App Switcher"), so a green pin was asserting that every
// normal user is denied their own password / avatar / session settings. A pin
// that only tests one direction can be satisfied by the wrong mechanism.
// End-to-end proof over the wire lives in `meta-app-publish-gate.test.ts`.
// ---------------------------------------------------------------------------

describe('filterAppForUser — ADR-0045 publish gate', () => {
  const make = () => new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
  const unpublishedApp = { name: 'production_management', _unpublished: true, navigation: [] };
  const visibleApp = { name: 'crm', navigation: [] };
  // The #4829 repro, in the shape `platform-objects` actually authors it.
  const accountApp = { name: 'account', hidden: true, navigation: [] };

  it('drops an UNPUBLISHED app for users without builder access', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(unpublishedApp, new Set<string>())).toBeNull();
    expect(rest.filterAppForUser(unpublishedApp, new Set(['manage_users']))).toBeNull();
  });

  it('returns an unpublished app to builders (studio.access or setup.access)', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(unpublishedApp, new Set(['studio.access']))?.name).toBe('production_management');
    expect(rest.filterAppForUser(unpublishedApp, new Set(['setup.access']))?.name).toBe('production_management');
  });

  it('leaves visible apps untouched for everyone', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(visibleApp, new Set<string>())?.name).toBe('crm');
  });

  it('still applies requiredPermissions to unpublished apps builders can see', () => {
    const rest: any = make();
    const gated = { ...unpublishedApp, requiredPermissions: ['manage_platform_settings'] };
    expect(rest.filterAppForUser(gated, new Set(['studio.access']))).toBeNull();
    expect(
      rest.filterAppForUser(gated, new Set(['studio.access', 'manage_platform_settings']))?.name,
    ).toBe('production_management');
  });

  // ---- the other direction: `hidden` must NOT gate access (#4829) ----

  it('#4829: a `hidden` app is served to a user with NO permissions at all', () => {
    const rest: any = make();
    expect(rest.filterAppForUser(accountApp, new Set<string>())?.name).toBe('account');
    expect(rest.filterAppForUser(accountApp, new Set(['manage_users']))?.name).toBe('account');
  });

  it('#4829: `hidden` survives the filter untouched — the shell, not the server, acts on it', () => {
    const rest: any = make();
    // The server must keep serving the flag: nav placement is the CLIENT's
    // decision, and stripping it here would move the launcher bug one layer out.
    expect(rest.filterAppForUser(accountApp, new Set<string>())?.hidden).toBe(true);
  });

  it('the two keys are independent — `hidden` does not weaken the publish gate', () => {
    const rest: any = make();
    const both = { name: 'draft_settings', hidden: true, _unpublished: true, navigation: [] };
    expect(rest.filterAppForUser(both, new Set<string>())).toBeNull();
    expect(rest.filterAppForUser(both, new Set(['studio.access']))?.name).toBe('draft_settings');
  });

  it('a hidden app still answers to `requiredPermissions` — nav-only never means ungated', () => {
    const rest: any = make();
    const gated = { ...accountApp, requiredPermissions: ['account.access'] };
    expect(rest.filterAppForUser(gated, new Set<string>())).toBeNull();
    expect(rest.filterAppForUser(gated, new Set(['account.access']))?.name).toBe('account');
  });
});

// ---------------------------------------------------------------------------
// #4651 — the gates that ARE enforced, pinned after the fake one was removed
//
// `app.areas[].visible` / `app.areas[].requiredPermissions` left the spec in
// 17.0.0 because nothing evaluated them: this function reads the APP's
// `requiredPermissions` and then walks the navigation trees. Removing a gate
// that never gated is safe exactly and only while the gates that DO exist keep
// working — otherwise the change trades "a gate that fails open" for "nobody
// checks whether the real gates are still there". Every surviving layer is
// pinned here, at the server that is the authority for them.
//
// #4722 closed the real gap that #4651 left behind: the walk covered the
// top-level `navigation` tree ONLY, so an item gate written inside an
// `areas[]` tree was enforced by the shell alone and the entry still shipped
// in the `/meta` body. The area-LEVEL keys stay retired — what is enforced is
// the item gate, through the one `filterNav` both trees share.
// ---------------------------------------------------------------------------

describe('filterAppForUser — the enforced permission layers (#4651, #4722)', () => {
  const make = () => new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
  const ids = (a: any): string[] => (a?.navigation ?? []).map((e: any) => e.id);
  const areaIds = (a: any, i: number): string[] => (a?.areas?.[i]?.navigation ?? []).map((e: any) => e.id);

  it('APP level: an app whose requiredPermissions the caller lacks is dropped entirely', () => {
    const rest: any = make();
    const app = { name: 'crm', requiredPermissions: ['crm.access'], navigation: [] };
    expect(rest.filterAppForUser(app, new Set<string>())).toBeNull();
    expect(rest.filterAppForUser(app, new Set(['other.perm']))).toBeNull();
    expect(rest.filterAppForUser(app, new Set(['crm.access']))?.name).toBe('crm');
  });

  it('APP level: every declared permission is required, not any of them', () => {
    const rest: any = make();
    const app = { name: 'crm', requiredPermissions: ['crm.access', 'crm.admin'], navigation: [] };
    expect(rest.filterAppForUser(app, new Set(['crm.access']))).toBeNull();
    expect(rest.filterAppForUser(app, new Set(['crm.access', 'crm.admin']))?.name).toBe('crm');
  });

  it('ITEM level: nav entries the caller cannot satisfy are stripped from the served tree', () => {
    const rest: any = make();
    const app = () => ({
      name: 'crm',
      navigation: [
        { id: 'nav_leads', type: 'object' },
        { id: 'nav_forecast', type: 'object', requiredPermissions: ['sales.admin'] },
        {
          id: 'grp_admin', type: 'group', children: [
            { id: 'nav_users', type: 'object', requiredPermissions: ['admin.access'] },
            { id: 'nav_about', type: 'url' },
          ],
        },
      ],
    });
    const out = rest.filterAppForUser(app(), new Set<string>());
    expect(ids(out)).toEqual(['nav_leads', 'grp_admin']);
    expect(out.navigation[1].children.map((c: any) => c.id)).toEqual(['nav_about']);

    const admin = rest.filterAppForUser(app(), new Set(['sales.admin', 'admin.access']));
    expect(ids(admin)).toEqual(['nav_leads', 'nav_forecast', 'grp_admin']);
    expect(admin.navigation[2].children.map((c: any) => c.id)).toEqual(['nav_users', 'nav_about']);
  });

  it('a group left empty by the item gate is dropped, not served as a bare label', () => {
    const rest: any = make();
    const app = {
      name: 'crm',
      navigation: [{
        id: 'grp_admin', type: 'group',
        children: [{ id: 'nav_users', type: 'object', requiredPermissions: ['admin.access'] }],
      }],
    };
    expect(ids(rest.filterAppForUser(app, new Set<string>()))).toEqual([]);
    expect(ids(rest.filterAppForUser(app, new Set(['admin.access'])))).toEqual(['grp_admin']);
  });

  it('AREA level: the item gate applies inside `areas[]` too, not just the top-level tree', () => {
    // Rewritten in #4722 — this used to be a characterisation pinning the
    // opposite ("`areas` is not walked"), with a note telling whoever made the
    // server walk areas to rewrite it deliberately and update the
    // `areas.navigation` liveness note in the same change. This is that
    // rewrite: an item gate nested under an area is now enforced by the SERVER,
    // so the gated entry — and its `objectName` / `pageName` / `componentRef`
    // target with it — never reaches the browser at all.
    const rest: any = make();
    const app = () => ({
      name: 'crm',
      navigation: [{ id: 'nav_home', type: 'object' }],
      areas: [{
        id: 'area_sales', label: 'Sales',
        navigation: [
          { id: 'nav_leads', type: 'object', objectName: 'lead' },
          { id: 'nav_forecast', type: 'object', objectName: 'forecast', requiredPermissions: ['sales.admin'] },
        ],
      }, {
        id: 'area_admin', label: 'Admin',
        navigation: [{ id: 'nav_users', type: 'object', objectName: 'sys_user', requiredPermissions: ['admin.access'] }],
      }],
    });

    const out = rest.filterAppForUser(app(), new Set<string>());
    expect(ids(out)).toEqual(['nav_home']);
    // area_sales keeps only the ungated item; area_admin was emptied by the
    // gate and is dropped whole — see the group-collapse pin below.
    expect(out.areas.map((a: any) => a.id)).toEqual(['area_sales']);
    expect(areaIds(out, 0)).toEqual(['nav_leads']);
    // The gated targets are gone from the body, not merely marked.
    expect(JSON.stringify(out)).not.toContain('forecast');
    expect(JSON.stringify(out)).not.toContain('sys_user');

    const admin = rest.filterAppForUser(app(), new Set(['sales.admin', 'admin.access']));
    expect(admin.areas.map((a: any) => a.id)).toEqual(['area_sales', 'area_admin']);
    expect(areaIds(admin, 0)).toEqual(['nav_leads', 'nav_forecast']);
    expect(areaIds(admin, 1)).toEqual(['nav_users']);
  });

  it('AREA level: one implementation — nested groups inside an area collapse exactly as at top level', () => {
    const rest: any = make();
    const app = () => ({
      name: 'crm',
      areas: [{
        id: 'area_ops', label: 'Ops',
        navigation: [
          { id: 'nav_tasks', type: 'object' },
          {
            id: 'grp_admin', type: 'group', children: [
              { id: 'nav_users', type: 'object', requiredPermissions: ['admin.access'] },
            ],
          },
          {
            id: 'grp_mixed', type: 'group', children: [
              { id: 'nav_audit', type: 'object', requiredPermissions: ['admin.access'] },
              { id: 'nav_about', type: 'url' },
            ],
          },
        ],
      }],
    });
    const out = rest.filterAppForUser(app(), new Set<string>());
    // grp_admin emptied → dropped; grp_mixed keeps its ungated child.
    expect(areaIds(out, 0)).toEqual(['nav_tasks', 'grp_mixed']);
    expect(out.areas[0].navigation[1].children.map((c: any) => c.id)).toEqual(['nav_about']);

    const admin = rest.filterAppForUser(app(), new Set(['admin.access']));
    expect(areaIds(admin, 0)).toEqual(['nav_tasks', 'grp_admin', 'grp_mixed']);
  });

  it('AREA level: an area emptied BY the gate is dropped; an area authored empty is passed through', () => {
    // Same shape as the top-level group-collapse rule pinned above: collapse is
    // a consequence of filtering, never a tidy-up of what the author wrote.
    const rest: any = make();
    const gatedEmpty = {
      name: 'crm',
      areas: [{
        id: 'area_admin', label: 'Admin',
        navigation: [{ id: 'nav_users', type: 'object', requiredPermissions: ['admin.access'] }],
      }],
    };
    expect(rest.filterAppForUser(gatedEmpty, new Set<string>()).areas).toEqual([]);
    expect(
      rest.filterAppForUser(gatedEmpty, new Set(['admin.access'])).areas.map((a: any) => a.id),
    ).toEqual(['area_admin']);

    const authoredEmpty = { name: 'crm', areas: [{ id: 'area_soon', label: 'Soon', navigation: [] }] };
    expect(rest.filterAppForUser(authoredEmpty, new Set<string>()).areas.map((a: any) => a.id))
      .toEqual(['area_soon']);
  });

  it('AREA level: an app with areas but no top-level navigation is still filtered', () => {
    // The pre-#4722 early return (`if (!nav) return item`) handed this shape
    // back untouched — which is precisely the areas-only app the bug hurt most.
    const rest: any = make();
    const app = {
      name: 'crm',
      areas: [{
        id: 'area_sales', label: 'Sales',
        navigation: [
          { id: 'nav_leads', type: 'object' },
          { id: 'nav_forecast', type: 'object', requiredPermissions: ['sales.admin'] },
        ],
      }],
    };
    const out = rest.filterAppForUser(app, new Set<string>());
    expect(out.navigation).toBeUndefined();
    expect(areaIds(out, 0)).toEqual(['nav_leads']);
  });

  it('does not mutate the app it filters (cached metadata stays whole)', () => {
    const rest: any = make();
    const app = {
      name: 'crm',
      navigation: [{ id: 'nav_home', type: 'object' }],
      areas: [{
        id: 'area_admin', label: 'Admin',
        navigation: [
          { id: 'nav_users', type: 'object', requiredPermissions: ['admin.access'] },
          { id: 'nav_docs', type: 'url' },
        ],
      }],
    };
    const before = JSON.stringify(app);
    rest.filterAppForUser(app, new Set<string>());
    expect(JSON.stringify(app)).toBe(before);
  });

  it('characterises what the server still does NOT evaluate: `visible` CEL, at any level', () => {
    // NOT an endorsement — a characterisation, and a deliberate #4722
    // non-goal. `visible` is a CEL expression that needs a bound `user`
    // context the REST read layer does not have, so it stays a client-side
    // gate at BOTH levels while `requiredPermissions` / `requiresService` are
    // enforced at both. Anything that must never reach the browser goes in
    // `requiredPermissions`, not `visible`. Whoever binds CEL server-side
    // should see this expectation fail and rewrite it, updating the
    // `navigation.visible` liveness note in the same change.
    const rest: any = make();
    const app = {
      name: 'crm',
      navigation: [{ id: 'nav_secret_top', type: 'object', visible: 'false' }],
      areas: [{
        id: 'area_admin', label: 'Admin',
        navigation: [{ id: 'nav_secret_area', type: 'object', visible: 'false' }],
      }],
    };
    const out = rest.filterAppForUser(app, new Set<string>());
    expect(ids(out)).toEqual(['nav_secret_top']);
    expect(areaIds(out, 0)).toEqual(['nav_secret_area']);
  });
});

// ---------------------------------------------------------------------------
// ADR-0057 D10 — requiresService capability gate (filterAppForUser)
// ---------------------------------------------------------------------------

describe('filterAppForUser — ADR-0057 D10 requiresService gate', () => {
  const make = () => new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
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

  it('[#4722] the gate strips requiresService entries inside `areas[]` as well', () => {
    const rest: any = make();
    const areaApp = () => ({
      name: 'setup',
      areas: [{
        id: 'area_admin', label: 'Admin',
        navigation: [
          { id: 'nav_users', type: 'object' },
          { id: 'nav_organizations', type: 'object', objectName: 'sys_organization', requiresService: 'org-scoping' },
        ],
      }],
    });
    const nav = (a: any): string[] => (a?.areas?.[0]?.navigation ?? []).map((e: any) => e.id);
    expect(nav(rest.filterAppForUser(areaApp(), new Set<string>(), (n: string) => n !== 'org-scoping')))
      .toEqual(['nav_users']);
    expect(nav(rest.filterAppForUser(areaApp(), new Set<string>(), () => true)))
      .toEqual(['nav_users', 'nav_organizations']);
    // Fail-open when the gate cannot be probed at all, as at top level.
    expect(nav(rest.filterAppForUser(areaApp(), new Set<string>())))
      .toEqual(['nav_users', 'nav_organizations']);
  });

  it('[#4722] resolveRegisteredServices probes services named only inside `areas[]`', async () => {
    // Without this the area gate would fail CLOSED by omission: an unprobed
    // name is missing from `registered`, which the gate reads as "absent" and
    // strips a live entry. The probe set must cover what the filter walks.
    const rest: any = make();
    const kernel = { getServiceAsync: async (n: string) => (n === 'org-scoping' ? {} : null) };
    const areaApp = {
      name: 'setup',
      navigation: [{ id: 'nav_home', type: 'object' }],
      areas: [{
        id: 'area_admin', label: 'Admin',
        navigation: [
          { id: 'nav_organizations', type: 'object', requiresService: 'org-scoping' },
          { id: 'grp', type: 'group', children: [{ id: 'nav_x', type: 'object', requiresService: 'nope' }] },
        ],
      }],
    };
    const reg = await rest.resolveRegisteredServices(kernel, [areaApp]);
    expect(reg.has('org-scoping')).toBe(true);
    expect(reg.has('nope')).toBe(false);

    // End-to-end: probe + gate keeps the registered one, drops the absent one.
    const gated = rest.filterAppForUser(areaApp, new Set<string>(), (n: string) => reg.has(n));
    expect(gated.areas[0].navigation.map((e: any) => e.id)).toEqual(['nav_organizations']);
  });

  it('the single-item route gates the inner app and answers the envelope', async () => {
    // [#5563] This pinned `filterAppForUser` unwrapping the envelope itself.
    // Unwrapping moved to the route — the helper takes the document now — so
    // the guarded behaviour is pinned where it actually happens. What must not
    // regress is unchanged and is what fails here if it does: gating the
    // envelope's top level is a silent no-op (no `.navigation` there), which
    // would ship `nav_organizations` to a caller whose gate rejects it.
    const protocol: any = createMockProtocol();
    protocol.getMetaItemCached = vi.fn();
    protocol.getMetaItem = vi.fn().mockResolvedValue({
      type: 'app', name: 'setup', lock: 'none',
      item: { name: 'setup', navigation: [
        { id: 'nav_users', type: 'object' },
        { id: 'nav_organizations', type: 'object', requiresService: 'org-scoping' },
      ] },
    });
    const rest: any = new RestServer(createMockServer() as any, protocol, ANON_API as any);
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.serviceExistsProvider = (n: string) => n !== 'org-scoping';
    rest.registerRoutes();
    const route = rest.getRoutes().find(
      (r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name',
    );
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
    await route.handler({ params: { type: 'app', name: 'setup' }, query: {}, headers: {} }, res);

    const body = res.json.mock.calls.at(-1)![0];
    expect(body).toMatchObject({ type: 'app', name: 'setup', lock: 'none' });
    expect((body.item.navigation as any[]).map((e: any) => e.id)).toEqual(['nav_users']);
  });
});

// ---------------------------------------------------------------------------
// ADR-0057 D10 — requiresService capability gate for DASHBOARD WIDGETS
// (filterDashboardForUser) — server is the authoritative visibility gate.
// ---------------------------------------------------------------------------

describe('filterDashboardForUser — ADR-0057 D10 widget requiresService gate', () => {
  const make = () => new RestServer(createMockServer() as any, createMockProtocol() as any, ANON_API as any);
  const dash = () => ({
    name: 'system_overview',
    widgets: [
      { id: 'widget_total_users' },
      { id: 'widget_packages_installed', requiresObject: 'sys_package_installation' },
      { id: 'widget_organizations', requiresService: 'org-scoping' },
    ],
  });
  const ids = (d: any): string[] => (d?.widgets ?? []).map((w: any) => w.id);

  it('drops widgets whose requiresService gate reports the service absent', () => {
    const rest: any = make();
    const out = rest.filterDashboardForUser(dash(), (n: string) => n !== 'org-scoping');
    expect(ids(out)).toEqual(['widget_total_users', 'widget_packages_installed']);
  });

  it('keeps requiresService widgets when the service is present', () => {
    const rest: any = make();
    expect(ids(rest.filterDashboardForUser(dash(), () => true))).toContain('widget_organizations');
  });

  it('fail-open: with no service gate, widgets are untouched', () => {
    const rest: any = make();
    expect(ids(rest.filterDashboardForUser(dash(), undefined))).toContain('widget_organizations');
  });

  it('does not touch requiresObject widgets (client-side concern)', () => {
    const rest: any = make();
    const out = rest.filterDashboardForUser(dash(), () => false);
    expect(ids(out)).toContain('widget_packages_installed');
    expect(ids(out)).not.toContain('widget_organizations');
  });

  it('the single-item route gates the inner dashboard and answers the envelope', async () => {
    // [#5563] Same move as the app gate above: the helper takes the document,
    // the route owns the envelope. Gating an envelope's top level would find no
    // `widgets` and ship every one of them.
    const protocol: any = createMockProtocol();
    protocol.getMetaItem = vi.fn().mockResolvedValue({
      type: 'dashboard', name: 'system_overview', item: dash(),
    });
    const rest: any = new RestServer(
      createMockServer() as any,
      protocol,
      // [#5881] `enableCache: false` is no longer what makes this reachable —
      // dashboard reads bypass the cache unconditionally now, and the DEFAULT
      // configuration is pinned separately below. Kept explicit because an
      // operator who disables the cache must get the same answer, and because
      // this case is what the fix had to leave untouched: it was the only
      // green proof the gate worked at all while the default path skipped it.
      { api: { requireAuth: false }, metadata: { enableCache: false } } as any,
    );
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.serviceExistsProvider = (n: string) => n !== 'org-scoping';
    rest.registerRoutes();
    const route = rest.getRoutes().find(
      (r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name',
    );
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
    await route.handler({ params: { type: 'dashboard', name: 'system_overview' }, query: {}, headers: {} }, res);

    const body = res.json.mock.calls.at(-1)![0];
    expect(body).toMatchObject({ type: 'dashboard', name: 'system_overview' });
    expect(ids(body.item)).not.toContain('widget_organizations');
    expect(ids(body.item)).toContain('widget_total_users');
  });

  // -------------------------------------------------------------------------
  // [#5881] The gate on the DEFAULT path.
  //
  // `enableCache` defaults to true, and the single-item read had a cached
  // branch that excluded `app` (per-user RBAC) and `doc`/`book` (per-caller
  // audience) but NOT `dashboard` — so the widget gate above, which lives in
  // the uncached branch, never ran in a default deployment. Measured on
  // `origin/main` @ 8e2bbba24 before the fix, against the real RestServer:
  //
  //     cachedCalls: 1 | uncachedCalls: 0 | widgetsServed: ["w_users","w_orgs"]
  //
  // The fix excludes `dashboard` from the cached branch, as `app` already was.
  // Why not instead hoist the gate so both branches run it once — which reads
  // like the tidier shape? Because the ETag cannot carry the gate's verdict:
  // it is a hash of the UNFILTERED document, and `notModified` is decided
  // inside the protocol before this layer sees it. Measured, same baseline:
  //
  //     etag(unfiltered): 2504e71e | etag(gated body): 75ca17c1 | same? false
  //     revalidate-with-unfiltered-etag -> notModified: true
  //     cacheControl: {"directives":["private","no-cache"]}
  //
  // So a hoisted gate would ship a filtered body under a validator naming the
  // unfiltered one. Within one boot that is harmless (the registered-service
  // set cannot change: `Kernel.use()` throws after bootstrap and nothing
  // deregisters), but `private, no-cache` means the client stores the body and
  // only revalidates — and the stored body outlives the process. Turn the
  // optional service off in a redeploy and the document is unchanged, so every
  // revalidation answers 304 and the dead tile survives the very deploy that
  // removed its service. The full-read cost of not caching is nil:
  // `getMetaItemCached` delegates to `getMetaItem`, so the server does the same
  // work either way and only the 304's saved bytes are given up.
  // -------------------------------------------------------------------------
  /** A protocol offering BOTH reads, so the branch choice is the thing tested. */
  const bothReads = () => {
    const protocol: any = createMockProtocol();
    protocol.getMetaItem = vi.fn().mockResolvedValue({
      type: 'dashboard', name: 'system_overview', item: dash(),
    });
    protocol.getMetaItemCached = vi.fn().mockResolvedValue({
      data: dash(),
      etag: { value: 'etag-unfiltered', weak: false },
      lastModified: new Date().toISOString(),
      cacheControl: { directives: ['private', 'no-cache'] },
      notModified: false,
    });
    return protocol;
  };
  /** Default config — no `metadata` block at all, so `enableCache` is its default. */
  const defaultServer = (protocol: any) => {
    const rest: any = new RestServer(createMockServer() as any, protocol, ANON_API as any);
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.serviceExistsProvider = (n: string) => n !== 'org-scoping';
    rest.registerRoutes();
    return rest;
  };
  const readMeta = async (rest: any, type: string, name: string) => {
    const route = rest.getRoutes().find(
      (r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name',
    );
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
    await route.handler({ params: { type, name }, query: {}, headers: {} }, res);
    return res;
  };

  it('runs the gate under the DEFAULT configuration, not only when the cache is off', async () => {
    const protocol = bothReads();
    const res = await readMeta(defaultServer(protocol), 'dashboard', 'system_overview');

    const body = res.json.mock.calls.at(-1)![0];
    expect(ids(body.item)).not.toContain('widget_organizations');
    expect(ids(body.item)).toContain('widget_total_users');
    // The envelope the route owes its caller is unchanged by the branch switch.
    expect(body).toMatchObject({ type: 'dashboard', name: 'system_overview' });
  });

  it('a dashboard read takes the uncached branch — while other types still cache', async () => {
    // The positive control matters as much as the assertion above it: excluding
    // one type from the cached branch is only correct if it excludes exactly
    // that type. A fix that disabled the cache wholesale would satisfy every
    // gate assertion here and quietly cost every other metadata read its ETag.
    const protocol = bothReads();
    const rest = defaultServer(protocol);

    const dashRes = await readMeta(rest, 'dashboard', 'system_overview');
    expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
    expect(protocol.getMetaItem).toHaveBeenCalledTimes(1);
    // The observable price of the bypass, pinned rather than hidden: a
    // dashboard read carries no ETag validator now.
    expect(dashRes.header.mock.calls.map((c: any[]) => c[0])).not.toContain('ETag');

    const viewRes = await readMeta(rest, 'view', 'account_list');
    expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(1);
    expect(viewRes.header.mock.calls.map((c: any[]) => c[0])).toContain('ETag');
  });

  it('the plural spelling cannot spell its way around the exclusion', async () => {
    // `/meta/dashboards/x` is the CANONICAL REST spelling (Prime Directive #3)
    // and the route serves both, so an exclusion compared against the literal
    // `'dashboard'` would leave the default path ungated under the spelling
    // most callers use — the #3984 defect class, which `metaTypeSingular`'s own
    // docstring exists to remember.
    const protocol = bothReads();
    const res = await readMeta(defaultServer(protocol), 'dashboards', 'system_overview');

    expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
    expect(ids(res.json.mock.calls.at(-1)![0].item)).not.toContain('widget_organizations');
  });

  it('resolveRegisteredServices discovers requiresService declared on widgets', async () => {
    const rest: any = make();
    const kernel = { getServiceAsync: async (n: string) => { if (n === 'org-scoping') return {}; throw new Error('absent'); } };
    const reg = await rest.resolveRegisteredServices(kernel, [dash()]);
    expect(reg.has('org-scoping')).toBe(true);
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
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
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

  it('apiMethods whitelist → disallowed op returns 405 with the EFFECTIVE set (#3391)', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list'] });
    const res = await invoke(rest, 'POST', LIST, { object: 'widget' }, { a: 1 });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    // #3391: `allowed` is now the derived EFFECTIVE operation set (enum-ordered),
    // not the raw whitelist — a `list` grant derives aggregate/search/export.
    expect(res.body.allowed).toEqual(['get', 'list', 'aggregate', 'search', 'export']);
    expect(protocol.createData).not.toHaveBeenCalled();
  });

  it('empty whitelist [] + apiEnabled:true → deny-all 405 (flipped by #3391)', async () => {
    const { rest, protocol } = setup({ apiMethods: [], apiEnabled: true });
    const res = await invoke(rest, 'GET', LIST, { object: 'widget' });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(res.body.allowed).toEqual([]);
    expect(protocol.findData).not.toHaveBeenCalled();
  });

  it('createMany requires the bulk primitive: [create] alone → 405 (#3391)', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list', 'create'] });
    const res = await invoke(rest, 'POST', '/api/v1/data/:object/createMany', { object: 'widget' }, []);
    expect(res.statusCode).toBe(405);
    expect(protocol.createManyData).not.toHaveBeenCalled();
  });

  it('createMany passes when [create, bulk] granted (bulk ∧ create, #3391)', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list', 'create', 'bulk'] });
    const res = await invoke(rest, 'POST', '/api/v1/data/:object/createMany', { object: 'widget' }, []);
    expect(res.statusCode).toBe(201);
    expect(protocol.createManyData).toHaveBeenCalledTimes(1);
  });

  it('createMany with [bulk] but no create → 405 (child op not granted, #3391)', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list', 'bulk'] });
    const res = await invoke(rest, 'POST', '/api/v1/data/:object/createMany', { object: 'widget' }, []);
    expect(res.statusCode).toBe(405);
    expect(protocol.createManyData).not.toHaveBeenCalled();
  });

  it('reverse-derived: a CRUD whitelist (no explicit bulk/import) still allows single create', async () => {
    const { rest, protocol } = setup({ apiMethods: ['get', 'list', 'create', 'update', 'delete'] });
    const res = await invoke(rest, 'POST', LIST, { object: 'widget' }, { a: 1 });
    expect(res.statusCode).not.toBe(405);
    expect(protocol.createData).toHaveBeenCalledTimes(1);
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

  // [#3545] fail-open residual-risk decision: the exposure gate is a
  // surface-area control (not the authz boundary — auth + CRUD/FLS/RLS still
  // enforce on the data call), so an unresolvable metadata read fails OPEN to
  // avoid 405ing every request during the cold-start window. The one change is
  // OBSERVABILITY: a THROWN metadata read (a real fault) is logged, while a
  // legitimately-empty registry stays silent — so a persistent outage, during
  // which the gate silently allows every op, is no longer invisible.
  describe('metadata-unavailable fail-open observability (#3545)', () => {
    it('loadObjectItems fails OPEN (returns []) AND logs a THROWN metadata read', async () => {
      const { rest, protocol } = setup(undefined);
      protocol.getMetaItems = vi.fn().mockRejectedValue(new Error('metadata store down'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const items = await (rest as any).loadObjectItems(protocol, undefined);
        expect(items).toEqual([]); // fail-open preserved: gate abstains
        expect(warnSpy).toHaveBeenCalled();
        expect(String(warnSpy.mock.calls[0]?.[0] ?? '')).toContain('api-exposure gate');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('loadObjectItems stays SILENT on a legitimately-empty registry (no false alarm)', async () => {
      const { rest, protocol } = setup(undefined);
      protocol.getMetaItems = vi.fn().mockResolvedValue([]); // empty, not thrown
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const items = await (rest as any).loadObjectItems(protocol, undefined);
        expect(items).toEqual([]);
        expect(warnSpy).not.toHaveBeenCalled(); // distinguishes real fault from empty
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('enforceApiAccess does NOT block when the metadata read throws (fail-open)', async () => {
      const { rest, protocol } = setup(undefined);
      protocol.getMetaItems = vi.fn().mockRejectedValue(new Error('metadata store down'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const res = makeRes();
        const blocked = await (rest as any).enforceApiAccess(
          { params: { object: 'widget' } }, res, protocol, undefined, 'list',
        );
        expect(blocked).toBe(false); // request proceeds — data path + security enforce
        expect(res.status).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
