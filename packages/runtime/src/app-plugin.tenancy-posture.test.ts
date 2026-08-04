// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5262 — AppPlugin's two seeder decisions ask whether an organization wall is
// IN FORCE, never the demoted `OS_MULTI_ORG_ENABLED` boolean.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// Both seeder sites kept calling `resolveMultiOrgEnabled()`, so a deployment
// configured the documented way (posture knob only) took the SINGLE-TENANT
// branch on a fully walled stack and inline-seeded exactly the NULL-organization
// rows the code's own comment exists to avoid — rows that then sit behind the
// wall, unreadable, needing a separate claim step. Third recurrence of the
// shape (cloud#1020, #5233).
//
// The judge here is the EFFECTIVE posture (the `tenancy` service), not the
// requested one, and the degraded scenario below is why. What these decisions
// actually turn on is "will the per-org replay run INSTEAD of me?" — and that
// replay is enterprise `@objectstack/organizations` middleware. On a degraded
// boot it does not exist, so keying on the REQUEST would defer to a replay that
// can never happen and leave the stack with no seed data at all. That case is
// pinned explicitly, because it is the one a requested-posture fix would get
// wrong while still passing every other assertion in this file.
//
// Driven through the real `AppPlugin.start()` with a real `tenancy` service
// object of the same shape plugin-auth registers, and real env vars folded by
// the real resolver.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
import type { PluginContext } from '@objectstack/core';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;
const OLD_NODE_ENV = process.env.NODE_ENV;

interface Scenario {
  /** `OS_TENANCY_POSTURE`, or `undefined` to leave it UNSET. */
  posture?: string;
  /** `OS_MULTI_ORG_ENABLED`, or `undefined` to leave it UNSET. */
  legacy?: string;
  /**
   * The `tenancy` service's EFFECTIVE posture, as plugin-auth would register
   * it, or `undefined` for a lean embedding with no such service (AppPlugin
   * mounted without plugin-auth) — which is what exercises the fallback.
   */
  effectivePosture?: 'single' | 'group' | 'isolated';
}

/**
 * Boot AppPlugin under a scenario and report what the seeder did.
 *
 * No `metadata` service, so the seed takes the basic-insert fallback — the
 * settle plumbing is identical on both branches and `ql.insert` is the cleanest
 * witness for "did inline seeding actually happen".
 */
