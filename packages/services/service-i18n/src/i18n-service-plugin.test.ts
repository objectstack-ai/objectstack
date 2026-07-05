// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nServicePlugin } from './i18n-service-plugin';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    /** Test helper: retrieve a registered handler */
    _getHandler(method: string, path: string): RouteHandler | undefined {
      return routes.get(`${method}:${path}`);
    },
  };
}

function createMockPluginContext(services: Record<string, any> = {}) {
  const hooks = new Map<string, Array<(...args: any[]) => Promise<void>>>();
  return {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (services[name]) return services[name];
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map(Object.entries(services))),
    hook: vi.fn((name: string, handler: (...args: any[]) => Promise<void>) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(handler);
    }),
    trigger: vi.fn(async (name: string, ...args: any[]) => {
      const handlers = hooks.get(name) ?? [];
      for (const h of handlers) await h(...args);
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getKernel: vi.fn(),
    replaceService: vi.fn(),
  };
}

function createMockReq(overrides: Partial<IHttpRequest> = {}): IHttpRequest {
  return {
    params: {},
    query: {},
    headers: {},
    method: 'GET',
    path: '/',
    ...overrides,
  };
}

function createMockRes(): IHttpResponse & { _data: any; _status: number } {
  const res: any = {
    _data: null,
    _status: 200,
    json(data: any) { res._data = data; },
    send(data: string) { res._data = data; },
    status(code: number) { res._status = code; return res; },
    header() { return res; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('I18nServicePlugin', () => {
  let httpServer: ReturnType<typeof createMockHttpServer>;
  let ctx: ReturnType<typeof createMockPluginContext>;

  beforeEach(() => {
    httpServer = createMockHttpServer();
    ctx = createMockPluginContext({ 'http-server': httpServer });
  });

  // -- Service registration -------------------------------------------------

  describe('init', () => {
    it('should register i18n service during init', async () => {
      const plugin = new I18nServicePlugin();
      await plugin.init!(ctx as any);

      expect(ctx.registerService).toHaveBeenCalledWith('i18n', expect.any(Object));
    });

    it('should pass options to the FileI18nAdapter', async () => {
      const plugin = new I18nServicePlugin({ defaultLocale: 'zh-CN' });
      await plugin.init!(ctx as any);

      const registeredService = ctx.registerService.mock.calls[0][1];
      expect(registeredService.getDefaultLocale()).toBe('zh-CN');
    });
  });

  // -- Route self-registration ----------------------------------------------

  describe('route self-registration', () => {
    it('should register a kernel:ready hook during start', async () => {
      const plugin = new I18nServicePlugin();
      await plugin.init!(ctx as any);
      await plugin.start!(ctx as any);

      expect(ctx.hook).toHaveBeenCalledWith('kernel:ready', expect.any(Function));
    });

    it('should register i18n routes when http-server is available', async () => {
      const plugin = new I18nServicePlugin();
      await plugin.init!(ctx as any);
      await plugin.start!(ctx as any);

      // Simulate kernel:ready
      await ctx.trigger('kernel:ready');

      expect(httpServer.get).toHaveBeenCalledWith('/api/v1/i18n/locales', expect.any(Function));
      expect(httpServer.get).toHaveBeenCalledWith('/api/v1/i18n/translations/:locale', expect.any(Function));
      expect(httpServer.get).toHaveBeenCalledWith('/api/v1/i18n/labels/:object/:locale', expect.any(Function));
    });

    it('should respect custom basePath', async () => {
      const plugin = new I18nServicePlugin({ basePath: '/custom/i18n' });
      await plugin.init!(ctx as any);
      await plugin.start!(ctx as any);

      await ctx.trigger('kernel:ready');

      expect(httpServer.get).toHaveBeenCalledWith('/custom/i18n/locales', expect.any(Function));
      expect(httpServer.get).toHaveBeenCalledWith('/custom/i18n/translations/:locale', expect.any(Function));
      expect(httpServer.get).toHaveBeenCalledWith('/custom/i18n/labels/:object/:locale', expect.any(Function));
    });

    it('should skip route registration when registerRoutes is false', async () => {
      const plugin = new I18nServicePlugin({ registerRoutes: false });
      await plugin.init!(ctx as any);
      await plugin.start!(ctx as any);

      // kernel:ready / metadata:reloaded hooks are still registered for the
      // authored-translation sync (#2591) — but no HTTP route may land.
      await ctx.trigger('kernel:ready');
      expect(httpServer.get).not.toHaveBeenCalled();
    });

    it('should gracefully skip routes when http-server is not available', async () => {
      const ctxNoHttp = createMockPluginContext({}); // no http-server
      const plugin = new I18nServicePlugin();
      await plugin.init!(ctxNoHttp as any);
      await plugin.start!(ctxNoHttp as any);

      await ctxNoHttp.trigger('kernel:ready');

      expect(ctxNoHttp.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No HTTP server available'),
      );
    });
  });

  // -- Route handler behavior -----------------------------------------------

  describe('route handlers', () => {
    async function setupPlugin(options: ConstructorParameters<typeof I18nServicePlugin>[0] = {}) {
      const plugin = new I18nServicePlugin(options);
      await plugin.init!(ctx as any);
      // Load some translations after init so the service has data
      const i18n = ctx.registerService.mock.calls[0][1];
      i18n.loadTranslations('en', { greeting: 'Hello', 'o.account.fields.name': 'Account Name' });
      i18n.loadTranslations('zh-CN', { greeting: '你好', 'o.account.fields.name': '账户名称' });
      await plugin.start!(ctx as any);
      await ctx.trigger('kernel:ready');
      return { plugin, i18n };
    }

    it('GET /locales should return all available locales', async () => {
      await setupPlugin();

      const handler = httpServer._getHandler('GET', '/api/v1/i18n/locales')!;
      expect(handler).toBeDefined();

      const req = createMockReq();
      const res = createMockRes();
      await handler(req, res);

      expect(res._data).toEqual({
        data: {
          locales: [
            { code: 'en', label: 'en', isDefault: true },
            { code: 'zh-CN', label: 'zh-CN', isDefault: false },
          ],
        },
      });
    });

    it('GET /translations/:locale should return translations for the given locale', async () => {
      await setupPlugin();

      const handler = httpServer._getHandler('GET', '/api/v1/i18n/translations/:locale')!;
      expect(handler).toBeDefined();

      const req = createMockReq({ params: { locale: 'en' } });
      const res = createMockRes();
      await handler(req, res);

      expect(res._data).toEqual({
        data: {
          locale: 'en',
          translations: { greeting: 'Hello', 'o.account.fields.name': 'Account Name' },
        },
      });
    });

    it('GET /translations/:locale should return 400 when locale is missing', async () => {
      await setupPlugin();

      const handler = httpServer._getHandler('GET', '/api/v1/i18n/translations/:locale')!;
      const req = createMockReq({ params: {} });
      const res = createMockRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data).toEqual({ error: 'Missing locale parameter' });
    });

    it('GET /labels/:object/:locale should derive field labels from translation bundle', async () => {
      await setupPlugin();

      const handler = httpServer._getHandler('GET', '/api/v1/i18n/labels/:object/:locale')!;
      expect(handler).toBeDefined();

      const req = createMockReq({ params: { object: 'account', locale: 'en' } });
      const res = createMockRes();
      await handler(req, res);

      expect(res._data).toEqual({
        data: {
          object: 'account',
          locale: 'en',
          labels: { name: 'Account Name' },
        },
      });
    });

    it('GET /labels/:object/:locale should return 400 when params are missing', async () => {
      await setupPlugin();

      const handler = httpServer._getHandler('GET', '/api/v1/i18n/labels/:object/:locale')!;
      const req = createMockReq({ params: {} });
      const res = createMockRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data).toEqual({ error: 'Missing object or locale parameter' });
    });
  });

  // -- Plugin metadata -------------------------------------------------------

  describe('plugin metadata', () => {
    it('should have correct plugin name', () => {
      const plugin = new I18nServicePlugin();
      expect(plugin.name).toBe('com.objectstack.service.i18n');
    });

    it('should have version', () => {
      const plugin = new I18nServicePlugin();
      expect(plugin.version).toBe('1.0.0');
    });
  });
});
