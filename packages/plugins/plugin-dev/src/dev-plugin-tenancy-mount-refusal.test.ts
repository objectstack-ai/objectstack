// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5301 / #4818 — stage 2: the enterprise package IS present and the plugin
// ITSELF declined. Two failures, two diagnoses, and only ONE of them is
// covered by the escape hatch.
//
// `OS_ALLOW_DEGRADED_TENANCY` means exactly "the multi-org capability is ABSENT
// and I accept doing without it". It has never meant "override whatever gate
// the plugin is enforcing" — a licence check, a schema precondition, a refusal
// to run against this datasource. Letting the hatch past a PRESENT plugin's
// refusal would move that gate onto an env var, which is why serve.ts exits
// unconditionally here (#4818) and why DevPlugin now throws unconditionally.
//
// The classifier is WHICH STAGE THREW — deliberately not the error's shape.
// The framework must not encode any of the plugin's private refusal semantics
// (a layering violation needing an update per refusal reason), and CLI and
// plugin may hold different module instances, so `instanceof` and named `code`
// checks are both fragile. Stage is the only classifier that needs to know
// nothing about the plugin's internals.
//
// ── Why this file mocks what its sibling refuses to mock ────────────────────
// `dev-plugin-tenancy-failfast.test.ts` reads the ABSENT-package path off the
// genuinely-absent cloud-private package, stubbing nothing. That is impossible
// here by construction: "the package is present and refused" cannot be observed
// without a present package. The mock therefore supplies only the thing the
// open-source workspace cannot have — a resolvable `@objectstack/organizations`
// — and the refusal semantics under test stay entirely in dev-plugin.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** How the fake enterprise plugin should misbehave for the current test. */
const orgBehaviour = vi.hoisted(() => ({ mode: 'healthy' as 'healthy' | 'construct-throws' | 'init-throws' }));

vi.mock('@objectstack/organizations', () => ({
  OrganizationsPlugin: class {
    name = 'com.objectstack.plugin.organizations';
    version = '1.0.0';
    constructor() {
      if (orgBehaviour.mode === 'construct-throws') {
        throw Object.assign(new Error('ORG_LICENCE_INVALID: seat count exceeded'), { code: 'ORG_LICENCE_INVALID' });
      }
    }
    async init() {
      if (orgBehaviour.mode === 'init-throws') {
        throw Object.assign(new Error('ORG_SCHEMA_PRECONDITION: organization_id column missing'), { code: 'ORG_SCHEMA_PRECONDITION' });
      }
    }
  },
}));

// #3060 — as in the sibling suites: keep ~10 real workspace packages off the
// hot path so vite transforms cannot blow the timeout under a parallel run.
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
const OLD_NODE_ENV = process.env.NODE_ENV;
const OLD_DEGRADED = process.env.OS_ALLOW_DEGRADED_TENANCY;

const init = async (degraded?: string) => {
  process.env.OS_TENANCY_POSTURE = 'isolated';
  if (degraded === undefined) delete process.env.OS_ALLOW_DEGRADED_TENANCY;
  else process.env.OS_ALLOW_DEGRADED_TENANCY = degraded;

  const registered = new Map<string, unknown>();
  const ctx: any = {
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
  };
  await new DevPlugin({ seedAdminUser: false }).init(ctx);
  return ctx;
};

beforeEach(() => {
  orgBehaviour.mode = 'healthy';
  delete process.env.OS_MULTI_ORG_ENABLED;
  delete process.env.OS_ALLOW_DEGRADED_TENANCY;
  process.env.NODE_ENV = 'development';
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = OLD_NODE_ENV;
  if (OLD_DEGRADED === undefined) delete process.env.OS_ALLOW_DEGRADED_TENANCY;
  else process.env.OS_ALLOW_DEGRADED_TENANCY = OLD_DEGRADED;
  vi.restoreAllMocks();
});

describe('#5301 — positive control: a present, healthy enterprise runtime boots', () => {
  it('mounts the wall and reports it, with no hatch and no refusal', async () => {
    // Without this case the whole file could pass on "any walled posture
    // throws" — the assertions below would then be pinning nothing.
    const ctx = await init();
    const lines = ctx.logger.info.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines.some((l: string) => l.includes('Organizations plugin enabled'))).toBe(true);
    const warns = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warns.some((l: string) => l.includes('ADR-0093 D5'))).toBe(false);
  });
});

