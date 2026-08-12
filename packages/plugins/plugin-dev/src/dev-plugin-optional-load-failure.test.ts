// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7926 — ABSENT vs. PRESENT-BUT-FAILED, at every optional-service load.
//
// Every load in `DevPlugin.init()` used to end in a bare `catch {}` whose only
// act was to warn that the package was "not installed". A package that IS
// installed and threw while loading or constructing was therefore reported as
// an absent one, and the operator went off to install something they already
// had. The measured instance (#6915 / PR #7924): `InMemoryDriver`'s constructor
// refuses a non-`single` tenancy posture with a message naming the detected
// posture, both env knobs and the `@objectstack/driver-sql` remedy — and an
// operator saw `✘ @objectstack/runtime or @objectstack/driver-memory not
// installed — skipping driver` instead. Not one word of the refusal survived.
//
// ── What this file mocks, and why it must ──────────────────────────────────
// "The package is present and it threw" cannot be observed without a present
// package that throws, so the mocks supply exactly that and nothing else: the
// classification under test stays entirely in dev-plugin.ts. The same reasoning
// dev-plugin-tenancy-mount-refusal.test.ts records for its own mock.
//
// The ABSENT arm is pinned in dev-plugin.test.ts (`service-storage not
// installed` / `service-realtime not installed`) and is deliberately NOT
// repurposed here — those assertions are correct for a genuinely absent package
// and must keep passing untouched. This file adds the second outcome; the pair
// is what makes the distinction real. One absent-arm case is re-pinned below
// alongside its failed-arm twin, because "these two inputs produce two
// different diagnoses" is the claim, and a claim about a distinction cannot be
// tested from one side.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevPlugin } from './dev-plugin';

/** How the mocked packages should misbehave for the current test. */
const behaviour = vi.hoisted(() => ({
  /** `driver-memory` resolves; its constructor throws (the #6915 shape). */
  driverConstructorThrows: true,
  /** The constructor's refusal carries a module-not-found error as its cause. */
  driverErrorWrapsModuleNotFound: false,
  /** `service-storage` resolves; its module body throws at evaluation time. */
  storageModuleThrows: true,
}));

/** The shape Node's loader raises for a genuinely absent package. */
const absent = (pkg: string) =>
  Object.assign(new Error(`Cannot find package '${pkg}' imported from /app/dev-plugin.js`), {
    code: 'ERR_MODULE_NOT_FOUND',
  });

// Present, and healthy enough to be constructed — the driver mock is what
// fails, so `DriverPlugin` must exist for the failure to be attributable.
vi.mock('@objectstack/runtime', () => ({
  DriverPlugin: class {
    name = 'com.objectstack.plugin.driver';
    version = '1.0.0';
    constructor(_driver: unknown, _name: string) {}
    async init() {}
  },
  AppPlugin: class {
    name = 'com.objectstack.plugin.app';
    version = '1.0.0';
    async init() {}
  },
  createDispatcherPlugin: () => ({
    name: 'com.objectstack.plugin.dispatcher',
    version: '1.0.0',
    init: async () => {},
  }),
}));

// PRESENT. Its constructor refuses, exactly as InMemoryDriver's tenancy guard
// does under a walled posture (#6915 — `memory-tenancy-guard.ts`).
vi.mock('@objectstack/driver-memory', () => ({
  InMemoryDriver: class {
    constructor(_opts: unknown) {
      if (!behaviour.driverConstructorThrows) return;
      throw Object.assign(
        new Error(
          "InMemoryDriver refuses to start under tenancy posture 'isolated': it has no "
          + 'organization scoping. Set OS_TENANCY_POSTURE=single, or use @objectstack/driver-sql '
          + "with connection: { filename: ':memory:' }.",
        ),
        {
          code: 'MEMORY_MULTI_TENANT_UNSUPPORTED',
          cause: behaviour.driverErrorWrapsModuleNotFound
            ? Object.assign(new Error("Cannot find package 'some-lazy-optional-peer'"), {
              code: 'ERR_MODULE_NOT_FOUND',
            })
            : undefined,
        },
      );
    }
  },
}));

