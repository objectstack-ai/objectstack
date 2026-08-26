// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `auth.membership_policy` — the platform setting, and the ONE source both
 * membership paths read (#5152, ADR-0093 D1/D2/D6).
 *
 * Two defects are pinned here, and they are only worth fixing together:
 *
 * 1. **No runtime configuration entry.** `membershipPolicy` was settable only
 *    as an `AuthPlugin` constructor option, and the CLI-injected AuthPlugin
 *    (`cli/src/commands/serve.ts`) does not pass it — so a self-hosted stack
 *    could never express `invite-only`, whatever cloud#1012 decided. It now
 *    rides the `bindAuthSettings()` → `applyConfigPatch()` seam that
 *    `signup_enabled` and the password-policy keys already ride.
 *
 * 2. **The two read sites disagreed.** Sign-up read `this.config` (patchable);
 *    the ADR-0093 D6 backfill read `this.options` (a constructor option no
 *    settings change can reach). Wiring the setting without unifying them
 *    yields "sign-up honours the new policy, backfill still runs the old one"
 *    — and the backfill binds in BULK.
 *
 * `reconcileMembership` / `backfillMemberships` are spied through to the REAL
 * implementations, so the assertions below name the actual outcome
 * (`policy-skip` vs `no-target-org`) rather than inferring it from an absence.
 * That distinction is the whole point of the acceptance criteria: a walled
 * deployment already produces "user has no membership" as a side effect of
 * `defaultOrgId()` returning null, so asserting only the absence proves
 * nothing about the policy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
import { AuthManager } from './auth-manager.js';

vi.mock('./reconcile-membership.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reconcile-membership.js')>();
  return {
    ...actual,
    reconcileMembership: vi.fn(actual.reconcileMembership),
    backfillMemberships: vi.fn(actual.backfillMemberships),
  };
});

import { reconcileMembership, backfillMemberships, MEMBERSHIP_POLICIES } from './reconcile-membership.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/objectql';

const reconcileSpy = vi.mocked(reconcileMembership);
const backfillSpy = vi.mocked(backfillMemberships);

const SECRET = 'test-secret-at-least-32-chars-long';

type SettingEntry = { value: unknown; source: string };

/** In-memory `sys_user` / `sys_member` store with the find/insert surface used. */
function makeEngine(seed: { users?: Array<{ id: string }>; members?: Array<{ user_id: string }> } = {}) {
  const users = [...(seed.users ?? [])];
  const members: Array<{ organization_id: string; user_id: string }> = [
    ...((seed.members ?? []) as any[]),
  ];
  return {
    _members: members,
    insert: vi.fn(async (_object: string, row: any) => {
      members.push({ organization_id: row.organization_id, user_id: row.user_id });
      return row;
    }),
    find: vi.fn(async (object: string, query: any) => {
      const where = query?.where ?? {};
      if (object === 'sys_user') return users;
      if (object === 'sys_member') {
        return members.filter(
          (m) =>
            (where.user_id === undefined || m.user_id === where.user_id) &&
            (where.organization_id === undefined || m.organization_id === where.organization_id),
        );
      }
      return [];
    }),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
  };
}