describe('#5301 — stage 2a: the plugin refuses to CONSTRUCT', () => {
  it('refuses to init, and does NOT call it a missing package', async () => {
    orgBehaviour.mode = 'construct-throws';
    const err = await init().catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain('ADR-0093 D5');
    // The #4818 diagnosis: sending an operator to check their install when the
    // package is installed and the plugin objected costs a whole lap.
    expect(msg).toContain('WAS found and loaded');
    expect(msg).toContain('NOT a missing-package problem');
    // The plugin's own words are the authority; the framework does not guess.
    expect(msg).toContain('ORG_LICENCE_INVALID: seat count exceeded');
    expect(msg).toContain('code: ORG_LICENCE_INVALID');
  });

  it('the hatch does NOT get past it (#4818)', async () => {
    // The load-bearing half of the two-stage split. Under one shared `try` this
    // refusal was indistinguishable from an absent package, so
    // OS_ALLOW_DEGRADED_TENANCY swallowed it — i.e. an env var silently
    // overrode whatever gate the enterprise plugin was enforcing.
    orgBehaviour.mode = 'construct-throws';
    for (const hatch of ['1', 'true', 'yes']) {
      const err = await init(hatch).catch((e: Error) => e);
      expect((err as Error).message).toContain('ADR-0093 D5');
      expect((err as Error).message).toContain('OS_ALLOW_DEGRADED_TENANCY does NOT apply');
    }
  });
});

describe('#5301 — stage 2b: the plugin constructs, then refuses to INITIALIZE', () => {
  it('refuses to init instead of logging the refusal and booting unwalled', async () => {
    // Where DevPlugin structurally differs from serve.ts, and the reason
    // mirroring only the construct stage would have left this file's own hole
    // open. serve.ts hands the plugin to `kernel.use()`, whose Phase-1 loop
    // RETHROWS an init failure — so serve needs no special line for this.
    // DevPlugin inits its children itself, in a deliberately best-effort loop
    // that logs and continues (a dev stack should survive an absent service).
    // For THIS child that best-effort default is the D5 fail-open all over
    // again: the wall the operator asked for is inactive, and the process
    // serves traffic anyway.
    orgBehaviour.mode = 'init-throws';
    const err = await init().catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain('ADR-0093 D5');
    expect(msg).toContain('failed to initialize');
    expect(msg).toContain('ORG_SCHEMA_PRECONDITION: organization_id column missing');
  });

  it('the hatch does NOT get past it either — same fact, same stage', async () => {
    orgBehaviour.mode = 'init-throws';
    for (const hatch of ['1', 'true']) {
      const err = await init(hatch).catch((e: Error) => e);
      expect((err as Error).message).toContain('OS_ALLOW_DEGRADED_TENANCY does NOT apply');
    }
  });

  it('keeps the best-effort loop best-effort for every OTHER child plugin', async () => {
    // Scope guard, and the thing most at risk of being broken by the line
    // above: exactly one child plugin is exempt from the loop's tolerance. A
    // dev stack must still survive any other child failing to init — that
    // tolerance is what makes `new DevPlugin()` work with packages missing.
    orgBehaviour.mode = 'healthy';
    const failing = {
      name: 'com.example.broken',
      version: '1.0.0',
      init: async () => { throw new Error('BROKEN_CHILD'); },
    } as any;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const ctx: any = {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getService: vi.fn(() => { throw new Error('not found'); }),
      getServices: vi.fn(() => new Map()),
      registerService: vi.fn(),
      hook: vi.fn(),
      trigger: vi.fn(),
      getKernel: vi.fn(),
    };
    await expect(
      new DevPlugin({ seedAdminUser: false, extraPlugins: [failing] }).init(ctx),
    ).resolves.toBeUndefined();
    const errors = ctx.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(errors.some((l: string) => l.includes('com.example.broken') && l.includes('BROKEN_CHILD'))).toBe(true);
  });
});
