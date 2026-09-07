// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// cloud#1092 — a walled deployment must DECLARE what a new user joins.
//
// The subject of this suite is one distinction and nothing else: DECLARED vs
// DEFAULTED. Asserting the OUTCOME ("no membership was created") would be green
// on an undeclared deployment too — that is precisely the hole cloud#1092
// reports — so every case here keys on the settings service's `source`, which
// is the only thing that can tell the two apart.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertWalledMembershipPolicyDeclared,
  isWalledMembershipPolicyError,
  readMembershipPolicyDeclaration,
  walledMembershipPolicyFatalMessage,
  MEMBERSHIP_POLICY_ENV,
  MEMBERSHIP_POLICY_ERROR_CODE,
  MEMBERSHIP_POLICY_SETTING,
  WalledMembershipPolicyError,
  type MembershipPolicyDeclaration,
} from './membership-policy-gate.js';
import { OrganizationsPlugin } from './organizations-plugin.js';

// ⛔ No entitlement grant: the open package has no licence gate (ADR-0132
// boundary 3). The subject is unchanged — DECLARED vs DEFAULTED.

// ── Fakes ────────────────────────────────────────────────────────────────────

/**
 * How the `auth.membership_policy` setting resolves on the fake kernel.
 *
 * `'absent'` / `'throws'` / `'no-key'` model the three ways the namespace can
 * fail to answer; an object models a real resolution, where `source` is the
 * settings service's own cascade verdict (`default` = the manifest default
 * nobody chose, anything else = an operator wrote it).
 */
type SettingsFixture =
  | 'absent'
  | 'throws'
  | 'no-key'
  | { source: 'env' | 'global' | 'tenant' | 'user' | 'default'; value: unknown };

interface CtxFixture {
  settings?: SettingsFixture;
  /** `undefined` = no `auth` service at all. */
  authPolicy?: string;
  /** Extra services the fake kernel should resolve. */
  services?: Record<string, unknown>;
}

function makeCtx(fixture: CtxFixture = {}) {
  const services: Record<string, unknown> = { ...(fixture.services ?? {}) };

  const settings = fixture.settings ?? { source: 'default', value: 'auto' };
  if (settings !== 'absent') {
    services.settings = {
      getNamespace: vi.fn(async (namespace: string) => {
        if (settings === 'throws') throw new Error(`namespace '${namespace}' is not registered`);
        if (settings === 'no-key') return { values: {} };
        return { values: { membership_policy: { value: settings.value, source: settings.source } } };
      }),
    };
  }

  if (fixture.authPolicy !== undefined) {
    services.auth = { getMembershipPolicy: () => fixture.authPolicy };
  }

  const hooks = new Map<string, Array<() => unknown>>();
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => {
      services[name] = svc;
    },
    hook: (name: string, handler: () => unknown) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(handler);
    },
    trigger: async (name: string) => {
      for (const h of hooks.get(name) ?? []) await h();
    },
  };
  return { ctx, hooks, services };
}

