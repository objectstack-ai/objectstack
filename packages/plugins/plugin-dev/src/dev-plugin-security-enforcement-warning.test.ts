import { describe, it, expect, vi } from 'vitest';
import { DevPlugin } from './dev-plugin';

// [#10115] Pay the one-off `@objectstack/plugin-security` module-graph cost at
// MODULE LOAD, not inside any hook and not inside any test.
//
// `DevPlugin.start()` reaches the plugin through a dynamic `await import()`, and
// this file deliberately leaves that chain unmocked (see the header below: the
// real plugin's `init()`/`start()` phase split IS the subject). Something has to
// pay its cold vite transform; the only question is which clock is running when
// it does. This file has now answered that question wrongly twice:
//
//   * paid inside whichever `it` ran first  -> `Test timed out in 5000ms`
//     (idle 3110/3351/3360 ms; red on every run under four concurrent builds).
//   * moved into a `beforeAll`              -> `Hook timed out in 10000ms`,
//     which ejected this file from the merge queue four times in one night
//     (runs 32334616926 / 32334642055 / 32334745861 / 32335141663, shard
//     `Test Core (3/3)`, file duration 10024ms) while PR-side CI stayed green --
//     the queue runs the FULL suite, PR-side CI only the affected subset, so the
//     queue shard is far heavier than anything the PR checks measure.
//
// Neither move took the cost OUT of a clocked window; each only widened or
// swapped the window around it, which relocates the cliff to the next heavier
// shard instead of removing it. A top-level import is paid during collection,
// and in vitest 4.1.10 collection is clocked against NOTHING. Verified against
// the installed runner, not recalled: `@vitest/runner` wraps exactly hooks and
// test bodies in `withTimeout(...)`, while `collectTests()` awaits
// `runner.importFile(filepath, 'collect')` bare and merely RECORDS
// `file.collectDuration` for reporters; and `vitest --help` on 4.1.10 offers
// exactly three timeout knobs -- `testTimeout`, `hookTimeout`, `teardownTimeout`
// -- none of which covers module loading.
//
// Measured on a 4-vCPU container with this run confined to a single core and a
// spinner beside it (idle -> loaded): the old `beforeAll` cost 3.3s -> 7.2-7.4s,
// i.e. 74% of its 10000ms budget on a machine that could not even reach the
// load the queue applies. After this change the file has NO hook at all, its
// four tests cost 2-70 ms each against the 5000ms `testTimeout`, and the run
// stays green even under `--hookTimeout=1` -- there is no hook time left to clock.
//
// `vi.mock` is hoisted above every import in this file, this one included, so
// the ten mocks below still register before this module is evaluated.
//
// This must stay a REAL, STATIC, side-effect import of the REAL plugin:
//   - replacing it with a stub, here or via `vi.mock`, deletes the subject
//     exactly as the header warns;
//   - turning it back into a hook or a dynamic `await import()` puts the cost
//     back inside a clocked window and re-arms the ejection;
//   - answering a recurrence by raising `testTimeout` / `hookTimeout` widens the
//     window around the cost rather than moving the cost out of it, and re-hides
//     the next transform that lands in this file.
import '@objectstack/plugin-security';

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
