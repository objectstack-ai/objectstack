// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5301 — DevPlugin enforces ADR-0093 D5: a stack that REQUESTED the
// organization wall must not serve traffic without it.
//
// Before this, `objectstack serve` and `DevPlugin` gave OPPOSITE answers to one
// fact on one machine. Walled posture requested, enterprise
// `@objectstack/organizations` absent:
//
//   objectstack serve → refuses to boot (unless OS_ALLOW_DEGRADED_TENANCY=1)
//   DevPlugin         → one logger.warn, then boots and serves UNWALLED,
//                       with nobody having consented to the degradation
//
// D5 is a property of the DEPLOYMENT, not of one entrypoint, so the dev
// assembly path owes the same answer. #5262 made this MORE reachable, not less:
// before it, a dev stack setting only `OS_TENANCY_POSTURE` never entered the
// branch at all, so the warn-only path was dead code for the documented
// configuration. After it, that stack enters, fails to load, and took the
// fail-open path — which is what this file now forbids.
//
// ── What is observed, and why it is honest ──────────────────────────────────
// `@objectstack/organizations` is a cloud-private enterprise package genuinely
// absent from this workspace, so the dynamic import genuinely fails and the
// real stage-1 catch runs — no stubbing of the thing under test. That makes
// this file the faithful witness for the ABSENT-package half of #4818's split.
// The PRESENT-but-refusing half needs the package to resolve, so it lives in
// `dev-plugin-tenancy-mount-refusal.test.ts`, which mocks it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #3060 — same treatment as the sibling suites: init() dynamically imports ~10
// real workspace packages, whose vite transforms alone can blow the test
// timeout under a parallel `pnpm test`. Each factory throws the shape an absent
// package produces, so the graceful-degradation branches run for real with zero
// module resolution on the hot path. `@objectstack/organizations` is
// deliberately NOT listed: it is really absent, and its real failure is the
// signal this file reads.
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

import { DevPlugin } from './dev-plugin';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;
const OLD_NODE_ENV = process.env.NODE_ENV;
const OLD_DEGRADED = process.env.OS_ALLOW_DEGRADED_TENANCY;

const makeCtx = () => {
  const registered = new Map<string, unknown>();
  return {
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn((name: string) => {
      if (registered.has(name)) return registered.get(name);
      throw new Error('not found');
    }),
    getServices: vi.fn(() => new Map()),
    registerService: vi.fn((name: string, svc: unknown) => registered.set(name, svc)),
    hook: vi.fn(),
    trigger: vi.fn(),
    getKernel: vi.fn(),
  } as any;
};

/** Boot DevPlugin under a tenancy configuration; never swallows. */
const init = async (env: { posture?: string; legacy?: string; degraded?: string }) => {
  if (env.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = env.posture;
  if (env.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = env.legacy;
  if (env.degraded === undefined) delete process.env.OS_ALLOW_DEGRADED_TENANCY;
  else process.env.OS_ALLOW_DEGRADED_TENANCY = env.degraded;

  const ctx = makeCtx();
  await new DevPlugin({ seedAdminUser: false }).init(ctx);
  const lines = [
    ...ctx.logger.warn.mock.calls,
    ...ctx.logger.info.mock.calls,
    ...ctx.logger.error.mock.calls,
  ].map((c: unknown[]) => String(c[0]));
  return { ctx, lines };
};

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
  delete process.env.OS_ALLOW_DEGRADED_TENANCY;
  process.env.NODE_ENV = 'development';
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
  if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = OLD_NODE_ENV;
  if (OLD_DEGRADED === undefined) delete process.env.OS_ALLOW_DEGRADED_TENANCY;
  else process.env.OS_ALLOW_DEGRADED_TENANCY = OLD_DEGRADED;
  vi.restoreAllMocks();
});

