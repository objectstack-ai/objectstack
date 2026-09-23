// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5262 — DevPlugin decides whether to load the multi-org runtime
// from the AUTHORITATIVE tenancy posture, never the demoted
// `OS_MULTI_ORG_ENABLED` boolean.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// DevPlugin kept calling `resolveMultiOrgEnabled()`, so a dev stack configured
// the documented way (posture knob only) never even ATTEMPTED to load
// `@objectstack/organizations`. SecurityPlugin then probed an absent
// `org-scoping` service, stripped the wildcard `tenant_isolation` RLS, and the
// stack served traffic with no organization wall at all — while the `tenancy`
// service reported the wall as requested. Straight into the ADR-0093 D5
// degraded state, with no D5 fail-fast on this path to catch it. Third
// recurrence of the shape (cloud#1020, #5233).
//
// The judge is the REQUESTED posture, matching `serve.ts`'s own wiring exactly.
// It has to be: this branch is what MOUNTS the wall, so asking the `tenancy`
// service "is the wall up?" would be circular.
//
// ── What is observed, and why it is honest ──────────────────────────────────
// The assertions key on branch ENTRY, read off the warning the absent-package
// path emits: under the bug there is no warning at all, because the `if` was
// never taken. They deliberately do NOT key on a successfully mounted plugin —
// that is unobservable in open-source CI, and pretending otherwise would need a
// fake enterprise package, i.e. stubbing the very thing under test.
//
// `@objectstack/organizations` is SIMULATED absent here, by the same throwing
// factory the twelve packages below get. That is a change: this file used to let
// the REAL dynamic import fail, which it does — ADR-0132's entitlement boundary
// forbids any framework package declaring the name
// (`no-framework-dependents.pin.test.ts`), so it is genuinely unresolvable from
// `plugin-dev`. What the real failure bought was honesty about the ABSENCE.
// What it cost was a real, uncached module resolution inside the CLOCKED WINDOW
// of five of the six cases below — and the absence is not this file's subject.
// Its subject is WHICH KNOB decides branch entry.
//
// Measured on this tree, three readings, because the first guess was wrong:
//   • the failing resolution is NOT cached — 200 consecutive attempts from this
//     file's own runner, p50 1.157ms, max 8.037ms, none of them free;
//   • it is NOT served by the vitest main process, so it is not the transform
//     queue the `#3060` note below names: with that process blocked by ~45s of
//     real transforms these cases still ran in 2–12ms. The cost is the WORKER's
//     own resolver walking `node_modules` and raising ERR_MODULE_NOT_FOUND;
//   • that walk has a load-sensitive tail — the same 200 attempts under
//     filesystem contention keep p50 at 0.839ms but take max from 8.0ms to
//     28.2ms.
//
// So each walled case drew from an unbounded, machine-load-dependent
// distribution, and a 5000ms per-test budget bounded the DRAW rather than any
// work this file is about. Under a parallel shard it timed out on a case that
// asserts a back-compat env-var reading. Scaled repro, same command before and
// after, timeout scaled down instead of load scaled up: with the per-test budget
// at 25ms under filesystem contention, 10 runs of this file failed 6 times
// before this change and 0 times after — and every one of those 10 timeouts
// landed on a WALLED case, never on the single-org case, which runs three
// `init()`s and resolves nothing. That control is what names the construct.
//
// ⛔ Nothing about the absence is given up by the SUITE, only by this file: the
// real, unmocked resolution failure is still the signal in
// `dev-plugin-tenancy-failfast.test.ts`, whose subject IS the absent-package
// path, and the boundary that makes the package absent is pinned mechanically
// by `no-framework-dependents.pin.test.ts`. A mock that stopped matching
// reality would therefore redden there, not go unnoticed here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #3060 — the same treatment the sibling suites use: init() dynamically imports
// ~10 real workspace packages, whose vite transforms alone can blow the test
// timeout under a parallel `pnpm test`. Each factory throws the shape an absent
// package produces, so the graceful-degradation branches run for real with zero
// module resolution on the hot path.
//
// `@objectstack/organizations` is listed HERE TOO, and the header above is the
// argument for why it may be: keeping it off this list left one real resolution
// per walled case in the clocked window, which is the only thing in that window
// whose cost is a function of what else the machine is doing. "Zero module
// resolution on the hot path" is what this block has always claimed; now it is
// true.
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
vi.mock('@objectstack/organizations', () => { throw Object.assign(new Error("Cannot find package '@objectstack/organizations'"), { code: 'ERR_MODULE_NOT_FOUND' }); });

