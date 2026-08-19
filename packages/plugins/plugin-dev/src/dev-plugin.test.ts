import { describe, it, expect, vi, afterEach } from 'vitest';
import { DevPlugin } from './dev-plugin';

// #3060: init()'s graceful-degradation path dynamically imports ~10 real
// workspace packages (objectql, runtime, plugin-auth, …). Under a fully
// parallel `pnpm test` those vite transforms alone can blow past the test
// timeout — the "handle missing deps" test flaked at 15s while passing in
// <100ms standalone. The tests' INTENT is "peer deps missing", so make them
// genuinely missing: each factory throws the same shape an absent package
// produces. The degradation branch is exercised for real, with zero real
// module resolution on the hot path.
// (vi.mock calls are hoisted above any const, so the factories are inline.)
vi.mock('@objectstack/objectql', () => { throw Object.assign(new Error("Cannot find package '@objectstack/objectql'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/runtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/runtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/driver-memory', () => { throw Object.assign(new Error("Cannot find package '@objectstack/driver-memory'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-i18n', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-i18n'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-storage', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-storage'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-realtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-realtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-auth', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-auth'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-security', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-security'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-hono-server', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-hono-server'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/rest', () => { throw Object.assign(new Error("Cannot find package '@objectstack/rest'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/setup', () => { throw Object.assign(new Error("Cannot find package '@objectstack/setup'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/account', () => { throw Object.assign(new Error("Cannot find package '@objectstack/account'"), { code: 'ERR_MODULE_NOT_FOUND' }); });

function mockCtx() {
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
  return { ctx, registeredServices };
}

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
    const { ctx } = mockCtx();
    // DevPlugin should not throw even if peer dependencies are missing.
    // Deps are mocked-away above (#3060), so the default timeout suffices —
    // if someone removes the mocks, the slowness resurfaces loudly here.
    const plugin = new DevPlugin({ seedAdminUser: false });
    await expect(plugin.init(ctx)).resolves.not.toThrow();
  });

  // [ADR-0115 D1] The stub table is retired. This plugin registers NO service
  // implementations of its own: with every child plugin unavailable, init()
  // must complete without putting anything into any slot. An empty slot is
  // the honest signal — identical to production — and the retired fakes
  // (allow-all security.*, verify()→admin auth, success-without-work
  // automation/notification/ai, the shapeless `ui` placeholder) must never
  // come back. This test is the tombstone's guard.
  it('registers no service implementation of its own — every unfilled slot stays empty', async () => {
    const { ctx, registeredServices } = mockCtx();

    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    // Not one slot was filled by this plugin itself.
    expect(ctx.registerService).not.toHaveBeenCalled();
    expect(registeredServices.size).toBe(0);

    // Pin the retired names explicitly so a partial re-introduction of the
    // table fails with the slot's name in the message.
    for (const name of [
      'data', 'auth', 'ui',
      'security.permissions', 'security.rls', 'security.fieldMasker',
      'ai', 'automation', 'notification', 'analytics',
      'cache', 'queue', 'job', 'i18n', 'metadata',
      'storage', 'file-storage', 'search', 'realtime', 'workflow',
    ]) {
      expect(registeredServices.has(name), `${name} slot must stay empty`).toBe(false);
    }

    // And the boot log no longer advertises stubs.
    const stubLog = ctx.logger.info.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('dev stub'),
    );
    expect(stubLog).toBeUndefined();

    // The empty security slots are still called out loudly (#4126's boot-log
    // honesty): empty beats a fake that answers "allowed", but silence about
    // unenforced RBAC/RLS/masking would be its own kind of fake.
    const securityWarn = ctx.logger.warn.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('NOT enforced'),
    );
    expect(securityWarn).toBeDefined();
  });

  describe('production guard (ADR-0115 D6)', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedAllow = process.env.OS_ALLOW_DEV_PLUGIN;

    afterEach(() => {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
      if (savedAllow === undefined) delete process.env.OS_ALLOW_DEV_PLUGIN;
      else process.env.OS_ALLOW_DEV_PLUGIN = savedAllow;
    });

    it('refuses to init when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.OS_ALLOW_DEV_PLUGIN;

      const { ctx } = mockCtx();
      await expect(new DevPlugin({ seedAdminUser: false }).init(ctx))
        .rejects.toThrow(/NODE_ENV=production/);
      // The refusal happens before any assembly work.
      expect(ctx.registerService).not.toHaveBeenCalled();
    });

    it('OS_ALLOW_DEV_PLUGIN=1 overrides the guard, deliberately', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OS_ALLOW_DEV_PLUGIN = '1';

      const { ctx } = mockCtx();
      await expect(new DevPlugin({ seedAdminUser: false }).init(ctx)).resolves.not.toThrow();
    });

    // [#3900] The hatch used to return silently: the dev assembly booted under
    // a production NODE_ENV and every log line read like an ordinary start.
    // An escape hatch that says nothing rebuilds the hole the guard closed.
    it('brands the override in the boot log, naming the live hazards', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OS_ALLOW_DEV_PLUGIN = '1';

      const { ctx } = mockCtx();
      await new DevPlugin({ seedAdminUser: false }).init(ctx);

      const warns = ctx.logger.warn.mock.calls
        .map((call: any[]) => call[0])
        .filter((line: any) => typeof line === 'string');

      expect(warns.some((l: string) => l.includes('DEV ASSEMBLY UNDER NODE_ENV=production'))).toBe(true);
      expect(warns.some((l: string) => l.includes('OS_ALLOW_DEV_PLUGIN'))).toBe(true);
      // The default auth secret is published in the package — anyone holding it
      // can mint a session, so it is named rather than merely implied.
      expect(warns.some((l: string) => l.includes('Auth secret is the default published'))).toBe(true);
      expect(warns.some((l: string) => l.includes('persistence disabled'))).toBe(true);
    });

    it('does not claim the published-secret hazard when authSecret was overridden', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OS_ALLOW_DEV_PLUGIN = '1';

      const { ctx } = mockCtx();
      await new DevPlugin({ seedAdminUser: false, authSecret: 'operator-supplied-secret' }).init(ctx);

      const warns = ctx.logger.warn.mock.calls
        .map((call: any[]) => call[0])
        .filter((line: any) => typeof line === 'string');

      // Still branded — the assembly is the hazard, not just its secret.
      expect(warns.some((l: string) => l.includes('DEV ASSEMBLY UNDER NODE_ENV=production'))).toBe(true);
      // …but a warning that is false for this deployment is not printed.
      expect(warns.some((l: string) => l.includes('Auth secret is the default published'))).toBe(false);
    });

    it('repeats the brand on the ready banner, not only in the init log', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OS_ALLOW_DEV_PLUGIN = '1';

      const { ctx } = mockCtx();
      const plugin = new DevPlugin({ seedAdminUser: false });
      await plugin.init(ctx);
      ctx.logger.warn.mockClear();
      await plugin.start(ctx);

      const warns = ctx.logger.warn.mock.calls
        .map((call: any[]) => call[0])
        .filter((line: any) => typeof line === 'string');
      expect(warns.some((l: string) => l.includes('NOT a production stack'))).toBe(true);
    });

    // The branding must not fire on the path everyone actually uses, or it is
    // noise that trains operators to ignore the real thing.
    it('says nothing about the override on an ordinary dev boot', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.OS_ALLOW_DEV_PLUGIN;

      const { ctx } = mockCtx();
      const plugin = new DevPlugin({ seedAdminUser: false });
      await plugin.init(ctx);
      await plugin.start(ctx);

      const warns = ctx.logger.warn.mock.calls
        .map((call: any[]) => call[0])
        .filter((line: any) => typeof line === 'string');
      expect(warns.some((l: string) => l.includes('DEV ASSEMBLY'))).toBe(false);
      expect(warns.some((l: string) => l.includes('NOT a production stack'))).toBe(false);
    });

    // The hatch shares the `OS_ALLOW_*` truthy vocabulary
    // (`resolveAllowDevPlugin`). The strict `=== '1'` it replaced failed CLOSED
    // on `=true` — safe, but it reads to an operator as a broken flag.
    it.each(['true', 'TRUE', 'on', 'yes', ' 1 '])(
      'accepts OS_ALLOW_DEV_PLUGIN=%j like every other OS_ALLOW_* hatch',
      async (value) => {
        process.env.NODE_ENV = 'production';
        process.env.OS_ALLOW_DEV_PLUGIN = value;

        const { ctx } = mockCtx();
        await expect(new DevPlugin({ seedAdminUser: false }).init(ctx)).resolves.not.toThrow();
      },
    );

    it.each(['0', 'false', 'off', 'no', ''])(
      'still refuses on a falsy OS_ALLOW_DEV_PLUGIN=%j',
      async (value) => {
        process.env.NODE_ENV = 'production';
        process.env.OS_ALLOW_DEV_PLUGIN = value;

        const { ctx } = mockCtx();
        await expect(new DevPlugin({ seedAdminUser: false }).init(ctx))
          .rejects.toThrow(/NODE_ENV=production/);
      },
    );
  });

  // [ADR-0115 D4] The slots the retired stubs used to fake are filled by the
  // REAL service packages when installed (assembly, not simulation). With the
  // packages mocked-missing the wiring must degrade to a logged skip that
  // names the slot left empty — never to a fake.
  it('storage/realtime auto-wire degrades to an honest skip when the packages are missing', async () => {
    const { ctx, registeredServices } = mockCtx();

    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const logLines = ctx.logger.info.mock.calls
      .map((call: any[]) => call[0])
      .filter((line: any) => typeof line === 'string');
    expect(logLines.some((l: string) => l.includes('service-storage not installed'))).toBe(true);
    expect(logLines.some((l: string) => l.includes('service-realtime not installed'))).toBe(true);
    expect(registeredServices.has('storage')).toBe(false);
    expect(registeredServices.has('file-storage')).toBe(false);
    expect(registeredServices.has('realtime')).toBe(false);
  });

  it('should skip disabled services', async () => {
    const { ctx } = mockCtx();

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
        i18n: false,
        // Deliberately the deprecated alias spelling — pins that a v17
        // config written before the #9683 rename still skips the service.
        'file-storage': false,
        realtime: false,
      },
    });

    await plugin.init(ctx);

    // No child plugins at all — and nothing registered.
    const initLog = ctx.logger.info.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('initialized'),
    );
    expect(initLog).toBeDefined();
    expect(initLog[0]).toContain('0 plugin');
    expect(ctx.registerService).not.toHaveBeenCalled();
  });

  it('should destroy without errors', async () => {
    const plugin = new DevPlugin();
    await expect(plugin.destroy()).resolves.not.toThrow();
  });
});
