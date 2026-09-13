// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15074] The platform-SSO tenant kernel that reported its HEALTHY state as an
 * unrecoverable dead end.
 *
 * `no_sign_in_account_at_boot` fires on ONE store shape — human `sys_user`
 * rows, zero `sys_account` rows — and says of it: "NOBODY CAN SIGN IN, and the
 * deployment CANNOT BE RECOVERED FROM INSIDE". On a deployment whose sign-in is
 * DELEGATED to an identity provider that mission-critically does not need a
 * `sys_account` row of its own, that same shape is the NORMAL resting state:
 * `AuthConfigSchema.ssoOnlyMode` says so in the contract — "managed
 * (IdP-provisioned) users simply hold no local credential" — and names
 * `cloud-as-IdP` as one of the IdPs it is generic over. The card measured it on
 * a cloud tenant environment where the very boot that emitted the ERROR had
 * just served an SSO handoff.
 *
 * ## What this suite pins, in BOTH directions
 *
 * The failure this card guards against is silencing both shapes at once — a
 * no-SSO deployment with humans and zero accounts is still a real dead end
 * (#14495 / #14353) and must still be told, loudly. So every "quiet" case below
 * is paired with a control that still reports:
 *
 *  - delegated sign-in configured ⇒ NO `error`, and a `debug` line naming the
 *    path as the reason (the card's own second option);
 *  - nothing configured ⇒ the `error` fires exactly as before;
 *  - the SSO plugin merely SWITCHED ON with no IdP registered ⇒ the `error`
 *    still fires. A wired-but-unconfigured plugin signs nobody in, so it is not
 *    a sign-in path, and #14353's independence pin (`FEDERATED SIGN-IN IS
 *    WIRED — the neighbour stays quiet; this still reports`) keeps its meaning.
 *
 * ⛔ Nothing here touches {@link probeSignInAccountsPresence}'s existence-only
 * predicate — that is #15718's half, and it carries an unruled maintainer
 * question. This card gates the REPORT on a third fact; the probe is untouched
 * and #14353's pins stay green beside it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthPlugin } from './auth-plugin';
import {
  NO_SIGN_IN_ACCOUNT_AT_BOOT,
  probeSignInAccountsPresence,
  probeSignInPathWiring,
  probeSsoProvidersPresence,
  reportIfNoSignInAccountExists,
  resolveDelegatedSignInPath,
  resolveNoSignInAccountReport,
} from './boot-sign-in-reachability';
import type {
  BootProbeEngine,
  SignInPathWiring,
  SignInReachabilityFacts,
} from './boot-sign-in-reachability';
import { WALLED_OWNER_NO_VERIFICATION_PATH } from './walled-owner-verification-path';
import type { PluginContext } from '@objectstack/core';

/** The store shape this report speaks about: humans SEEN, accounts SEEN ABSENT. */
const DEAD_END: SignInReachabilityFacts = { humanUsers: 'present', signInAccounts: 'absent' };
const NOTHING_WIRED: SignInPathWiring = {
  ssoOnlyMode: false,
  socialSignIn: false,
  enterpriseSso: false,
};

const ENV_KEYS = [
  'OS_AUTH_SSO_ONLY',
  'OS_SSO_ENABLED',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_AUTH_GOOGLE_ENABLED',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NODE_ENV',
] as const;
const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

// ---------------------------------------------------------------------------
// The same recording fake store the #14353 suite uses, plus the third table
// this card's gate consults (`sys_sso_provider`).
// ---------------------------------------------------------------------------

type Store = {
  users?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  ssoProviders?: Record<string, unknown>[];
};

const engineOver = (store: Store) => {
  const reads: { object: string; query: Record<string, unknown> }[] = [];
  const engine: BootProbeEngine = {
    async find(object, query) {
      reads.push({ object, query });
      const rows =
        object === 'sys_user'
          ? (store.users ?? [])
          : object === 'sys_account'
            ? (store.accounts ?? [])
            : object === 'sys_sso_provider'
              ? (store.ssoProviders ?? [])
              : [];
      const limit = typeof query.limit === 'number' ? query.limit : rows.length;
      return rows.slice(0, limit);
    },
  };
  return { engine, reads };
};

const human = (i: number) => ({ id: `usr_${i}`, email: `person${i}@corp.example`, role: 'user' });
/** The population the card measured: people provisioned by the platform, no local credential. */
const HUMANS = [human(1), human(2), human(3)];

type Hooked = { event: string; handler: (...a: unknown[]) => unknown };

const makeCtx = (services: Record<string, unknown> = {}) => {
  const hooks: Hooked[] = [];
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name in services) return services[name];
      if (name === 'objectql') throw new Error('no service objectql');
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn((event: string, handler: (...a: unknown[]) => unknown) => {
      hooks.push({ event, handler });
    }),
    trigger: vi.fn(),
    logger,
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  return { ctx, hooks, logger };
};

const runKernelReady = async (hooks: Hooked[]) => {
  for (const h of hooks.filter((x) => x.event === 'kernel:ready')) {
    // Sibling hooks need services this fake context does not carry; their
    // failures are not this suite's subject.
    try { await h.handler(); } catch { /* not under test */ }
  }
};

const bootWith = async (
  store: Store,
  env: Record<string, string> = {},
  options: Record<string, unknown> = {},
) => {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { engine, reads } = engineOver(store);
  const { ctx, hooks, logger } = makeCtx({ objectql: engine });
  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long',
    registerRoutes: false,
    ...options,
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await runKernelReady(hooks);
  const said = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => String(c[0]));
  return {
    logger,
    reads,
    errors: said(logger.error).filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT)),
    warnings: said(logger.warn).filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT)),
    debugs: said(logger.debug).filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT)),
  };
};

// ---------------------------------------------------------------------------
// Direction 1 — a delegated sign-in path is configured ⇒ the ERROR must not fire
// ---------------------------------------------------------------------------

describe('#15074 — a deployment whose sign-in is DELEGATED is not a dead end', () => {
  it('SSO-only mode via `OS_AUTH_SSO_ONLY` — humans, zero accounts, and NO error', async () => {
    // The card's measured shape. `ssoOnlyMode` is the deployment DECLARING that
    // its humans sign in through an IdP and hold no local credential, so
    // "humans present, zero sys_account" is its healthy resting state.
    const { errors, warnings } = await bootWith(
      { users: HUMANS, accounts: [] },
      { OS_AUTH_SSO_ONLY: 'true' },
    );
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('SSO-only mode declared in CONFIG (`ssoOnlyMode`) reaches the same verdict', async () => {
    // Generic over the IdP and orthogonal to the env var: a cloud tenant kernel
    // receives this through its constructed auth config, not through env.
    const { errors, warnings } = await bootWith(
      { users: HUMANS, accounts: [] },
      {},
      { ssoOnlyMode: true },
    );
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('the suppressed report still leaves a `debug` line NAMING the reason', async () => {
    // The card's own second option: "degrade to a debug line naming the SSO
    // path as the reason". The grep token is unchanged, so an operator asking
    // "why is this quiet" finds the answer under the same name.
    const { debugs } = await bootWith(
      { users: HUMANS, accounts: [] },
      { OS_AUTH_SSO_ONLY: 'true' },
    );
    expect(debugs).toHaveLength(1);
    expect(debugs[0]).toMatch(/ssoOnlyMode/);
  });

  it('a configured SOCIAL provider is a sign-in path — no error', async () => {
    const { errors } = await bootWith(
      { users: HUMANS, accounts: [] },
      { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' },
    );
    expect(errors).toHaveLength(0);
  });

  it('enterprise SSO WITH a registered IdP is a sign-in path — no error', async () => {
    // SCIM-provisioned people + a registered `sys_sso_provider` row: everyone
    // signs in through the IdP and nobody holds a `sys_account` row until they
    // first do.
    const { errors } = await bootWith(
      { users: HUMANS, accounts: [], ssoProviders: [{ id: 'ssop_1', domain: 'corp.example' }] },
      { OS_SSO_ENABLED: '1' },
    );
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Direction 2 — the self-hosted dead end is UNTOUCHED and still loud
// ---------------------------------------------------------------------------

describe('#15074 — ⛔ the no-SSO dead end is NOT silenced (#14495 / #14353)', () => {
  it('NO delegated sign-in path at all — the error fires, exactly as before', async () => {
    const { errors } = await bootWith({ users: HUMANS, accounts: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('NOBODY CAN SIGN IN');
  });

  it('the SSO plugin merely SWITCHED ON, no IdP registered — still reports', async () => {
    // `OS_SSO_ENABLED=1` with zero `sys_sso_provider` rows mounts a route that
    // signs nobody in. It is not a sign-in path, and #14353's independence pin
    // says this deployment is still told.
    const { errors } = await bootWith(
      { users: HUMANS, accounts: [], ssoProviders: [] },
      { OS_SSO_ENABLED: '1' },
    );
    expect(errors).toHaveLength(1);
  });

  it('and it is NOT reduced to a debug line — the dead end keeps its level', async () => {
    const { errors, debugs } = await bootWith({ users: HUMANS, accounts: [] });
    expect(errors).toHaveLength(1);
    expect(debugs).toHaveLength(0);
  });

  it('the WALLED-OWNER NEIGHBOUR is untouched by this gate', async () => {
    // Suppressing this report hands the hook back to the neighbour, exactly as
    // it does for every other silent shape. The gate must not silence a second
    // diagnostic on its way past — that is its own decision, on its own facts.
    const { errors, logger } = await bootWith(
      { users: HUMANS, accounts: [] },
      {
        OS_AUTH_SSO_ONLY: 'true',
        OS_TENANCY_POSTURE: 'isolated',
        OS_PLATFORM_OWNER_EMAIL: 'owner@corp.example',
      },
    );
    expect(errors).toHaveLength(0);
    const neighbour = logger.warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH));
    expect(neighbour).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The gate, fact by fact — no I/O, no boot.
// ---------------------------------------------------------------------------

describe('#15074 — the predicate takes a THIRD fact and defaults to LOUD', () => {
  it('no wiring argument at all ⇒ the report is unchanged', () => {
    // Every pre-#15074 caller passes two arguments; the dead end they describe
    // must keep reporting rather than fall quiet because a parameter is absent.
    expect(resolveNoSignInAccountReport(DEAD_END)).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);
    expect(resolveNoSignInAccountReport(DEAD_END, NOTHING_WIRED)).toContain(
      NO_SIGN_IN_ACCOUNT_AT_BOOT,
    );
  });

  it.each([
    ['ssoOnlyMode', { ...NOTHING_WIRED, ssoOnlyMode: true }, /ssoOnlyMode/],
    ['socialSignIn', { ...NOTHING_WIRED, socialSignIn: true }, /social\/OIDC/],
    ['enterpriseSso', { ...NOTHING_WIRED, enterpriseSso: true }, /sys_sso_provider/],
  ])('a delegated path via `%s` ⇒ no report, and the reason NAMES it', (_n, wiring, names) => {
    expect(resolveNoSignInAccountReport(DEAD_END, wiring as SignInPathWiring)).toBeNull();
    expect(resolveDelegatedSignInPath(wiring as SignInPathWiring)).toMatch(names as RegExp);
  });

  it('nothing configured ⇒ there is no reason to name', () => {
    expect(resolveDelegatedSignInPath(NOTHING_WIRED)).toBeNull();
    expect(resolveDelegatedSignInPath(undefined)).toBeNull();
  });

  it('the gate only reaches the shape this report speaks about', () => {
    // A configured IdP is not a licence to go quiet about other shapes: the two
    // store facts still decide first, and `unknown` still claims nothing.
    const wired: SignInPathWiring = { ...NOTHING_WIRED, ssoOnlyMode: true };
    for (const facts of [
      { humanUsers: 'absent', signInAccounts: 'unknown' },
      { humanUsers: 'unknown', signInAccounts: 'unknown' },
      { humanUsers: 'present', signInAccounts: 'present' },
    ] satisfies SignInReachabilityFacts[]) {
      expect(resolveNoSignInAccountReport(facts, wired)).toBeNull();
      expect(resolveNoSignInAccountReport(facts)).toBeNull();
    }
  });

  it('the emitter records the SUPPRESSED shape at `debug` — and only that shape', () => {
    const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const wired: SignInPathWiring = { ...NOTHING_WIRED, ssoOnlyMode: true };

    expect(reportIfNoSignInAccountExists(DEAD_END, logger, wired)).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(String(logger.debug.mock.calls[0][0])).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);

    // An ordinary silent shape stays FULLY silent — the debug line is about the
    // suppression, not about every boot.
    logger.debug.mockClear();
    reportIfNoSignInAccountExists({ humanUsers: 'present', signInAccounts: 'present' }, logger, wired);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('a sink with no `debug` is not an error, and the boot survives a throwing one', () => {
    const wired: SignInPathWiring = { ...NOTHING_WIRED, socialSignIn: true };
    expect(() => reportIfNoSignInAccountExists(DEAD_END, { warn: vi.fn() }, wired)).not.toThrow();
    expect(() =>
      reportIfNoSignInAccountExists(
        DEAD_END,
        { warn: vi.fn(), debug: () => { throw new Error('sink is down'); } },
        wired,
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ⛔ #15718's half is NOT taken here.
// ---------------------------------------------------------------------------

describe('#15074 — `probeSignInAccountsPresence` is left exactly as it was', () => {
  it('still existence-only: ANY row answers `present`, unusable or not', async () => {
    // The #15718 direction (one unusable `sys_account` row silences this report
    // permanently) is an unruled maintainer question. This card gates the
    // REPORT on a fact the probe never had; the probe's predicate is untouched.
    const { engine } = engineOver({
      accounts: [{ id: 'acc_1', provider_id: 'credential', password: 'plaintext-authenticates-nothing' }],
    });
    await expect(probeSignInAccountsPresence(engine)).resolves.toBe('present');
  });

  it('and a configured IdP does not change what the account probe answers', async () => {
    process.env.OS_AUTH_SSO_ONLY = 'true';
    const { engine } = engineOver({ users: HUMANS, accounts: [] });
    await expect(probeSignInAccountsPresence(engine)).resolves.toBe('absent');
  });
});

// ---------------------------------------------------------------------------
// The provider probe, and what it costs.
// ---------------------------------------------------------------------------

describe('#15074 — the `sys_sso_provider` probe is bounded, silent and cheap', () => {
  it('answers present / absent off one bounded row read', async () => {
    const { engine, reads } = engineOver({ ssoProviders: [{ id: 'ssop_1' }] });
    await expect(probeSsoProvidersPresence(engine)).resolves.toBe('present');
    expect(reads).toEqual([{ object: 'sys_sso_provider', query: { limit: 1 } }]);

    const empty = engineOver({ ssoProviders: [] });
    await expect(probeSsoProvidersPresence(empty.engine)).resolves.toBe('absent');
  });

  it('no engine, or a store that throws ⇒ `unknown`, and it never throws', async () => {
    await expect(probeSsoProvidersPresence(undefined)).resolves.toBe('unknown');
    const thrower: BootProbeEngine = {
      async find() { throw new Error('store refused sys_sso_provider'); },
    };
    await expect(probeSsoProvidersPresence(thrower)).resolves.toBe('unknown');
  });

  it('`unknown` keeps the report LOUD — an unreadable store proves no path', async () => {
    const thrower: BootProbeEngine = {
      async find() { throw new Error('store refused sys_sso_provider'); },
    };
    const wiring = await probeSignInPathWiring(DEAD_END, { features: { sso: true } }, thrower);
    expect(wiring.enterpriseSso).toBe(false);
    expect(resolveNoSignInAccountReport(DEAD_END, wiring)).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);
  });

  it('is NOT read on a boot that could never report', async () => {
    // Not the dead-end shape ⇒ the wiring cannot change anything ⇒ no read.
    const { engine, reads } = engineOver({ ssoProviders: [{ id: 'ssop_1' }] });
    const wiring = await probeSignInPathWiring(
      { humanUsers: 'present', signInAccounts: 'present' },
      { features: { sso: true } },
      engine,
    );
    expect(wiring.enterpriseSso).toBe(false);
    expect(reads).toEqual([]);
  });

  it('is NOT read when a delegated path is already proven from config', async () => {
    const { engine, reads } = engineOver({ ssoProviders: [{ id: 'ssop_1' }] });
    await probeSignInPathWiring(DEAD_END, { features: { sso: true, ssoEnforced: true } }, engine);
    expect(reads).toEqual([]);

    await probeSignInPathWiring(
      DEAD_END,
      { features: { sso: true }, socialProviders: [{ id: 'google' }] },
      engine,
    );
    expect(reads).toEqual([]);
  });

  it('is not read at all when the SSO plugin is off', async () => {
    const { engine, reads } = engineOver({ ssoProviders: [{ id: 'ssop_1' }] });
    const wiring = await probeSignInPathWiring(DEAD_END, { features: { sso: false } }, engine);
    expect(wiring).toEqual(NOTHING_WIRED);
    expect(reads).toEqual([]);
  });

  it('an absent public config reads as NOTHING configured — the loud default', async () => {
    const { engine } = engineOver({ ssoProviders: [{ id: 'ssop_1' }] });
    await expect(probeSignInPathWiring(DEAD_END, undefined, engine)).resolves.toEqual(NOTHING_WIRED);
  });
});