/** Set `OS_TENANCY_POSTURE` for one test; restored by the `afterEach` below. */
const savedPosture = process.env.OS_TENANCY_POSTURE;
function posture(value: string | undefined): void {
  if (value === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = value;
}
afterEach(() => {
  if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = savedPosture;
});

/** Run the gate and return the refusal, or `null` when it allowed the boot. */
async function refusal(ctx: Parameters<typeof assertWalledMembershipPolicyDeclared>[0]) {
  try {
    await assertWalledMembershipPolicyDeclared(ctx);
    return null;
  } catch (e) {
    return e as WalledMembershipPolicyError;
  }
}

// ── The four acceptance cases (cloud#1092) ───────────────────────────────────

describe('walled posture + membership policy (cloud#1092)', () => {
  it('walled + NEVER CONFIGURED → refuses to boot', async () => {
    posture('isolated');
    const { ctx } = makeCtx({ authPolicy: 'auto', settings: { source: 'default', value: 'auto' } });

    const err = await refusal(ctx);
    expect(err, 'an undeclared walled deployment booted').not.toBeNull();
    expect(err).toBeInstanceOf(WalledMembershipPolicyError);
    expect(err!.posture).toBe('isolated');
    expect(err!.declaration.declared).toBe(false);
    expect(err!.declaration.source).toBe('default');
  });

  it('walled + EXPLICIT invite-only → boots', async () => {
    posture('isolated');
    const { ctx } = makeCtx({
      authPolicy: 'invite-only',
      settings: { source: 'env', value: 'invite-only' },
    });
    expect(await refusal(ctx)).toBeNull();
  });

  it('walled + EXPLICIT auto → boots (knowingly accepting auto-join is a decision)', async () => {
    posture('isolated');
    const { ctx } = makeCtx({ authPolicy: 'auto', settings: { source: 'env', value: 'auto' } });

    // The effective policy, the resulting behavior, and the sign-up outcome are
    // all IDENTICAL to the refused case above. Only the declaration differs —
    // which is the entire content of this issue.
    expect(await refusal(ctx)).toBeNull();
  });

  it('single posture + NEVER CONFIGURED → boots (no check, no behavior change)', async () => {
    posture('single');
    const { ctx, services } = makeCtx({
      authPolicy: 'auto',
      settings: { source: 'default', value: 'auto' },
    });

    expect(await refusal(ctx)).toBeNull();
    // Not merely "did not throw": an unwalled deployment must not even be
    // interrogated, so the settings namespace is never read.
    expect((services.settings as { getNamespace: ReturnType<typeof vi.fn> }).getNamespace)
      .not.toHaveBeenCalled();
  });
});

// ── Posture coverage ─────────────────────────────────────────────────────────

describe('which postures the gate covers', () => {
  it('refuses under `group` as well as `isolated` — both are walls', async () => {
    posture('group');
    const { ctx } = makeCtx({ authPolicy: 'auto', settings: { source: 'default', value: 'auto' } });
    const err = await refusal(ctx);
    expect(err).not.toBeNull();
    expect(err!.posture).toBe('group');
  });

  it('covers the legacy boolean pathway — OS_MULTI_ORG_ENABLED=true resolves to a wall', async () => {
    // ADR-0105 D1 demoted the boolean to a FALLBACK for the posture, so it
    // still expresses the same request. A gate that keyed off
    // `OS_TENANCY_POSTURE` being set would miss every deployment on the old
    // knob — cloud#1020's hole, verbatim.
    posture(undefined);
    const saved = process.env.OS_MULTI_ORG_ENABLED;
    process.env.OS_MULTI_ORG_ENABLED = 'true';
    try {
      const { ctx } = makeCtx({ authPolicy: 'auto', settings: { source: 'default', value: 'auto' } });
      expect(await refusal(ctx)).not.toBeNull();
    } finally {
      if (saved === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
      else process.env.OS_MULTI_ORG_ENABLED = saved;
    }
  });

  it('a MALFORMED posture is not this gate\'s failure to report — it fails open', async () => {
    // `resolveTenancyPosture()` throws on garbage. Replacing the framework's
    // own "that is not a posture" refusal with a membership-policy lecture
    // would send the operator to the wrong knob.
    posture('isolatedd');
    const { ctx } = makeCtx({ authPolicy: 'auto', settings: { source: 'default', value: 'auto' } });
    expect(await refusal(ctx)).toBeNull();
  });
});

// ── What counts as a declaration ─────────────────────────────────────────────

describe('what counts as a declaration', () => {
  it.each(['global', 'tenant', 'user'] as const)(
    'a STORED row (source: %s) is a declaration — Setup → Authentication → Membership counts',
    async (source) => {
      posture('isolated');
      // Deliberately paired with an auth manager still reporting `auto`: the
      // settings binding and this gate both run at boot, and hook order is not
      // ours to depend on. A deployment that configured the policy through the
      // UI must not be refused because we asked the manager a beat too early.
      const { ctx } = makeCtx({ authPolicy: 'auto', settings: { source, value: 'invite-only' } });
      expect(await refusal(ctx)).toBeNull();
    },
  );

  it('an AuthPlugin CONSTRUCTION-time policy is a declaration, with no setting involved', async () => {
    // `service-cloud`'s control-plane preset declares `invite-only` where it
    // constructs AuthPlugin (cloud#957/#962). No `sys_setting` row exists, so
    // the source is `default` — and refusing that would be a false refusal of a
    // deployment that declared the policy in code.
    posture('isolated');
    const { ctx } = makeCtx({
      authPolicy: 'invite-only',
      settings: { source: 'default', value: 'auto' },
    });
    expect(await refusal(ctx)).toBeNull();
  });

  it('a DECLARED value outside the closed vocabulary refuses — it never took effect', async () => {
    // `OS_AUTH_MEMBERSHIP_POLICY` bypasses the settings option table, so a typo
    // reaches the runtime. The framework rejects it and keeps running `auto`
    // (it does not coerce), which leaves the operator believing the wall
    // decides membership while every sign-up is auto-join eligible.
    posture('isolated');
    const { ctx } = makeCtx({
      authPolicy: 'auto',
      settings: { source: 'env', value: 'invite_only' },
    });

    const err = await refusal(ctx);
    expect(err).not.toBeNull();
    expect(err!.declaration.invalid).toBe(true);
    expect(err!.message).toContain('invite_only');
    // The headline must NOT claim the policy was never declared — the operator
    // knows they set it, and would go looking for a second, missing setting.
    expect(err!.message).toContain('is not one this runtime can enforce');
    expect(err!.message).not.toContain('never declared a membership policy');
  });

  it('an invalid setting refuses even when construction set invite-only', async () => {
    // Configuration saying one thing while the runtime does another IS the
    // defect. Letting the construction-time value paper over it would restore
    // exactly the "declared but unenforced" state ADR-0049 rules out.
    posture('isolated');
    const { ctx } = makeCtx({
      authPolicy: 'invite-only',
      settings: { source: 'global', value: 'INVITE-ONLY' },
    });
    expect(await refusal(ctx)).not.toBeNull();
  });

  it('no `auth` service → skipped: nothing creates memberships, so nothing to declare', async () => {
    posture('isolated');
    const { ctx, services } = makeCtx({ settings: { source: 'default', value: 'auto' } });
    expect(services.auth).toBeUndefined();
    expect(await refusal(ctx)).toBeNull();
  });

  it('auth present but the settings namespace is UNREADABLE → refuses', async () => {
    // `OS_AUTH_MEMBERSHIP_POLICY` is inert on a kernel with no settings
    // service, so the effective policy is whatever AuthPlugin was constructed
    // with — `auto` here, unfixable by configuration. Fail closed, and say so
    // rather than pointing at an env variable that would do nothing.
    posture('isolated');
    const { ctx } = makeCtx({ authPolicy: 'auto', settings: 'absent' });

    const err = await refusal(ctx);
    expect(err).not.toBeNull();
    expect(err!.declaration.source).toBe('unreadable');
    expect(err!.message).toContain('@objectstack/service-settings');
    // The env remedy would be a lie here — it must NOT be offered.
    expect(err!.message).not.toContain(`${MEMBERSHIP_POLICY_ENV}=invite-only`);
  });

  it.each([
    ['the namespace read throws', 'throws' as const],
    ['the namespace carries no membership_policy key', 'no-key' as const],
  ])('unreadable: %s', async (_label, settings) => {
    posture('isolated');
    const { ctx } = makeCtx({ authPolicy: 'auto', settings });
    const err = await refusal(ctx);
    expect(err).not.toBeNull();
    expect(err!.declaration.source).toBe('unreadable');
  });
});

// ── The reader in isolation ──────────────────────────────────────────────────

describe('readMembershipPolicyDeclaration', () => {
  it('reports source and validity without judging them', async () => {
    const settings = {
      getNamespace: async () => ({
        values: { membership_policy: { value: 'invite-only', source: 'env' } },
      }),
    };
    await expect(readMembershipPolicyDeclaration(settings)).resolves.toEqual({
      declared: true,
      invalid: false,
      source: 'env',
      configured: 'invite-only',
    });
  });

  it('never throws — an exploding settings service becomes `unreadable`', async () => {
    const settings = {
      getNamespace: async () => {
        throw new Error('boom');
      },
    };
    const decl = await readMembershipPolicyDeclaration(settings);
    expect(decl.source).toBe('unreadable');
    expect(decl.declared).toBe(false);
    expect(decl.readError).toContain('boom');
  });

  it('treats a missing `source` as `default` — an absent verdict is not a declaration', async () => {
    const settings = {
      getNamespace: async () => ({ values: { membership_policy: { value: 'auto' } } }),
    };
    const decl = await readMembershipPolicyDeclaration(settings);
    expect(decl.source).toBe('default');
    expect(decl.declared).toBe(false);
  });
});

// ── The refusal itself ───────────────────────────────────────────────────────

describe('the refusal', () => {
  const undeclared: MembershipPolicyDeclaration = {
    declared: false,
    invalid: false,
    source: 'default',
    configured: 'auto',
  };

  it('is structurally recognisable across module instances', async () => {
    posture('isolated');
    const { ctx } = makeCtx({ authPolicy: 'auto' });
    const err = await refusal(ctx);
    expect(isWalledMembershipPolicyError(err)).toBe(true);
    expect((err as { code?: string }).code).toBe(MEMBERSHIP_POLICY_ERROR_CODE);
    // A plain object with the right `code` is recognised too — that is the
    // point of a structural tag (hosts import this package dynamically).
    expect(isWalledMembershipPolicyError({ code: MEMBERSHIP_POLICY_ERROR_CODE })).toBe(true);
    expect(isWalledMembershipPolicyError(new Error('nope'))).toBe(false);
  });

  // The commercial runtime's copy of this case also asserted
  // `isMultiOrgLicenseError(err) === false`. That discriminator lives with the
  // licence gate, which stayed in cloud (ADR-0132 boundary 1), so the open copy
  // keeps the half that is about THIS refusal: its message rules the licensing
  // remedy out in its own first sentences, which is what an operator reads.
  it('rules out the licensing and missing-package remedies in its own words', async () => {
    posture('isolated');
    const { ctx } = makeCtx({ authPolicy: 'auto' });
    const err = await refusal(ctx);
    expect(err!.message).toMatch(/NOT a licensing failure/);
    expect(err!.message).toMatch(/NOT a missing package/i);
  });

  it('names the posture, both remedies, and the knob — an operator can act on it alone', () => {
    const msg = walledMembershipPolicyFatalMessage('isolated', undeclared);
    expect(msg).toContain("tenancy posture 'isolated' is walled");
    expect(msg).toContain(MEMBERSHIP_POLICY_SETTING);
    expect(msg).toContain(`${MEMBERSHIP_POLICY_ENV}=invite-only`);
    expect(msg).toContain(`${MEMBERSHIP_POLICY_ENV}=auto`);
    expect(msg).toContain('Setup → Authentication →');
    expect(msg).toContain('OS_TENANCY_POSTURE=single');
  });

  it('offers BOTH values — the gate forces a decision, it does not make one', () => {
    const msg = walledMembershipPolicyFatalMessage('group', undeclared);
    // If this ever reads as "set invite-only", the gate has quietly become a
    // product opinion instead of a declaration requirement.
    expect(msg).toContain('EITHER is a declaration');
    expect(msg).toContain('knowingly accept automatic joins');
  });

  it('refuses to let OS_ALLOW_DEGRADED_TENANCY look like a way past', () => {
    const msg = walledMembershipPolicyFatalMessage('isolated', undeclared);
    expect(msg).toMatch(/OS_ALLOW_DEGRADED_TENANCY does NOT apply/);
  });

  it('reports the source verbatim so "why was I refused" is answerable from the message', () => {
    expect(walledMembershipPolicyFatalMessage('isolated', undeclared)).toContain(
      'source: default — nobody configured it',
    );
  });
});

// ── Wiring: the plugin's own boot hook ───────────────────────────────────────

describe('OrganizationsPlugin boot wiring', () => {
  function pluginCtx(fixture: CtxFixture) {
    const baseSchema = { name: 'task', fields: { id: { name: 'id' } } };
    const ql = {
      registerMiddleware: vi.fn(),
      getSchema: () => baseSchema,
      find: vi.fn(async () => []),
      insert: vi.fn(async () => ({ id: 'x' })),
    };
    return makeCtx({
      ...fixture,
      services: { objectql: ql, metadata: { get: async () => baseSchema }, manifest: { register: vi.fn() } },
    });
  }

  it('registers the gate on `kernel:bootstrapped`, not `kernel:ready`', async () => {
    // `kernel:ready` is where SettingsServicePlugin late-binds its DATA ENGINE,
    // and hook order is registration order — reading there can miss a STORED
    // row and refuse a deployment that did configure the policy.
    // `kernel:bootstrapped` fires after every `kernel:ready` handler has
    // settled, and still BEFORE `kernel:listening` opens the socket.
    posture('isolated');
    const plugin = new OrganizationsPlugin();
    const { ctx, hooks } = pluginCtx({ authPolicy: 'auto' });
    await plugin.start(ctx as never);
    expect(hooks.get('kernel:bootstrapped') ?? []).toHaveLength(1);
  });

  it('the registered hook refuses an undeclared walled boot', async () => {
    posture('isolated');
    const plugin = new OrganizationsPlugin();
    const { ctx } = pluginCtx({ authPolicy: 'auto', settings: { source: 'default', value: 'auto' } });
    await plugin.start(ctx as never);
    await expect(ctx.trigger('kernel:bootstrapped')).rejects.toThrow(WalledMembershipPolicyError);
  });

  it('the registered hook lets a declared walled boot through', async () => {
    posture('isolated');
    const plugin = new OrganizationsPlugin();
    const { ctx } = pluginCtx({
      authPolicy: 'invite-only',
      settings: { source: 'env', value: 'invite-only' },
    });
    await plugin.start(ctx as never);
    await expect(ctx.trigger('kernel:bootstrapped')).resolves.toBeUndefined();
  });

  it('start() registers the gate BEFORE it can return early on a missing engine', async () => {
    // The wall is being mounted whether or not ObjectQL turned up, so an early
    // return must not be able to skip the declaration check.
    posture('isolated');
    const plugin = new OrganizationsPlugin();
    const { ctx, hooks } = makeCtx({ authPolicy: 'auto' }); // no `objectql` service
    await plugin.start(ctx as never);
    expect(hooks.get('kernel:bootstrapped') ?? []).toHaveLength(1);
    await expect(ctx.trigger('kernel:bootstrapped')).rejects.toThrow(WalledMembershipPolicyError);
  });

  it('a kernel with no hook seam is checked INLINE rather than not at all', async () => {
    posture('isolated');
    const plugin = new OrganizationsPlugin();
    const { ctx } = pluginCtx({ authPolicy: 'auto' });
    const hookless = { ...ctx, hook: undefined };
    await expect(plugin.start(hookless as never)).rejects.toThrow(WalledMembershipPolicyError);
  });

  it('leaves a single-posture boot completely untouched', async () => {
    posture('single');
    const plugin = new OrganizationsPlugin();
    const { ctx } = pluginCtx({ authPolicy: 'auto' });
    await plugin.start(ctx as never);
    await expect(ctx.trigger('kernel:bootstrapped')).resolves.toBeUndefined();
  });
});