import { DevPlugin } from './dev-plugin';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;
const OLD_NODE_ENV = process.env.NODE_ENV;
const OLD_DEGRADED = process.env.OS_ALLOW_DEGRADED_TENANCY;

/** Boot DevPlugin under a tenancy configuration and report what it tried. */
const initUnder = async (env: { posture?: string; legacy?: string }) => {
  if (env.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = env.posture;
  if (env.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = env.legacy;

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

  const lines = [
    ...ctx.logger.warn.mock.calls,
    ...ctx.logger.info.mock.calls,
  ].map((c: unknown[]) => String(c[0]));

  return {
    /** Did the multi-org branch run at all? */
    attemptedOrganizationsLoad: lines.some((l) => l.includes('@objectstack/organizations')),
    lines,
  };
};

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
  process.env.NODE_ENV = 'development';
  // [#5301] This suite observes BRANCH ENTRY, and it reads that entry off the
  // warning the absent-package path emits. Since #5301 that path is ADR-0093 D5
  // fail-fast: a walled posture with the enterprise package absent REFUSES to
  // init unless the operator opted in, so without this hatch every walled case
  // below would throw before it could be observed. The hatch does not weaken
  // what is under test here — the degraded path still names the requested
  // posture in the same line, which is the whole signal #5262 pinned. The
  // fail-fast itself is pinned next door, in `dev-plugin-tenancy-failfast.test.ts`.
  process.env.OS_ALLOW_DEGRADED_TENANCY = '1';
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

describe('#5262 — DevPlugin loads the multi-org runtime from OS_TENANCY_POSTURE', () => {
  it('posture-only dev stack (OS_TENANCY_POSTURE=isolated, legacy boolean UNSET) tries to load it', async () => {
    // THE regression. Before the fix `resolveMultiOrgEnabled()` read false, the
    // branch was skipped entirely, and this stack ran with no organization wall
    // while believing it had asked for one.
    const run = await initUnder({ posture: 'isolated' });
    expect(run.attemptedOrganizationsLoad).toBe(true);
  });

  it('`group` requests the runtime too — gating on the legacy boolean let it skip', async () => {
    // Worth its own case: `OS_TENANCY_POSTURE=group` has NO legacy-boolean
    // spelling at all, so under the bug a group deployment could never load the
    // package by any configuration — it silently degraded to unwalled
    // single-org, the exact ADR-0049 class the D5 guard exists to close.
    const run = await initUnder({ posture: 'group' });
    expect(run.attemptedOrganizationsLoad).toBe(true);
  });

  it('names the POSTURE that was requested, not one knob’s spelling of it', async () => {
    // The old text asserted `OS_MULTI_ORG_ENABLED=true` at an operator who may
    // well have set only `OS_TENANCY_POSTURE` — sending them to check a
    // variable they never set. A diagnostic that misreports the operator's own
    // configuration costs every later investigation a lap (cf. cloud#1020's
    // banner).
    const run = await initUnder({ posture: 'group' });
    const warning = run.lines.find((l) => l.includes('@objectstack/organizations'));
    expect(warning).toContain("posture 'group'");
    expect(warning).not.toContain('OS_MULTI_ORG_ENABLED=true');
  });

  it('legacy-boolean-only dev stack keeps working — back-compat via the posture resolver', async () => {
    const run = await initUnder({ legacy: 'true' });
    expect(run.attemptedOrganizationsLoad).toBe(true);
  });

  it('single-org dev stacks still skip the enterprise runtime entirely', async () => {
    // Intent unchanged — only the knob is corrected.
    expect((await initUnder({ posture: 'single' })).attemptedOrganizationsLoad).toBe(false);
    expect((await initUnder({ legacy: 'false' })).attemptedOrganizationsLoad).toBe(false);
    expect((await initUnder({})).attemptedOrganizationsLoad).toBe(false);
  });

  it('an explicit legacy `false` does not veto the authoritative posture', async () => {
    const run = await initUnder({ posture: 'isolated', legacy: 'false' });
    expect(run.attemptedOrganizationsLoad).toBe(true);
  });
});
