// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nServicePlugin } from './i18n-service-plugin.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * An `IHttpServer` that records EVERY way a plugin could put a route on it:
 * the five verbs, middleware, and the raw-app escape hatch.
 */
function createMockHttpServer() {
  const rawApp = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), all: vi.fn(), use: vi.fn(), route: vi.fn() };
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    getRawApp: vi.fn(() => rawApp),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    rawApp,
  };
}

/** Every recorded call that would have registered a route, as `owner.method path`. */
function registrations(server: ReturnType<typeof createMockHttpServer>): string[] {
  const out: string[] = [];
  for (const verb of ['get', 'post', 'put', 'delete', 'patch', 'use'] as const) {
    for (const call of server[verb].mock.calls) out.push(`server.${verb} ${String(call[0])}`);
  }
  for (const [verb, fn] of Object.entries(server.rawApp)) {
    for (const call of fn.mock.calls) out.push(`rawApp.${verb} ${String(call[0])}`);
  }
  return out;
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
    /** Every lifecycle event a hook could be waiting on. */
    hookNames: () => [...hooks.keys()],
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('I18nServicePlugin', () => {
  let ctx: ReturnType<typeof createMockPluginContext>;

  beforeEach(() => {
    ctx = createMockPluginContext();
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

    it('threads fallbackLocale through to the registered service (#14882)', async () => {
      // What `os serve` / the dev plugin pass for a zh-CN workspace
      // (`fallbackLocale || defaultLocale || 'en'`); the REST metadata reads
      // read it back through `getFallbackLocale()`.
      const plugin = new I18nServicePlugin({ defaultLocale: 'zh-CN', fallbackLocale: 'zh-CN' });
      await plugin.init!(ctx as any);

      const registeredService = ctx.registerService.mock.calls[0][1];
      expect(registeredService.getFallbackLocale()).toBe('zh-CN');
    });

    it('reports a translation fallback through the plugin logger (#28109)', async () => {
      const plugin = new I18nServicePlugin({ defaultLocale: 'en', fallbackLocale: 'en' });
      await plugin.init!(ctx as any);
      const i18n = ctx.registerService.mock.calls[0][1];
      i18n.loadTranslations('en', { only_en: 'English only' });
      i18n.loadTranslations('zh-CN', { other: '其他' });
      ctx.logger.warn.mockClear();

      expect(i18n.t('only_en', 'zh-CN')).toBe('English only');
      expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
      expect(String(ctx.logger.warn.mock.calls[0][0])).toContain("'only_en'");
    });
  });

  // -- HTTP surface: none (#23347) -------------------------------------------

  describe('HTTP surface', () => {
    // [#23347] The dispatcher bridge is the one owner of `/api/v1/i18n/*`
    // (ADR-0076 D11; its `/i18n` domain enforces ADR-0056 D2's
    // authenticated-caller floor). This plugin used to register the same three
    // patterns again at `kernel:ready`; measured on `objectstack serve` over
    // the showcase, the dispatcher's registration answered every request, so
    // the copy was unreachable there and floor-less wherever no dispatcher was
    // composed. It is retired, and this pins that it stays retired: an HTTP
    // server IS available under both service names, and every lifecycle event
    // the plugin hooks is fired, and still nothing lands on it.
    it('registers the i18n service and mounts no route on the HTTP server it is given', async () => {
      const server = createMockHttpServer();
      const pluginCtx = createMockPluginContext({ 'http-server': server, 'http.server': server });
      const plugin = new I18nServicePlugin();

      await plugin.init!(pluginCtx as any);
      await plugin.start!(pluginCtx as any);
      // `kernel:ready` is where the retired mount lived; fire it, then every
      // other event the plugin hooked, so a mount moved to another phase is
      // caught too.
      expect(pluginCtx.hookNames()).toContain('kernel:ready');
      for (const name of pluginCtx.hookNames()) await pluginCtx.trigger(name);

      expect(pluginCtx.registerService).toHaveBeenCalledWith('i18n', expect.any(Object));
      expect(registrations(server)).toEqual([]);
      expect(server.getRawApp).not.toHaveBeenCalled();
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