describe('#5301 — stage 1 (package ABSENT): D5 fail-fast unless the operator opted in', () => {
  it('walled posture + absent enterprise package + no hatch → REFUSES to init', async () => {
    // THE regression. This exact configuration used to emit one warning and
    // boot on, serving traffic with the organization wall inactive.
    await expect(init({ posture: 'isolated' })).rejects.toThrow(/ADR-0093 D5/);
  });

  it('`group` is walled too — it refuses on the same terms as `isolated`', async () => {
    // `group` has no legacy-boolean spelling at all, so it is the posture most
    // likely to reach here by the documented configuration alone.
    await expect(init({ posture: 'group' })).rejects.toThrow(/ADR-0093 D5/);
  });

  it('the legacy boolean requests the wall too, and is refused the same way', async () => {
    await expect(init({ legacy: 'true' })).rejects.toThrow(/ADR-0093 D5/);
  });

  it('the refusal names the requested posture and every way out', async () => {
    // A refusal that does not say how to get past it just moves the operator's
    // problem from "no wall" to "no boot and no idea why".
    const err = await init({ posture: 'isolated' }).catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain("posture 'isolated'");
    expect(msg).toContain('@objectstack/organizations');
    expect(msg).toContain('OS_TENANCY_POSTURE=single');
    expect(msg).toContain('OS_ALLOW_DEGRADED_TENANCY=1');
    // The framework's own words about WHY, not just what: D5 is the authority.
    expect(msg).toContain('must not serve traffic without it');
  });

  it('throws rather than exiting the process — DevPlugin is a library', async () => {
    // The distinction #5301 turns on. serve.ts must `process.exit(1)` because
    // its guard sits inside a broad AuthPlugin `try` that swallows throws.
    // DevPlugin has no claim on the host process: embedders (tests, scripts, a
    // parent app) are entitled to catch this, and the boot chain does not
    // swallow it — `kernel.use()` only registers, `initPluginWithTimeout` does
    // not catch, `bootstrap()` rethrows. Consistent with the same file's
    // `assertNotProduction()`. That this assertion can run AT ALL is the proof:
    // a `process.exit(1)` would take the test runner down with it.
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit must not be called from a library plugin');
    }) as any);
    await expect(init({ posture: 'isolated' })).rejects.toThrow(/ADR-0093 D5/);
    expect(exit).not.toHaveBeenCalled();
  });

  it('with OS_ALLOW_DEGRADED_TENANCY=1 it boots degraded, and says so', async () => {
    // The hatch's whole meaning: "the capability is ABSENT and I accept the
    // degradation". Boot continues — but branded, never silent.
    const run = await init({ posture: 'isolated', degraded: '1' });
    const warning = run.lines.find((l) => l.includes('@objectstack/organizations'));
    expect(warning).toBeDefined();
    expect(warning).toContain('DEGRADED TENANCY');
    expect(warning).toContain("posture 'isolated'");
    // The line must stay honest about what is NOT being enforced.
    expect(warning).toContain('organization wall INACTIVE');
    expect(warning).toContain('ADR-0093 D5');
  });

  it('the hatch shares the OS_ALLOW_* family truthiness, exactly as serve.ts reads it', async () => {
    // `resolveAllowDegradedTenancy()` — the SAME resolver serve.ts calls, so the
    // two entrypoints can never drift on what "opted in" means. A hand-rolled
    // `=== '1'` here would have made `true`/`on`/`yes` work for serve and fail
    // for dev, on one machine, from one .env file.
    for (const truthy of ['1', 'true', 'on', 'yes', 'YES', ' True ']) {
      // Resolving AT ALL is the assertion: it means init() ran to completion
      // instead of refusing. (The helper resolves with its captured log lines.)
      await expect(init({ posture: 'isolated', degraded: truthy })).resolves.toBeTruthy();
    }
    for (const falsy of ['0', 'false', 'off', 'no', '']) {
      await expect(init({ posture: 'isolated', degraded: falsy })).rejects.toThrow(/ADR-0093 D5/);
    }
  });
});

describe('#5301 — unwalled postures are untouched', () => {
  it('single-org dev stacks never enter the branch, and never refuse', async () => {
    // The guard must not become a tax on the default configuration: a stack
    // that never asked for the wall is not degraded by not having one.
    for (const env of [{ posture: 'single' }, { legacy: 'false' }, {}]) {
      const run = await init(env);
      expect(run.lines.some((l) => l.includes('@objectstack/organizations'))).toBe(false);
      expect(run.lines.some((l) => l.includes('ADR-0093 D5'))).toBe(false);
    }
  });

  it('a single posture does not need the hatch to boot', async () => {
    await expect(init({ posture: 'single' })).resolves.toBeTruthy();
  });
});