// PRESENT, and throws while its module body is evaluated — the other flavour of
// "installed but failed": no constructor is ever reached.
vi.mock('@objectstack/service-storage', () => {
  if (behaviour.storageModuleThrows) {
    throw Object.assign(new Error('STORAGE_ADAPTER_MISCONFIGURED: OS_STORAGE_ROOT is not writable'), {
      code: 'STORAGE_ADAPTER_MISCONFIGURED',
    });
  }
  return { StorageServicePlugin: class { name = 'storage'; version = '1.0.0'; } };
});

// Everything else: genuinely absent, so the run stays fast and the two arms are
// exercised side by side in one boot (#3060's reason for mocking at all).
vi.mock('@objectstack/objectql', () => { throw absent('@objectstack/objectql'); });
vi.mock('@objectstack/service-i18n', () => { throw absent('@objectstack/service-i18n'); });
vi.mock('@objectstack/service-realtime', () => { throw absent('@objectstack/service-realtime'); });
vi.mock('@objectstack/plugin-auth', () => { throw absent('@objectstack/plugin-auth'); });
vi.mock('@objectstack/plugin-security', () => { throw absent('@objectstack/plugin-security'); });
vi.mock('@objectstack/plugin-hono-server', () => { throw absent('@objectstack/plugin-hono-server'); });
vi.mock('@objectstack/rest', () => { throw absent('@objectstack/rest'); });
vi.mock('@objectstack/setup', () => { throw absent('@objectstack/setup'); });
vi.mock('@objectstack/account', () => { throw absent('@objectstack/account'); });

function mockCtx() {
  const ctx: any = {
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn(() => { throw new Error('not found'); }),
    getServices: vi.fn(() => new Map()),
    registerService: vi.fn(),
    hook: vi.fn(),
    trigger: vi.fn(),
    getKernel: vi.fn(),
  };
  return ctx;
}

/** Every line the boot logged, at any level, in one flat list. */
const allLines = (ctx: any): string[] =>
  [
    ...ctx.logger.warn.mock.calls,
    ...ctx.logger.info.mock.calls,
    ...ctx.logger.debug.mock.calls,
    ...ctx.logger.error.mock.calls,
  ].map((call: unknown[]) => String(call[0]));

const errorLines = (ctx: any): string[] =>
  ctx.logger.error.mock.calls.map((call: unknown[]) => String(call[0]));

const OLD_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  behaviour.driverConstructorThrows = true;
  behaviour.driverErrorWrapsModuleNotFound = false;
  behaviour.storageModuleThrows = true;
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = OLD_NODE_ENV;
  vi.restoreAllMocks();
});

