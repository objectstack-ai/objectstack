import { describe, it, expect, vi, beforeAll } from 'vitest';
import { DevPlugin } from './dev-plugin';

// [#10036] The state under test is "SecurityPlugin LOADED but its start()
// bailed", so `@objectstack/plugin-security` is deliberately NOT mocked here —
// the real plugin's real `init()`/`start()` phase split is what constructs the
// state. Every OTHER optional dependency is mocked away for the same reason as
// #3060 (their vite transforms alone can blow the timeout), and their absence
// is irrelevant to this file's subject.
//
// One FURTHER omission, measured rather than assumed:
// `@objectstack/driver-memory` is deliberately not mocked here either,
// because DevPlugin imports
// `@objectstack/runtime` on the line BEFORE it and that import throws, so the
// driver import is never evaluated and a mock for it would be dead weight. It
// is a frozen driver under a retirement census (#5499/#5704/#6664), where an
// unnecessary module binding is the defect the census exists to catch, so the
// dead mock is not harmless bookkeeping. Probed, not reasoned: a marker in the
// factory printed 0 times across the whole file while the same marker in the
// `@objectstack/runtime` factory printed 8 times in the same run. ⛔ Do not add
// one back.
vi.mock('@objectstack/objectql', () => { throw Object.assign(new Error("Cannot find package '@objectstack/objectql'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
vi.mock('@objectstack/runtime', () => { throw Object.assign(new Error("Cannot find package '@objectstack/runtime'"), { code: 'ERR_MODULE_NOT_FOUND' }); });
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

// [#10115] Pay the one-off module-graph cost HERE, before the first `it`.
//
// `DevPlugin.start()` reaches `@objectstack/plugin-security` through a dynamic
// `await import()`, and this file deliberately leaves that chain unmocked (see
// the header: the real plugin's `init()`/`start()` phase split IS the subject).
// So whichever test ran first paid the plugin's cold vite transform inside its
// own measured window. Measured on an idle 4-vCPU container, bail #1 cost
// 3110 / 3351 / 3360 ms — ~70% of vitest's 5000ms default `testTimeout` — while
// the other three tests cost 3-5 ms each. Under four concurrent tsup DTS builds
// of plugin-dev dependents it crossed the budget on every run
// (5006 / 5007 / 5006 ms, `Test timed out in 5000ms`), and bail #2 then
// inherited the still-cold import (2203-2931 ms) and went red with it on the
// busier CI shard. Because a PR that dirties a plugin-dev dependency both makes
// this file re-run AND makes it run beside a cold rebuild, the failure was
// intermittent and named neither the real cause nor the offending PR — it read
// as "your change broke security enforcement" when nothing of the sort happened.
//
// Warming the import here moves that one-off transform off every test's clock
// and onto vitest's separate `hookTimeout` (default 10000ms — twice the test
// budget), so each `it` measures only the behaviour it is about. Same machine,
// same load, after: bail #1 22-26 ms idle and 29-54 ms under the same four-build
// load, all four tests green.
//
// ⛔ This must stay a REAL import of the REAL plugin — replacing it with a stub,
// here or via `vi.mock`, deletes the subject exactly as the header warns.
// ⛔ Do not answer a future recurrence by raising `testTimeout` instead: that
// widens the window around the cost rather than moving the cost out of it, and
// it re-hides the next in-test transform that lands in this file.
beforeAll(async () => {
  await import('@objectstack/plugin-security');
});

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
