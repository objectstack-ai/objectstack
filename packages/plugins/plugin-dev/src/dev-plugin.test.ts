import { describe, it, expect, vi } from 'vitest';
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

  it('should register contract-compliant dev stubs for all core services', async () => {
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
    expect(cache._dev).toBe(true);
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

    // ── Verify IGraphQLService contract ──
    const gql = registeredServices.get('graphql');
    const gqlResult = await gql.execute({ query: '{ _dev }' });
    expect('data' in gqlResult || 'errors' in gqlResult).toBe(true);
    expect(typeof gql.getSchema()).toBe('string');

    // ── Verify IAnalyticsService contract ──
    const analytics = registeredServices.get('analytics');
    const analyticsResult = await analytics.query({ cube: 'test' });
    expect(Array.isArray(analyticsResult.rows)).toBe(true);
    expect(Array.isArray(analyticsResult.fields)).toBe(true);
    expect(Array.isArray(await analytics.getMeta())).toBe(true);

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