describe('DevPlugin — an optional service that is installed and fails to construct (#7926)', () => {
  it('does NOT report the driver as "not installed" when its constructor throws', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const driverLines = allLines(ctx).filter((l) => l.includes('driver-memory'));
    expect(driverLines.length, 'the driver failure is reported exactly once').toBe(1);

    // The defect, stated as an assertion: this line used to be the absent-package
    // one. An operator reading it must not be sent to install a package they have.
    expect(driverLines[0]).not.toContain('not installed');
    expect(driverLines[0]).toContain('installed but failed to initialize');
    expect(driverLines[0]).toContain('NOT a missing-package problem');
  });

  it('surfaces the underlying error — both its code and its message — verbatim', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const line = errorLines(ctx).find((l) => l.includes('driver-memory'));
    expect(line, 'a present-but-failed load is reported at error level').toBeDefined();
    expect(line).toContain('code: MEMORY_MULTI_TENANT_UNSUPPORTED');
    // Every actionable fact the refusal carried reaches the operator: the
    // posture it detected, the knob that produces it, and the remedy.
    expect(line).toContain("tenancy posture 'isolated'");
    expect(line).toContain('OS_TENANCY_POSTURE=single');
    expect(line).toContain('@objectstack/driver-sql');
    // …and it is named as the package's own words, not the framework's reading.
    expect(line).toContain('verbatim — the framework does not interpret it');
  });

  it('names both packages the load needed, and what the stack does without it', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const line = errorLines(ctx).find((l) => l.includes('driver-memory'))!;
    expect(line).toContain('@objectstack/runtime, @objectstack/driver-memory ARE installed');
    expect(line).toContain('skipping driver');
  });

  it('classifies a module body that throws at evaluation time the same way', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const line = errorLines(ctx).find((l) => l.includes('service-storage'));
    expect(line, 'an evaluation-time throw is a present-but-failed load too').toBeDefined();
    expect(line).not.toContain('not installed');
    expect(line).toContain('code: STORAGE_ADAPTER_MISCONFIGURED');
    expect(line).toContain('OS_STORAGE_ROOT is not writable');
    expect(line).toContain('the file-storage slot stays empty');
  });

  it('leaves the slot empty and still boots — this card changes the diagnosis, not the outcome', async () => {
    const ctx = mockCtx();
    await expect(new DevPlugin({ seedAdminUser: false }).init(ctx)).resolves.toBeUndefined();
    expect(ctx.registerService).not.toHaveBeenCalled();
  });

  // The other half of the distinction. A genuinely absent package keeps today's
  // wording and today's advice — that is what dev-plugin.test.ts pins — and now
  // also carries the resolver's own message, so a transitive missing dependency
  // (same `ERR_MODULE_NOT_FOUND`, different specifier) names itself instead of
  // hiding behind the package we asked for.
  //
  // This case also pins the wrapper the chain walk exists for: `@vitest/mocker`
  // hands a factory's throw back inside its own uncoded `Error`, with the real
  // one on `cause` (`createHelpfulError`). Reading only the outer error would
  // classify every mocked-absent package in this repo as present-but-failed.
  it('still says "not installed" for a genuinely absent package, and says which specifier failed', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const line = allLines(ctx).find((l) => l.includes('service-realtime'));
    expect(line).toContain('@objectstack/service-realtime not installed');
    expect(line).toContain('the realtime slot stays empty');
    expect(line).toContain('ERR_MODULE_NOT_FOUND');
    expect(line).toContain("Cannot find package '@objectstack/service-realtime'");
    // An absent optional package is a normal dev-stack state: it must NOT be
    // promoted to the error level the present-but-failed arm uses.
    expect(errorLines(ctx).some((l) => l.includes('service-realtime'))).toBe(false);
  });

  // The tie-break rule, pinned: the OUTERMOST error carrying a `code` decides.
  // A refusal is authoritative about itself, so a constructor that failed while
  // reaching for a lazy optional peer is still a construction failure — not a
  // missing `@objectstack/driver-memory`. The chain walk exists because a
  // wrapper without a code of its own must stay transparent (`@vitest/mocker`
  // wraps every factory throw exactly that way); it must not turn any nested
  // resolution error into a verdict about the package we asked for.
  it('does not re-read a typed refusal as "not installed" because its cause is a module-not-found', async () => {
    behaviour.driverErrorWrapsModuleNotFound = true;
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const line = errorLines(ctx).find((l) => l.includes('driver-memory'));
    expect(line, 'the outermost code decides — this is still a construction failure').toBeDefined();
    expect(line).not.toContain('not installed');
    expect(line).toContain('code: MEMORY_MULTI_TENANT_UNSUPPORTED');
    // …and the nested cause is still printed, because neither arm swallows it.
    expect(line).toContain('caused by');
    expect(line).toContain("Cannot find package 'some-lazy-optional-peer'");
  });

  // Both arms in one boot, from one code path — the distinction is live, not a
  // property of which test file ran.
  it('reports absent and present-but-failed differently in the same boot', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const realtime = allLines(ctx).find((l) => l.includes('service-realtime'))!;
    const storage = allLines(ctx).find((l) => l.includes('service-storage'))!;
    expect(realtime).toContain('not installed');
    expect(storage).not.toContain('not installed');
  });

  // #3963's refusal used to travel through the same load `catch` and come out as
  // `ℹ @objectstack/rest not installed` — the one instance of this defect the
  // file produced against its own words rather than a package's.
  it('does not blame @objectstack/rest when it is DevPlugin that refuses the data API', async () => {
    const ctx = mockCtx();
    await new DevPlugin({ seedAdminUser: false }).init(ctx);

    const line = allLines(ctx).find((l) => l.includes('REST API NOT enabled'));
    expect(line, 'the no-auth refusal is reported on its own terms').toBeDefined();
    expect(line).toContain('no auth is mounted');
    expect(line).toContain('#3963');
    expect(line).toContain('NOT a missing-package problem');
    // And the false claim it used to emit instead is gone.
    expect(allLines(ctx).some((l) => l.includes('@objectstack/rest not installed'))).toBe(false);
  });
});