describe('auth.membership_policy — the setting', () => {
  let mockContext: PluginContext;
  let hookHandlers: Map<string, Array<() => Promise<void>>>;
  const previousSkipBackfill = process.env.OS_SKIP_MEMBERSHIP_BACKFILL;
  const previousEnvPolicy = process.env.OS_AUTH_MEMBERSHIP_POLICY;

  const settingsStore: { values: Record<string, SettingEntry> } = { values: {} };
  let subscribers: Array<() => void>;

  const makeSettings = () => ({
    getNamespace: vi.fn(async (namespace: string) =>
      namespace === 'auth' ? { values: settingsStore.values } : { values: {} },
    ),
    subscribe: vi.fn((namespace: string, cb: () => void) => {
      if (namespace === 'auth') subscribers.push(cb);
    }),
  });

  beforeEach(() => {
    reconcileSpy.mockClear();
    backfillSpy.mockClear();
    settingsStore.values = {};
    subscribers = [];
    delete process.env.OS_SKIP_MEMBERSHIP_BACKFILL;
    delete process.env.OS_AUTH_MEMBERSHIP_POLICY;
    hookHandlers = new Map();
    mockContext = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return makeSettings();
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (!hookHandlers.has(name)) hookHandlers.set(name, []);
        hookHandlers.get(name)!.push(handler);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
  });

  afterEach(() => {
    if (previousSkipBackfill === undefined) delete process.env.OS_SKIP_MEMBERSHIP_BACKFILL;
    else process.env.OS_SKIP_MEMBERSHIP_BACKFILL = previousSkipBackfill;
    if (previousEnvPolicy === undefined) delete process.env.OS_AUTH_MEMBERSHIP_POLICY;
    else process.env.OS_AUTH_MEMBERSHIP_POLICY = previousEnvPolicy;
  });

  const fire = async (name: string) => {
    for (const h of hookHandlers.get(name) ?? []) await h();
  };

  /**
   * Boot the plugin exactly as a host does (init → start → kernel:ready), with
   * `engine` behind both the `data` and `objectql` services and a tenancy stub
   * that DOES resolve a default org — so `no-target-org` is off the table and
   * any skip that happens can only be the policy.
   *
   * `kernel:ready` is fired because that is when the settings namespace binds
   * AND when the ADR-0093 D6 backfill runs. The two hooks fire in registration
   * order — backfill (`init`) first, settings (`start`) second — so this
   * harness is also what proves the backfill does not outrun its own policy.
   */
  const boot = async (opts: {
    settings?: Record<string, SettingEntry>;
    pluginOptions?: Record<string, unknown>;
    engine?: ReturnType<typeof makeEngine>;
    defaultOrgId?: string | null;
  } = {}) => {
    settingsStore.values = opts.settings ?? {};
    const engine = opts.engine ?? makeEngine();
    const defaultOrgId = vi.fn(async () => opts.defaultOrgId ?? 'org_default');
    (mockContext.getService as any).mockImplementation((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'settings') return makeSettings();
      if (name === 'data' || name === 'objectql') return engine;
      return undefined;
    });

    const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000', ...(opts.pluginOptions ?? {}) });
    await plugin.init(mockContext);
    // Substitute the tenancy stub for the real service: `defaultOrgId` is the
    // observable that separates `policy-skip` from `no-target-org`.
    (plugin as any).tenancy = { defaultOrgId };
    const manager = (mockContext.registerService as any).mock.calls.find(
      ([name]: [string]) => name === 'auth',
    )?.[1] as AuthManager;
    (manager as any).config.getTenancy = () => ({ defaultOrgId });
    await plugin.start(mockContext);
    await fire('kernel:ready');
    return { plugin, manager, engine, defaultOrgId };
  };

  /** The composed better-auth `user.create.after` hook — the sign-up seam. */
  const signUpHook = (manager: AuthManager) =>
    (manager as any).composeDatabaseHooks(undefined).user.create.after as (u: any) => Promise<void>;

  // ── 1. The setting reaches the runtime ────────────────────────────────────

  it('an explicit invite-only setting patches the live policy', async () => {
    const { manager } = await boot({
      settings: { membership_policy: { value: 'invite-only', source: 'global' } },
    });
    expect(manager.getMembershipPolicy()).toBe('invite-only');
  });

  it('leaves the default alone when the setting is not explicitly set (no breaking change)', async () => {
    // The manifest ships `default: 'auto'`; the settings service reports it at
    // source `default`. A UI default must never be mistaken for an operator's
    // intent — same rule every sibling key in `bindAuthSettings` follows.
    const { manager } = await boot({
      settings: { membership_policy: { value: 'auto', source: 'default' } },
    });
    expect(manager.getMembershipPolicy()).toBe('auto');
    expect((manager as any).config.membershipPolicy).toBeUndefined();
  });

  it('a manifest default does not mask a deployment that set the policy in code', async () => {
    const { manager } = await boot({
      pluginOptions: { membershipPolicy: 'invite-only' },
      settings: { membership_policy: { value: 'auto', source: 'default' } },
    });
    expect(manager.getMembershipPolicy()).toBe('invite-only');
  });

  it('re-applies on a settings change without a restart', async () => {
    const { manager } = await boot({
      settings: { membership_policy: { value: 'auto', source: 'global' } },
    });
    expect(manager.getMembershipPolicy()).toBe('auto');

    settingsStore.values = { membership_policy: { value: 'invite-only', source: 'global' } };
    expect(subscribers.length).toBeGreaterThan(0);
    for (const cb of subscribers) cb();
    await vi.waitFor(() => expect(manager.getMembershipPolicy()).toBe('invite-only'));
  });

  // ── 2. An invalid value is rejected, never coerced ────────────────────────

  it('rejects an unrecognised value instead of silently falling back to auto', async () => {
    // `OS_AUTH_MEMBERSHIP_POLICY` bypasses the settings service's option-table
    // validation entirely, so a typo arrives here uncaught. Reading it as
    // `auto` would leave an operator believing the wall is up while every
    // sign-up is auto-bound.
    const { manager } = await boot({
      pluginOptions: { membershipPolicy: 'invite-only' },
      settings: { membership_policy: { value: 'invite_only', source: 'env' } },
    });
    expect(manager.getMembershipPolicy()).toBe('invite-only'); // NOT coerced to 'auto'
    const logged = (mockContext.logger.error as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(logged.some((m: string) => m.includes('invite_only'))).toBe(true);
    expect(logged.some((m: string) => m.includes(MEMBERSHIP_POLICIES.join(', ')))).toBe(true);
  });

  // ── 3. Sign-up: the reason is `policy-skip`, not `no-target-org` ──────────

  it('invite-only makes a new sign-up take the policy-skip path (not no-target-org)', async () => {
    const { manager, engine, defaultOrgId } = await boot({
      settings: { membership_policy: { value: 'invite-only', source: 'global' } },
    });

    await signUpHook(manager)({ id: 'usr_new' });

    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy.mock.calls[0]![2]!.policy).toBe('invite-only');
    // The literal outcome, not an inference from "no membership exists".
    await expect(reconcileSpy.mock.results[0]!.value).resolves.toEqual({ outcome: 'policy-skip' });
    // And the corroborating evidence: `no-target-org` can only be reached by
    // ASKING for the target org. Under the policy skip it is never consulted.
    expect(defaultOrgId).not.toHaveBeenCalled();
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('the unset default still auto-binds a new sign-up (unchanged behaviour)', async () => {
    const { manager, engine, defaultOrgId } = await boot();

    await signUpHook(manager)({ id: 'usr_new' });

    await expect(reconcileSpy.mock.results[0]!.value).resolves.toEqual({
      outcome: 'bound',
      organizationId: 'org_default',
    });
    expect(defaultOrgId).toHaveBeenCalled();
    expect(engine.insert).toHaveBeenCalledWith(
      'sys_member',
      expect.objectContaining({ organization_id: 'org_default', user_id: 'usr_new' }),
      expect.anything(),
    );
  });

  // ── 4. Sign-up and backfill read ONE source ──────────────────────────────

  it('the backfill honours a settings-set policy the constructor never saw', async () => {
    // THE regression pin. On `main` the backfill read
    // `this.options.membershipPolicy` — a constructor option — so this exact
    // deployment (code says `auto`, admin says `invite-only`) bulk-bound every
    // pre-existing member-less user while sign-up correctly refused to.
    const engine = makeEngine({ users: [{ id: 'usr_legacy_1' }, { id: 'usr_legacy_2' }] });
    const { defaultOrgId } = await boot({
      pluginOptions: { membershipPolicy: 'auto' },
      settings: { membership_policy: { value: 'invite-only', source: 'global' } },
      engine,
    });

    expect(backfillSpy).toHaveBeenCalled();
    expect(backfillSpy.mock.calls[0]![1]!.policy).toBe('invite-only');
    await expect(backfillSpy.mock.results[0]!.value).resolves.toMatchObject({
      bound: 0,
      reason: 'policy',
    });
    expect(defaultOrgId).not.toHaveBeenCalled();
    expect(engine.insert).not.toHaveBeenCalled();
  });

  it('the backfill still binds pre-existing member-less users under the unset default', async () => {
    const engine = makeEngine({ users: [{ id: 'usr_legacy_1' }] });
    await boot({ engine });

    await expect(backfillSpy.mock.results[0]!.value).resolves.toMatchObject({ bound: 1 });
    expect(engine._members).toEqual([{ organization_id: 'org_default', user_id: 'usr_legacy_1' }]);
  });

  it('both paths resolve the policy through AuthManager.getMembershipPolicy()', async () => {
    // The structural half of the pin: a behaviour test can be satisfied by two
    // read sites that happen to agree today. This one fails the moment either
    // path goes back to reading a captured copy, whatever value it holds.
    const engine = makeEngine({ users: [{ id: 'usr_legacy_1' }] });
    const { manager } = await boot({ engine });
    const spy = vi.spyOn(manager, 'getMembershipPolicy');

    await signUpHook(manager)({ id: 'usr_new' });
    expect(spy, 'sign-up must read the policy off the AuthManager').toHaveBeenCalled();

    spy.mockClear();
    // `app:seeded` re-runs the same (idempotent) backfill — #2996.
    await fire('app:seeded');
    expect(spy, 'the ADR-0093 D6 backfill must read the SAME source').toHaveBeenCalled();
  });
});
