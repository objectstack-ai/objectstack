import { describe, it, expect, vi } from 'vitest';
import { readServiceSelfInfo } from '@objectstack/spec/api';
import { DevPlugin } from './dev-plugin';

// #3060: init()'s graceful-degradation path dynamically imports ~10 real
// workspace packages (objectql, runtime, plugin-auth, …). Under a fully
// parallel `pnpm test` those vite transforms alone can blow past the test
// timeout — the "handle missing deps" test flaked at 15s while passing in
// <100ms standalone. The test's INTENT is "peer deps missing", so make them
// genuinely missing: each factory throws the same shape an absent package
// produces. The degradation branch is exercised for real, with zero real
// module resolution on the hot path. (The stub-contract tests below disable
// all real services, so they never reach these imports.)
// (vi.mock calls are hoisted above any const, so the factories are inline.)
vi.mock('@objectstack/objectql', () => { throw Object.assign(new Error("Cannot find package '@objectstack/objectql'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/runtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/runtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/driver-memory', () => { throw Object.assign(new Error("Cannot find package '@objectstack/driver-memory'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-i18n', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-i18n'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-auth', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-auth'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-security', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-security'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-hono-server', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-hono-server'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/rest', () => { throw Object.assign(new Error("Cannot find package '@objectstack/rest'"), { code: 'ERR_MODULE_NOT_FOUND' }); });

describe('DevPlugin', () => {
  it('should have correct metadata', () => {
    const plugin = new DevPlugin();
    expect(plugin.name).toBe('com.objectstack.plugin.dev');
    expect(plugin.type).toBe('standard');
    expect(plugin.version).toBe('1.0.0');
  });

  it('should accept default options', () => {
    const plugin = new DevPlugin();
    expect(plugin).toBeDefined();
  });

  it('should accept custom options including stack', () => {
    const plugin = new DevPlugin({
      port: 4000,
      seedAdminUser: false,
      verbose: false,
      services: { auth: false, dispatcher: false, security: false },
      stack: { manifest: { id: 'test', name: 'test', version: '1.0.0', type: 'app' } },
    });
    expect(plugin).toBeDefined();
  });

  it('should init with mocked context and handle missing deps gracefully', async () => {
    const ctx: any = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getService: vi.fn().mockImplementation(() => { throw new Error('not found'); }),
      getServices: vi.fn().mockReturnValue(new Map()),
      registerService: vi.fn(),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    };

    // DevPlugin should not throw even if peer dependencies are missing.
    // Deps are mocked-away above (#3060), so the default timeout suffices —
    // if someone removes the mocks, the slowness resurfaces loudly here.
    const plugin = new DevPlugin({ seedAdminUser: false });
    await expect(plugin.init(ctx)).resolves.not.toThrow();
  });

  it('should register contract-compliant dev stubs for every core service except analytics', async () => {
    const registeredServices = new Map<string, any>();
    const ctx: any = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getService: vi.fn().mockImplementation((name: string) => {
        if (registeredServices.has(name)) return registeredServices.get(name);
        throw new Error('not found');
      }),
      getServices: vi.fn().mockReturnValue(new Map()),
      registerService: vi.fn().mockImplementation((name: string, svc: any) => {
        registeredServices.set(name, svc);
      }),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    };

    // Disable real plugins (which need real packages) but allow stubs
    const plugin = new DevPlugin({
      seedAdminUser: false,
      services: {
        objectql: false,
        driver: false,
        auth: false,
        setup: false,
        security: false,
        server: false,
        rest: false,
        dispatcher: false,
      },
    });

    await plugin.init(ctx);

    // Should have registered stubs for all core + security services
    const stubLog = ctx.logger.info.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('dev stubs registered'),
    );
    expect(stubLog).toBeDefined();

    // ── Verify ICacheService contract ──
    const cache = registeredServices.get('cache');
    // [#4058] The wrapped kernel fallback keeps its OWN self-description —
    // plugin-dev never overwrites one, and `createMemoryCache` knows better
    // than this plugin what it is (a real cache, process-local).
    expect(readServiceSelfInfo(cache)?.status).toBe('degraded');
    await cache.set('k1', 'v1');
    expect(await cache.get('k1')).toBe('v1');
    expect(await cache.has('k1')).toBe(true);
    expect(await cache.delete('k1')).toBe(true);
    expect(await cache.has('k1')).toBe(false);
    const stats = await cache.stats();
    expect(typeof stats.hits).toBe('number');
    expect(typeof stats.misses).toBe('number');
    expect(typeof stats.keyCount).toBe('number');

    // ── Verify IQueueService contract ──
    const queue = registeredServices.get('queue');
    const msgId = await queue.publish('test-q', { hello: 'world' });
    expect(typeof msgId).toBe('string');
    expect(await queue.getQueueSize('test-q')).toBe(0);

    // ── Verify IJobService contract ──
    const job = registeredServices.get('job');
    const jobs = await job.listJobs();
    expect(Array.isArray(jobs)).toBe(true);

    // ── Verify IStorageService contract ──
    const storage = registeredServices.get('file-storage');
    await storage.upload('test.txt', Buffer.from('hello'));
    expect(await storage.exists('test.txt')).toBe(true);
    const info = await storage.getInfo('test.txt');
    expect(info.key).toBe('test.txt');
    expect(info.size).toBeGreaterThan(0);
    const downloaded = await storage.download('test.txt');
    expect(downloaded.toString()).toBe('hello');

    // ── Verify ISearchService contract ──
    const search = registeredServices.get('search');
    await search.index('users', '1', { name: 'Alice' });
    const searchResult = await search.search('users', 'alice');
    expect(searchResult.hits).toHaveLength(1);
    expect(typeof searchResult.totalHits).toBe('number');

    // ── Verify IAutomationService contract ──
    const automation = registeredServices.get('automation');
    const execResult = await automation.execute('test_flow');
    expect(execResult.success).toBe(true);
    expect(Array.isArray(await automation.listFlows())).toBe(true);

    // ── analytics: deliberately NOT stubbed (#4000) ──
    // #3891/#3989 retired the degraded analytics shim so an empty slot is the
    // honest signal (route unmounted → 404, discovery `unavailable`). A dev
    // stub refilled the slot and the dispatcher, gating on presence alone,
    // served its fabricated rows with a 200 — the retired shape, one layer
    // down. The slot stays empty; install @objectstack/service-analytics.
    expect(registeredServices.has('analytics')).toBe(false);
    expect(stubLog[0]).not.toContain('analytics');

    // ── Verify IRealtimeService contract ──
    const realtime = registeredServices.get('realtime');
    const subId = await realtime.subscribe('ch', () => {});
    expect(typeof subId).toBe('string');

    // ── Verify INotificationService contract ──
    const notif = registeredServices.get('notification');
    const notifResult = await notif.send({ channel: 'email', to: 'test@dev', body: 'hello' });
    expect(notifResult.success).toBe(true);
    expect(typeof notifResult.messageId).toBe('string');

    // ── Verify IAIService contract ──
    const ai = registeredServices.get('ai');
    const chatResult = await ai.chat([{ role: 'user', content: 'hi' }]);
    expect(typeof chatResult.content).toBe('string');
    expect(typeof chatResult.model).toBe('string');
    expect(Array.isArray(await ai.listModels())).toBe(true);

    // ── Verify II18nService contract ──
    const i18n = registeredServices.get('i18n');
    i18n.loadTranslations('en', { 'hello': 'Hello {{name}}' });
    expect(i18n.t('hello', 'en', { name: 'World' })).toBe('Hello World');
    expect(i18n.t('missing', 'en')).toBe('missing');
    expect(Array.isArray(i18n.getLocales())).toBe(true);

    // ── Verify IWorkflowService contract ──
    const workflow = registeredServices.get('workflow');
    const transResult = await workflow.transition({ recordId: 'r1', object: 'order', targetState: 'approved' });
    expect(transResult.success).toBe(true);
    expect(transResult.currentState).toBe('approved');
    const status = await workflow.getStatus('order', 'r1');
    expect(status.currentState).toBe('approved');
    expect(Array.isArray(status.availableTransitions)).toBe(true);

    // ── Verify IMetadataService contract (stub fallback) ──
    const metadata = registeredServices.get('metadata');
    metadata.register('object', { name: 'account' });
    expect(metadata.get('object', 'account')).toBeDefined();
    expect(Array.isArray(metadata.list('object'))).toBe(true);
    expect(Array.isArray(metadata.listObjects())).toBe(true);

    // Security sub-services are registered by either the real SecurityPlugin
    // or dev stubs (when security is disabled, they're skipped entirely).
    // The stubs follow the same contracts as the real implementations.
  });

  // [#4058] The classification is the deliverable, so it is pinned here rather
  // than left to a code review of the table. Every dev implementation must say
  // what it IS: `degraded` when it really does the work with reduced capability,
  // `stub` when the answer is fabricated. One blanket `_dev: true` used to
  // declare all of them equally fake, which is why the two could not be told
  // apart — and why a consumer had no way to distinguish "search works here"
  // from "this AI reply is invented".
  it('every dev implementation self-describes honestly (degraded vs stub)', async () => {
    const registeredServices = new Map<string, any>();
    const ctx: any = {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getService: vi.fn().mockImplementation((name: string) => {
        if (registeredServices.has(name)) return registeredServices.get(name);
        throw new Error('not found');
      }),
      getServices: vi.fn().mockReturnValue(new Map()),
      registerService: vi.fn().mockImplementation((name: string, svc: any) => {
        registeredServices.set(name, svc);
      }),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    };

    // Only the plugin-loading toggles are turned off — `auth` and `security`
    // stay ON so their stub slots are exercised too (the real plugins behind
    // them are mocked away as missing at the top of this file, so init falls
    // through to the stubs exactly as a dev boot without them would).
    await new DevPlugin({
      seedAdminUser: false,
      services: {
        objectql: false, driver: false, setup: false,
        server: false, rest: false, dispatcher: false,
      },
    }).init(ctx);

    // Really do the work, just less of it — their answers are true answers.
    const DEGRADED = ['cache', 'queue', 'job', 'file-storage', 'search', 'realtime', 'i18n', 'workflow', 'metadata'];
    // Fabricate the answer — must never be mistaken for a capability.
    // (`security.*` are no longer in this list because they are no longer
    // registered at all — see the dedicated test below, #4093.)
    const STUB = ['automation', 'notification', 'ai', 'data', 'auth'];

    for (const name of DEGRADED) {
      const info = readServiceSelfInfo(registeredServices.get(name));
      expect(info?.status, `${name} must be degraded`).toBe('degraded');
      expect(info?.message, `${name} must explain what is missing`).toBeTruthy();
    }
    for (const name of STUB) {
      const info = readServiceSelfInfo(registeredServices.get(name));
      expect(info?.status, `${name} must be stub`).toBe('stub');
      // A fabricated answer is never served by a ready handler.
      expect(info?.handlerReady, `${name} handlerReady`).toBe(false);
      expect(info?.message, `${name} must say what it fakes`).toBeTruthy();
    }

    // No HTTP/WS surface is mounted for these, so no handler can be ready —
    // independent of the implementation being real (ADR-0076 D12, realtime).
    // `file-storage` joined them in #4087: the dispatcher's `/storage` bridge
    // was the only thing that ever routed HTTP to this slot, and it was
    // retired — `@objectstack/service-storage` owns that surface and mounts
    // its own routes against its own adapters, never this implementation.
    for (const name of ['cache', 'queue', 'job', 'realtime', 'file-storage']) {
      expect(readServiceSelfInfo(registeredServices.get(name))?.handlerReady, `${name} handlerReady`).toBe(false);
    }

    // `ui` has no factory at all — the shapeless placeholder must still be
    // honest about being nothing.
    const ui = readServiceSelfInfo(registeredServices.get('ui'));
    expect(ui?.status).toBe('stub');
    expect(ui?.handlerReady).toBe(false);

    // The retired analytics slot stays empty (#4000).
    expect(registeredServices.has('analytics')).toBe(false);
  });

  // [#4093] The one thing a fallback may never fake. ADR-0076 D12, from #3891:
  // "a fallback may degrade features, never security semantics" — and these
  // three did not merely degrade, they inverted. `checkObjectPermission()`
  // answered `true` for everything, `compileFilter()` returned `null` so no
  // row-level predicate applied, `maskResults()` returned rows unmasked. The
  // contract calls them plugin-security's internals and requires
  // access-narrowing answers to fail CLOSED; a fake registered by another
  // package under those names is the opposite. The slots stay empty.
  it('registers NO security sub-service stub, and says so loudly', async () => {
    const registered = new Map<string, any>();
    const ctx: any = {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getService: vi.fn().mockImplementation((name: string) => {
        if (registered.has(name)) return registered.get(name);
        throw new Error('not found');
      }),
      getServices: vi.fn().mockReturnValue(new Map()),
      registerService: vi.fn().mockImplementation((n: string, s: any) => { registered.set(n, s); }),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    };

    // `security` left ENABLED — plugin-security is mocked as missing at the top
    // of this file, so this is exactly the boot that used to get allow-all.
    await new DevPlugin({
      seedAdminUser: false,
      services: { objectql: false, driver: false, setup: false, server: false, rest: false, dispatcher: false },
    }).init(ctx);

    for (const slot of ['security.permissions', 'security.rls', 'security.fieldMasker']) {
      expect(registered.has(slot), `${slot} must NOT be registered`).toBe(false);
    }

    // "Nothing is enforcing RBAC/RLS/masking" is not a silent condition.
    const warned = ctx.logger.warn.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('No security services'),
    );
    expect(warned, 'must warn that security is unenforced').toBeDefined();
    expect(warned[0]).toContain('plugin-security');
  });

  // [#4093] The package is published, has no environment check of its own, and
  // registers fakes that report success for work they never did. A production
  // process that loads it is misconfigured in a way no runtime behaviour can
  // make safe, so refuse the boot instead of degrading quietly.
  describe('production guard', () => {
    const makeCtx = () => ({
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getService: vi.fn().mockImplementation(() => { throw new Error('not found'); }),
      getServices: vi.fn().mockReturnValue(new Map()),
      registerService: vi.fn(),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    }) as any;

    // Restored per-case: these tests mutate process.env deliberately.
    const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
      const saved: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      try { await run(); } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
      }
    };

    it('refuses to initialize under NODE_ENV=production', async () => {
      await withEnv({ NODE_ENV: 'production', OS_ALLOW_DEV_PLUGIN: undefined }, async () => {
        const ctx = makeCtx();
        await expect(new DevPlugin({ seedAdminUser: false }).init(ctx)).rejects.toThrow(/NODE_ENV=production/);
        // And nothing was registered before the refusal.
        expect(ctx.registerService).not.toHaveBeenCalled();
      });
    });

    it('names the escape hatch in the refusal, and honours it', async () => {
      await withEnv({ NODE_ENV: 'production', OS_ALLOW_DEV_PLUGIN: undefined }, async () => {
        await expect(new DevPlugin({ seedAdminUser: false }).init(makeCtx()))
          .rejects.toThrow(/OS_ALLOW_DEV_PLUGIN=1/);
      });
      await withEnv({ NODE_ENV: 'production', OS_ALLOW_DEV_PLUGIN: '1' }, async () => {
        await expect(new DevPlugin({ seedAdminUser: false }).init(makeCtx())).resolves.not.toThrow();
      });
    });

    it('stays out of the way for every other NODE_ENV', async () => {
      for (const value of ['development', 'test', undefined]) {
        await withEnv({ NODE_ENV: value, OS_ALLOW_DEV_PLUGIN: undefined }, async () => {
          await expect(new DevPlugin({ seedAdminUser: false }).init(makeCtx())).resolves.not.toThrow();
        });
      }
    });
  });

  it('should skip disabled services', async () => {
    const ctx: any = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getService: vi.fn().mockImplementation(() => { throw new Error('not found'); }),
      getServices: vi.fn().mockReturnValue(new Map()),
      registerService: vi.fn(),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    };

    const plugin = new DevPlugin({
      seedAdminUser: false,
      services: {
        objectql: false,
        driver: false,
        auth: false,
        setup: false,
        server: false,
        rest: false,
        dispatcher: false,
        security: false,
        // Disable all core services too
        metadata: false,
        data: false,
        cache: false,
        queue: false,
        job: false,
        'file-storage': false,
        search: false,
        automation: false,
        graphql: false,
        analytics: false,
        realtime: false,
        notification: false,
        ai: false,
        i18n: false,
        ui: false,
        workflow: false,
      },
    });

    await plugin.init(ctx);

    // No child plugins AND no stubs should be registered
    const initLog = ctx.logger.info.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('initialized'),
    );
    expect(initLog).toBeDefined();
    expect(initLog[0]).toContain('0 plugin');
    expect(initLog[0]).toContain('0 dev stub');
  });

  it('should destroy without errors', async () => {
    const plugin = new DevPlugin();
    await expect(plugin.destroy()).resolves.not.toThrow();
  });
});