const runSeeder = async (scenario: Scenario) => {
  if (scenario.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = scenario.posture;
  if (scenario.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = scenario.legacy;

  const insert = vi.fn(async () => ({ id: 'x' }));
  const hooks = new Map<string, unknown>();
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

  const ctx = {
    logger,
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'objectql') return { insert };
      if (name === 'tenancy' && scenario.effectivePosture) {
        // The shape plugin-auth registers (createTenancyService). Only
        // `posture` — the posture IN FORCE — is consulted by AppPlugin.
        return { posture: scenario.effectivePosture };
      }
      // `metadata` absent → basic-insert fallback; everything else absent too.
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn((event: string, handler: unknown) => hooks.set(event, handler)),
    trigger: vi.fn(),
  } as unknown as PluginContext;

  const plugin = new AppPlugin({
    id: 'posture-seed-app',
    data: [{ object: 'crm_lead', records: [{ id: 'seeded_1' }] }],
  });
  await plugin.start(ctx);

  return {
    /** Did the INLINE seed run? (site 3) */
    inlineSeeded: insert.mock.calls.length > 0,
    /** Was the hot-reload seeder installed? (site 4) */
    hotReloadSeederRegistered: hooks.has('metadata:reloaded'),
    logger,
  };
};

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
  // Site 4 is dev-only; NODE_ENV=development is a precondition for it to be
  // reachable at all, so the posture is the only variable under test.
  process.env.NODE_ENV = 'development';
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
  if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = OLD_NODE_ENV;
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5262 — inline seed (site 3) defers to per-org replay on a walled deployment', () => {
  it('posture-only deployment with a wall in force skips the inline seed', async () => {
    // THE regression, with a real `tenancy` service as a kernel boot has.
    // Before the fix `resolveMultiOrgEnabled()` read false and this stack
    // inline-seeded NULL-org rows behind its own wall.
    const run = await runSeeder({ posture: 'isolated', effectivePosture: 'isolated' });

    expect(run.inlineSeeded).toBe(false);
    expect(
      run.logger.info.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes('skipping inline seed'),
      ),
    ).toBe(true);
  });

  it('posture-only deployment with NO tenancy service falls back to the requested posture', async () => {
    // A lean embedding that mounts AppPlugin without plugin-auth. The fallback
    // must still read the POSTURE, not the demoted boolean — otherwise the
    // defect simply relocates into the fallback.
    expect((await runSeeder({ posture: 'isolated' })).inlineSeeded).toBe(false);
    expect((await runSeeder({ posture: 'group' })).inlineSeeded).toBe(false);
  });

  it('`group` is a walled posture too — not just `isolated`', async () => {
    const run = await runSeeder({ posture: 'group', effectivePosture: 'group' });
    expect(run.inlineSeeded).toBe(false);
  });

  it('DEGRADED boot seeds INLINE — the effective posture is what makes this right', async () => {
    // ADR-0093 D5: a wall was REQUESTED, the enterprise runtime is absent, and
    // the operator opted in via OS_ALLOW_DEGRADED_TENANCY. The `tenancy`
    // service reports the posture in force — `single` — because nothing
    // isolates this deployment's data.
    //
    // There is no per-org replay here to defer to, so deferring would strand
    // the app with NO seed data whatsoever. Reading the EFFECTIVE posture hands
    // the work back to the inline path, and the rows land NULL-org, which is
    // exactly what every row on an unwalled stack looks like.
    //
    // This is the assertion that separates a correct fix from a
    // requested-posture fix: the latter passes everything else in this file and
    // fails here.
    const run = await runSeeder({ posture: 'isolated', effectivePosture: 'single' });

    expect(run.inlineSeeded).toBe(true);
  });

  it('legacy-boolean-only deployment keeps working — back-compat via the posture resolver', async () => {
    expect((await runSeeder({ legacy: 'true' })).inlineSeeded).toBe(false);
  });

  it('single-org deployments still seed inline', async () => {
    expect((await runSeeder({ posture: 'single', effectivePosture: 'single' })).inlineSeeded).toBe(true);
    expect((await runSeeder({ legacy: 'false' })).inlineSeeded).toBe(true);
    expect((await runSeeder({})).inlineSeeded).toBe(true);
  });

  it('an explicit legacy `false` does not veto the authoritative posture', async () => {
    expect((await runSeeder({ posture: 'isolated', legacy: 'false' })).inlineSeeded).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5262 — hot-reload seeder (site 4) is not installed on a walled deployment', () => {
  it('posture-only walled deployment does NOT register the hot-reload seeder', async () => {
    // Before the fix this seeder WAS installed on a walled posture-only dev
    // stack, and every row it wrote for a newly hot-reloaded object landed with
    // a NULL organization.
    const run = await runSeeder({ posture: 'isolated', effectivePosture: 'isolated' });
    expect(run.hotReloadSeederRegistered).toBe(false);
  });

  it('falls back to the requested posture with no tenancy service wired', async () => {
    expect((await runSeeder({ posture: 'group' })).hotReloadSeederRegistered).toBe(false);
  });

  it('DEGRADED boot DOES register it — same reasoning as the inline seed', async () => {
    const run = await runSeeder({ posture: 'isolated', effectivePosture: 'single' });
    expect(run.hotReloadSeederRegistered).toBe(true);
  });

  it('single-org dev stacks still get the hot-reload seeder', async () => {
    expect((await runSeeder({})).hotReloadSeederRegistered).toBe(true);
    expect((await runSeeder({ legacy: 'false' })).hotReloadSeederRegistered).toBe(true);
  });

  it('legacy-boolean-only deployment keeps working — back-compat', async () => {
    expect((await runSeeder({ legacy: 'true' })).hotReloadSeederRegistered).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#5262 — the two seeder sites can never disagree', () => {
  // They are two halves of one policy: "on a walled deployment the per-org
  // replay owns seeding". A change that fixes one and forgets the other leaves
  // a dev stack that skips the boot seed and then hot-reload-seeds NULL-org
  // rows anyway — strictly worse than either mistake alone. Nothing compared
  // them before, which is a large part of why #5262 sat unnoticed.
  const scenarios: Array<{ name: string; scenario: Scenario; walled: boolean }> = [
    { name: 'posture=isolated, wall in force', scenario: { posture: 'isolated', effectivePosture: 'isolated' }, walled: true },
    { name: 'posture=group, wall in force', scenario: { posture: 'group', effectivePosture: 'group' }, walled: true },
    { name: 'posture=isolated, no tenancy service', scenario: { posture: 'isolated' }, walled: true },
    { name: 'posture=isolated, DEGRADED', scenario: { posture: 'isolated', effectivePosture: 'single' }, walled: false },
    { name: 'posture=single', scenario: { posture: 'single', effectivePosture: 'single' }, walled: false },
    { name: 'legacy=true only', scenario: { legacy: 'true' }, walled: true },
    { name: 'legacy=false only', scenario: { legacy: 'false' }, walled: false },
    { name: 'nothing set', scenario: {}, walled: false },
  ];

  it.each(scenarios)('$name', async ({ scenario, walled }) => {
    const run = await runSeeder(scenario);
    expect(run.inlineSeeded).toBe(!walled);
    expect(run.hotReloadSeederRegistered).toBe(!walled);
    // The invariant, not the two booleans: both sites read one fact.
    expect(run.inlineSeeded).toBe(run.hotReloadSeederRegistered);
  });
});
