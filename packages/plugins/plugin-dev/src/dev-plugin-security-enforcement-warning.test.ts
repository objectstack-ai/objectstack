import { describe, it, expect, vi } from 'vitest';
import { DevPlugin } from './dev-plugin';

// [#10036] The state under test is "SecurityPlugin LOADED but its start()
// bailed", so `@objectstack/plugin-security` is deliberately NOT mocked here —
// the real plugin's real `init()`/`start()` phase split is what constructs the
// state. Every OTHER optional dependency is mocked away for the same reason as
// #3060 (their vite transforms alone can blow the timeout), and their absence
// is irrelevant to this file's subject.
vi.mock('@objectstack/objectql', () => { throw Object.assign(new Error("Cannot find package '@objectstack/objectql'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/runtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/runtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/driver-memory', () => { throw Object.assign(new Error("Cannot find package '@objectstack/driver-memory'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-i18n', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-i18n'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-storage', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-storage'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/service-realtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/service-realtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/plugin-auth', () => { throw Object.assign(new Error("Cannot find package '@objectstack/plugin-auth'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
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
      throw new Error(`service '${name}' not found`);
    }),
    getServices: vi.fn().mockReturnValue(new Map()),
    registerService: vi.fn().mockImplementation((name: string, svc: any) => {
      registeredServices.set(name, svc);
    }),
    hook: vi.fn(),
    trigger: vi.fn(),
    getKernel: vi.fn(),
  };
  // SecurityPlugin.init() contributes to the manifest; without this its init()
  // throws midway and the state we want to construct is only half-built.
  registeredServices.set('manifest', { register: () => {} });
  return { ctx, registeredServices };
}

/** Every `logger.warn` line that claims security is not being enforced. */
function enforcementWarnings(ctx: any): string[] {
  return ctx.logger.warn.mock.calls
    .map((call: any[]) => (typeof call[0] === 'string' ? call[0] : ''))
    .filter((msg: string) => msg.includes('NOT enforced'));
}

async function boot(ctx: any, options: Record<string, unknown> = {}) {
  const plugin = new DevPlugin({ seedAdminUser: false, ...options });
  await plugin.init(ctx);
  await plugin.start(ctx);
  return plugin;
}

describe('[#10036] the "nothing is enforced" warning must fire when SecurityPlugin.start() bailed', () => {
  // ── The state the warning describes, constructed for real ───────────────
  //
  // SecurityPlugin registers `security.permissions` / `security.rls` /
  // `security.fieldMasker` in `init()` and the published `security` service
  // (plus every enforcement middleware) only in `start()`, which returns early
  // when the engine cannot take middleware. So a stack can hold all three
  // internal handles while NOTHING is enforced — and that is precisely the
  // state the warning's own text describes.

  it('bail #1 (no objectql/metadata service): the three init() handles resolve, `security` does not, and the warning fires', async () => {
    const { ctx, registeredServices } = mockCtx();
    // No `objectql` service at all → SecurityPlugin.start() takes its FIRST
    // early return.
    await boot(ctx);

    // Precondition — the state really is the one the card describes.
    expect(registeredServices.has('security.permissions'), 'SecurityPlugin.init() ran').toBe(true);
    expect(registeredServices.has('security.rls')).toBe(true);
    expect(registeredServices.has('security.fieldMasker')).toBe(true);
    expect(registeredServices.has('security'), 'start() bailed before publishing the service').toBe(false);

    // The real plugin logged its own bail, from inside itself.
    const bail = ctx.logger.warn.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('security middleware not registered'),
    );
    expect(bail, 'SecurityPlugin.start() must have bailed').toBeDefined();

    // …and the dev assembly says so out loud.
    const warnings = enforcementWarnings(ctx);
    expect(warnings.length, 'the dev assembly must warn that nothing is enforced').toBe(1);
    expect(warnings[0]).toContain('LOADED');
  });

  it('bail #2 (engine cannot take middleware): same — handles present, no enforcement, warning fires', async () => {
    const { ctx, registeredServices } = mockCtx();
    // An engine that resolves but has no `registerMiddleware` → SecurityPlugin
    // .start() takes its SECOND early return.
    registeredServices.set('objectql', { find: () => [] });
    registeredServices.set('metadata', { list: () => [] });

    await boot(ctx);

    expect(registeredServices.has('security.permissions')).toBe(true);
    expect(registeredServices.has('security')).toBe(false);

    const bail = ctx.logger.warn.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('does not support middleware'),
    );
    expect(bail, 'the engine-cannot-take-middleware bail must be the one taken').toBeDefined();

    const warnings = enforcementWarnings(ctx);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('LOADED');
  });

  it('does not fire when SecurityPlugin.start() completed and published the `security` service', async () => {
    const { ctx, registeredServices } = mockCtx();
    // An engine that CAN take middleware → start() runs to completion and
    // registers the published `security` service alongside the middleware.
    const registerMiddleware = vi.fn();
    registeredServices.set('objectql', { registerMiddleware, find: () => [] });
    registeredServices.set('metadata', { list: () => [], get: () => undefined });

    await boot(ctx);

    // Precondition — this really is the healthy state.
    expect(registeredServices.has('security'), 'start() published the service').toBe(true);
    expect(registerMiddleware, 'enforcement middleware was installed').toHaveBeenCalled();

    expect(enforcementWarnings(ctx)).toEqual([]);
  });

  it('stays silent when the operator disabled security explicitly', async () => {
    const { ctx } = mockCtx();
    await boot(ctx, { services: { security: false } });
    expect(enforcementWarnings(ctx)).toEqual([]);
  });
});
