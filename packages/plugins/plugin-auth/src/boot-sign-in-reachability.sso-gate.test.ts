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
import { NO_SIGN_IN_ACCOUNT_AT_BOOT } from './boot-sign-in-reachability';
import type { BootProbeEngine } from './boot-sign-in-reachability';
import type { PluginContext } from '@objectstack/core';

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
});
