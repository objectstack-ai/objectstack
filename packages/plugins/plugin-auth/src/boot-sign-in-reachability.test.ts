// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14353] The boot-time report for a deployment that seeded people and no
 * logins — human `sys_user` rows, zero `sys_account` rows.
 *
 * ⛔ Nothing here may become a refusal, and nothing here changes an admission
 * decision: boot proceeds in EVERY shape below, including the one that
 * reports. #14349's posture question (should the bootstrap carve-out count
 * humans or logins) was ruled A on 2026-09-02 — the door does not move — and
 * this suite asserts only what is REPORTED.
 *
 * The load-bearing half of this file is the CONTROLS. A report that fires on
 * every boot satisfies "the dead-end shape reports" just as well as a correct
 * one does, so each neighbouring shape is pinned SILENT: an account exists, no
 * humans exist, and either fact unanswerable.
 *
 * The other load-bearing half is INDEPENDENCE. The neighbouring [#11640]
 * walled-owner reporter only runs when all four of {no email transport, no
 * federated sign-in, walled tenancy posture, declared platform owner} hold.
 * This report shares that hook but none of those preconditions, and the
 * `independent of the walled-owner preconditions` describe pins that as
 * behaviour rather than as prose — a deployment that is unwalled, declares no
 * owner, or wires an email transport is just as unrecoverable and must still
 * be told.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AUDIENCE_POSTURES,
  SystemObjectName,
  type AudiencePosture,
} from '@objectstack/spec/system';
import { AuthPlugin } from './auth-plugin';
import { AuthManager } from './auth-manager';
import {
  decideAudienceAdmission,
  EMAIL_DOMAIN_NOT_ALLOWED,
  SELF_REGISTRATION_CLOSED,
} from './audience-posture';
import {
  NO_SIGN_IN_ACCOUNT_AT_BOOT,
  HUMAN_POPULATION_PROBE_LIMIT,
  probeHumanUsersPresence,
  probeSignInAccountsPresence,
  probeSignInReachability,
  resolveNoSignInAccountReport,
  reportIfNoSignInAccountExists,
  type BootProbeEngine,
  type SignInReachabilityFacts,
} from './boot-sign-in-reachability';
import { WALLED_OWNER_NO_VERIFICATION_PATH } from './walled-owner-verification-path';
import type { PluginContext } from '@objectstack/core';

const DEAD_END: SignInReachabilityFacts = { humanUsers: 'present', signInAccounts: 'absent' };

const ENV_KEYS = [
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SSO_ENABLED',
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
// A fake store that RECORDS its reads — the page-read count is an assertion
// here, not an implementation detail (the addendum forbids a second prober
// that duplicates the page read, and only a call count can pin that).
// ---------------------------------------------------------------------------

type Store = { users?: Record<string, unknown>[]; accounts?: Record<string, unknown>[] };

const engineOver = (store: Store, opts: { throwOn?: string } = {}) => {
  const reads: { object: string; query: Record<string, unknown> }[] = [];
  const engine: BootProbeEngine = {
    async find(object, query) {
      reads.push({ object, query });
      if (opts.throwOn === object) throw new Error(`store refused ${object}`);
      const rows = object === 'sys_user' ? (store.users ?? []) : (store.accounts ?? []);
      const limit = typeof query.limit === 'number' ? query.limit : rows.length;
      return rows.slice(0, limit);
    },
  };
  return { engine, reads };
};

const human = (i: number) => ({ id: `usr_${i}`, email: `person${i}@corp.example`, role: 'user' });
const HUMANS = [human(1), human(2), human(3)];

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

describe('#14353 — the dead-end shape reports, by name, with consequence AND remedy', () => {
  it('humans present + zero accounts produces the named report', () => {
    const msg = resolveNoSignInAccountReport(DEAD_END);
    expect(msg).toBeTruthy();
    expect(msg).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);
    // Names both tables, so an operator reading one line knows what to look at.
    expect(msg).toContain('sys_user');
    expect(msg).toContain('sys_account');
  });

  it('the report NAMES THE CONSEQUENCE — unrecoverable, and healthy-looking', () => {
    const msg = resolveNoSignInAccountReport(DEAD_END)!;
    expect(msg).toContain('NOBODY CAN SIGN IN');
    expect(msg).toContain('CANNOT BE RECOVERED FROM INSIDE');
    // The silent half: the deployment keeps LOOKING fine, which is why this
    // has to be said at boot rather than left to the 401.
    expect(msg.toLowerCase()).toContain('looking healthy');
    expect(msg).toContain('401');
  });

  it('[#15588] NAMES THE REMEDY THAT WORKS, and warns off the two that do not', () => {
    const msg = resolveNoSignInAccountReport(DEAD_END)!;
    // The primary way out, spelled as the one row an operator has to write.
    expect(msg).toContain('INVITE ONE ADDRESS');
    expect(msg).toContain(SystemObjectName.INVITATION);
    expect(msg).toContain("'pending'");
    expect(msg).toContain('expires_at');
    expect(msg).toContain('inviter_id');
    // The two that LOOK like remedies. The self-silencing clause is the one
    // that must never be dropped for brevity: an operator who is going to
    // hand-write a row anyway needs to know it blinds the probe.
    expect(msg).toContain('SILENCES THIS REPORT');
    expect(msg).toContain('EMAIL_NOT_VERIFIED');
    // Real posture spellings from the spec vocabulary, not invented ones.
    expect(msg).toContain("'open'");
    expect(msg).toContain("'email_domain'");
  });

  it('[#15588] says NOTHING about what a SEEDED person\u2019s own re-registration answers', () => {
    // That response is #15587's surface and is being changed (a sign-up for an
    // address that already carries a `sys_user` row currently answers 200 and
    // persists nothing; it is becoming an explicit refusal). A boot line that
    // asserted either behaviour would be stale the day that lands, so this
    // message is written to be true on BOTH sides of it and this pin holds it
    // there.
    const msg = resolveNoSignInAccountReport(DEAD_END)!;
    expect(msg).not.toContain('USER_ALREADY_EXISTS');
    expect(msg).not.toMatch(/persists nothing|answers 200|silently|no new row/i);
  });

  it('names WHY the bootstrap carve-out does not rescue this deployment', () => {
    // The #14349 ruling (option A, 2026-09-02) licensed saying plainly that
    // the door stays shut; a remedy clause that implied the next visitor
    // would be admitted would be wrong under the ruling as given.
    const msg = resolveNoSignInAccountReport(DEAD_END)!;
    expect(msg).toContain('counts HUMANS');
    expect(msg).toContain('SELF_REGISTRATION_CLOSED');
    expect(msg).toContain('invite_only');
  });
});

describe('#14353 — the controls: every other shape is SILENT', () => {
  it('NEGATIVE CONTROL — an account exists ⇒ silent', () => {
    expect(
      resolveNoSignInAccountReport({ humanUsers: 'present', signInAccounts: 'present' }),
    ).toBeNull();
  });

  it('no human users ⇒ silent (a fresh store is healthy; its bootstrap is still ahead)', () => {
    expect(
      resolveNoSignInAccountReport({ humanUsers: 'absent', signInAccounts: 'absent' }),
    ).toBeNull();
  });

  it('an unanswerable human read ⇒ silent — this report makes a positive claim or none', () => {
    expect(
      resolveNoSignInAccountReport({ humanUsers: 'unknown', signInAccounts: 'absent' }),
    ).toBeNull();
  });

  it('an unanswerable account read ⇒ silent', () => {
    expect(
      resolveNoSignInAccountReport({ humanUsers: 'present', signInAccounts: 'unknown' }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// [#15588] The remedy clauses, pinned against the BEHAVIOUR each one describes
//
// A `toContain` on this message proves only that somebody typed the words —
// and the defect this card closes was a message whose sentences were FALSE
// while every string assertion around them stayed green. So each pin below
// drives the mechanism its sentence rests on. Each one fails the day that
// remedy stops working, which is precisely the day the sentence has to be
// rewritten.
//
// ⛔ Nothing here changes an admission decision: these call the existing
// pure decision function and the existing probe, and assert.
// ---------------------------------------------------------------------------

describe('#15588 — the named remedy WORKS: a pending invitation is admitted under EVERY posture', () => {
  /**
   * A self-serve sign-up by the invited address, judged by the real gate.
   * The `email_domain` allowlist deliberately holds a DIFFERENT domain, so an
   * admission under that posture can only have come from the invitation
   * carve-out and never from the domain list.
   */
  const invitedSignUp = (posture: AudiencePosture, hasPendingInvitation: boolean) =>
    decideAudienceAdmission({
      audience: { posture, allowedEmailDomains: ['not-the-invitee.example'] },
      creationClass: 'self-serve',
      email: 'recovery@example.com',
      hasPendingInvitation,
      isBootstrap: false,
    });

  it('every posture in the vocabulary admits it — the message says "under EVERY audience posture"', () => {
    // Reading the vocabulary rather than listing it: a posture added later is
    // covered on the day it is added, and the message's "EVERY" stays honest.
    expect(AUDIENCE_POSTURES.length).toBeGreaterThan(1);
    for (const posture of AUDIENCE_POSTURES) {
      expect(invitedSignUp(posture, true), `posture ${posture}`).toMatchObject({ admit: true });
    }
  });

  it('CONTROL — the same sign-up WITHOUT the invitation row is refused', () => {
    // Without this, the pin above would read green on a gate that admitted
    // everybody, and the message would be recommending a row nobody needs.
    expect(invitedSignUp('invite_only', false)).toMatchObject({
      admit: false,
      code: SELF_REGISTRATION_CLOSED,
    });
    expect(invitedSignUp('email_domain', false)).toMatchObject({
      admit: false,
      code: EMAIL_DOMAIN_NOT_ALLOWED,
    });
  });

  it('CONTROL — the carve-out is what admits it, not the creation class', () => {
    // `self-serve` is the posture-gated class; an operator/provider creation
    // is exempt for its own reason and would mask a dead carve-out.
    expect(invitedSignUp('invite_only', true)).toMatchObject({ admit: true });
    expect(
      decideAudienceAdmission({
        audience: { posture: 'invite_only', allowedEmailDomains: [] },
        creationClass: 'self-serve',
        email: 'recovery@example.com',
        hasPendingInvitation: false,
        isBootstrap: false,
      }),
    ).toMatchObject({ admit: false });
  });
});

describe('#15588 — the WARNING is true: ANY hand-written `sys_account` row silences this report', () => {
  it('one credential row — plaintext password and all — turns the report OFF', async () => {
    // This is the sentence "writing ANY sys_account row SILENCES THIS REPORT,
    // which asks only whether such a row EXISTS". If the probe is ever
    // tightened (a separate card — it would move #14353's diagnostic
    // semantics), this pin fails and the message clause must be rewritten.
    const handWritten = {
      id: 'acc_handwritten',
      user_id: 'usr_1',
      provider_id: 'credential',
      password: 'a-plaintext-password-that-authenticates-nothing',
    };
    const { engine } = engineOver({ users: HUMANS, accounts: [handWritten] });
    const facts = await probeSignInReachability(engine);
    expect(facts).toEqual({ humanUsers: 'present', signInAccounts: 'present' });
    expect(resolveNoSignInAccountReport(facts)).toBeNull();
  });

  it('CONTROL — the identical store WITHOUT that row still reports', async () => {
    const { engine } = engineOver({ users: HUMANS, accounts: [] });
    const facts = await probeSignInReachability(engine);
    expect(facts).toEqual({ humanUsers: 'present', signInAccounts: 'absent' });
    expect(resolveNoSignInAccountReport(facts)).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);
  });
});

describe('#15588 — the WARNING is true: widening the posture FORCES email verification on', () => {
  const SECRET = 'test-secret-at-least-32-chars-long!!';
  const managerWith = (audience?: Record<string, unknown>) =>
    new AuthManager({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      dataEngine: engineOver({}).engine,
      ...(audience ? { audience } : {}),
    } as never);

  it('`email_domain` and `open` both wire requireEmailVerification ON', () => {
    // The manager forces it from `audiencePermitsSelfRegistration(posture)` and
    // `getPublicConfig()` mirrors the wired flag, so this is the same fact the
    // message reports: a login registered under a widened posture cannot sign
    // in until a mail transport delivers the link.
    for (const posture of ['email_domain', 'open'] as const) {
      const manager = managerWith({
        posture,
        ...(posture === 'email_domain' ? { allowedEmailDomains: ['acme.example'] } : {}),
        selfRegistrationPermissionSet: 'member_default',
      });
      expect(
        manager.getPublicConfig().emailPassword.requireEmailVerification,
        `posture ${posture}`,
      ).toBe(true);
    }
  });

  it('CONTROL — the default `invite_only` posture does NOT force it', () => {
    // The forcing is a property of WIDENING, not a constant `true` the pin
    // above would be satisfied by either way.
    expect(managerWith().getPublicConfig().emailPassword.requireEmailVerification).toBe(false);
  });

  it("every posture other than 'invite_only' is one that widens — the message's exact claim", () => {
    // The message says "every posture other than 'invite_only'". A fourth
    // posture that did NOT permit self-registration would make that sentence
    // wrong, and this is where that is caught.
    for (const posture of AUDIENCE_POSTURES) {
      expect(
        (managerWith(
          posture === 'invite_only'
            ? undefined
            : {
                posture,
                ...(posture === 'email_domain' ? { allowedEmailDomains: ['acme.example'] } : {}),
                selfRegistrationPermissionSet: 'member_default',
              },
        ).getPublicConfig().emailPassword.requireEmailVerification),
        `posture ${posture}`,
      ).toBe(posture !== 'invite_only');
    }
  });
});

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

describe('#14353 — the probe reads humans, not rows', () => {
  it('a store holding only the legacy `usr_system` service row has NO humans', async () => {
    const { engine } = engineOver({ users: [{ id: 'usr_system', role: 'system' }] });
    await expect(probeHumanUsersPresence(engine)).resolves.toBe('absent');
  });

  it('a full page of non-humans reads as POPULATED — it cannot prove absence', async () => {
    const users = Array.from({ length: HUMAN_POPULATION_PROBE_LIMIT }, () => ({
      id: 'usr_system',
      role: 'system',
    }));
    const { engine } = engineOver({ users });
    await expect(probeHumanUsersPresence(engine)).resolves.toBe('present');
  });

  it('ANY `sys_account` row counts — provider, issuer and ban state are not asked about', async () => {
    const { engine } = engineOver({ accounts: [{ id: 'acc_1', provider_id: 'anything' }] });
    await expect(probeSignInAccountsPresence(engine)).resolves.toBe('present');
  });

  it('no engine ⇒ `unknown` on both facts, never a false `absent`', async () => {
    await expect(probeHumanUsersPresence(undefined)).resolves.toBe('unknown');
    await expect(probeSignInAccountsPresence(undefined)).resolves.toBe('unknown');
  });

  it('a store that throws ⇒ `unknown`, and the probe never throws', async () => {
    const { engine } = engineOver({ users: HUMANS }, { throwOn: 'sys_user' });
    await expect(probeHumanUsersPresence(engine)).resolves.toBe('unknown');
  });

  it('the reachability pass skips the account read when no human was seen', async () => {
    const { engine, reads } = engineOver({ users: [], accounts: [] });
    await expect(probeSignInReachability(engine)).resolves.toEqual({
      humanUsers: 'absent',
      signInAccounts: 'unknown',
    });
    expect(reads.map((r) => r.object)).toEqual(['sys_user']);
  });

  it('the reachability pass reads BOTH tables once when humans exist', async () => {
    const { engine, reads } = engineOver({ users: HUMANS, accounts: [] });
    await expect(probeSignInReachability(engine)).resolves.toEqual({
      humanUsers: 'present',
      signInAccounts: 'absent',
    });
    expect(reads.map((r) => r.object)).toEqual(['sys_user', 'sys_account']);
    // Bounded: one page of users, one row of accounts.
    expect(reads[0].query.limit).toBe(HUMAN_POPULATION_PROBE_LIMIT);
    expect(reads[1].query.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The emitter and its sink
// ---------------------------------------------------------------------------

describe('#14353 — the emitter logs ONCE, at `error`, and survives a broken sink', () => {
  it('reports at `error` — the consequence is unrecoverable, not degraded', () => {
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const returned = reportIfNoSignInAccountExists(DEAD_END, logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);
    expect(returned).toBe(logger.error.mock.calls[0][0]);
    // Not both channels — one report, one line.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a sink that declares only `warn` still HEARS this — the fallback is explicit', () => {
    // The #13398-class ruling forbids growing `error?` onto a published sink
    // that lacks it. A bare `error?.(…)` against such a sink emits NOTHING,
    // which would make this report silent on exactly the hosts that publish
    // the narrower shape; the explicit branch is what stops that.
    const warnOnly = { warn: vi.fn() };
    const returned = reportIfNoSignInAccountExists(DEAD_END, warnOnly);
    expect(warnOnly.warn).toHaveBeenCalledTimes(1);
    expect(String(warnOnly.warn.mock.calls[0][0])).toContain(NO_SIGN_IN_ACCOUNT_AT_BOOT);
    expect(returned).toBeTruthy();
  });

  it('a control shape logs nothing at all', () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    expect(
      reportIfNoSignInAccountExists({ humanUsers: 'present', signInAccounts: 'present' }, logger),
    ).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a logger that throws cannot break the boot', () => {
    // `warn` is REQUIRED by the sink contract (#9754), so the double carries a
    // real one rather than a cast — a cast here would re-open exactly the hole
    // `check:optional-error-sink` closes. The throwing `error` is still the
    // channel this case exercises: the emitter picks `error` when present, so
    // `warn` must stay untouched while the boot survives.
    const warn = vi.fn();
    const logger = {
      warn,
      error: () => {
        throw new Error('sink is down');
      },
    };
    expect(() => reportIfNoSignInAccountExists(DEAD_END, logger)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('no logger at all is not an error', () => {
    expect(reportIfNoSignInAccountExists(DEAD_END)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Wired at boot, not merely written.
// ---------------------------------------------------------------------------

type Hooked = { event: string; handler: (...a: unknown[]) => unknown };

const makeCtx = (services: Record<string, unknown> = {}) => {
  const hooks: Hooked[] = [];
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name in services) return services[name];
      // The real `PluginContext.getService` THROWS on an unregistered name,
      // and the hook under test wraps its `objectql` lookup in a try/catch
      // for exactly that. Thrown here so the absence case exercises the
      // catch; every other absence stays `undefined`, as the sibling
      // walled-owner harness has it, because `init()` reads several.
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

const bootWith = async (store: Store, env: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { engine, reads } = engineOver(store);
  const { ctx, hooks, logger } = makeCtx({ objectql: engine });
  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long',
    registerRoutes: false,
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await runKernelReady(hooks);
  const said = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => String(c[0]));
  return { logger, reads, errors: said(logger.error), warnings: said(logger.warn) };
};

describe('#14353 — the report is wired into AuthPlugin boot', () => {
  it('human rows and zero accounts emit the named ERROR from kernel:ready', async () => {
    const { errors } = await bootWith({ users: HUMANS, accounts: [] });
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(1);
  });

  it('NEGATIVE CONTROL — one account exists and the boot is silent', async () => {
    const { errors, warnings } = await bootWith({
      users: HUMANS,
      accounts: [{ id: 'acc_1', user_id: 'usr_1' }],
    });
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(0);
    expect(warnings.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(0);
  });

  it('an empty store is silent — a fresh deployment is not a dead end', async () => {
    const { errors } = await bootWith({ users: [], accounts: [] });
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(0);
  });

  it('a boot with no `objectql` service is silent, and does not throw', async () => {
    const { ctx, hooks, logger } = makeCtx();
    const plugin = new AuthPlugin({
      secret: 'test-secret-at-least-32-chars-long',
      registerRoutes: false,
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
    await expect(runKernelReady(hooks)).resolves.toBeUndefined();
    expect(
      logger.error.mock.calls.map((c) => String(c[0])).filter((m) =>
        m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Independence — the reason this card is not subsumed by its neighbour.
// ---------------------------------------------------------------------------

describe('#14353 — independent of ALL FOUR walled-owner preconditions', () => {
  // The neighbour runs only when: no email transport, no federated sign-in,
  // a walled tenancy posture, AND a declared platform owner. Each case below
  // BREAKS one of those four and still demands the report.

  it('UNWALLED (`single`) — the neighbour never runs; this still reports', async () => {
    const { errors, warnings } = await bootWith(
      { users: HUMANS, accounts: [] },
      { OS_TENANCY_POSTURE: 'single', OS_PLATFORM_OWNER_EMAIL: 'owner@corp.example' },
    );
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(1);
    expect(warnings.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });

  it('NO DECLARED OWNER, DEFAULT POSTURE — the plain deployment still reports', async () => {
    // Measured while writing this suite: breaking the declared-owner
    // precondition ALONE is an unreachable boot — a walled posture with
    // `OS_PLATFORM_OWNER_EMAIL` unset REFUSES STARTUP in `init()` (#11184,
    // pinned by `auth-plugin-walled-owner-boot-refusal.test.ts`), so there is
    // no such deployment to diagnose. The reachable shape that carries no
    // declared owner is the DEFAULT one — no tenancy posture, no owner, no
    // transport, no SSO — which is also the commonest real deployment and the
    // one the card's scenario was measured on.
    const { errors, warnings } = await bootWith({ users: HUMANS, accounts: [] });
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(1);
    expect(warnings.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });

  it('AN EMAIL TRANSPORT IS WIRED — the neighbour stays quiet; this still reports', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'owner@corp.example';
    const { engine } = engineOver({ users: HUMANS, accounts: [] });
    const { ctx, hooks, logger } = makeCtx({
      objectql: engine,
      email: { send: vi.fn(), sendMail: vi.fn() },
    });
    const plugin = new AuthPlugin({
      secret: 'test-secret-at-least-32-chars-long',
      registerRoutes: false,
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
    await runKernelReady(hooks);
    const errors = logger.error.mock.calls.map((c) => String(c[0]));
    const warnings = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(1);
    expect(warnings.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });

  it('FEDERATED SIGN-IN IS WIRED — the neighbour stays quiet; this still reports', async () => {
    const { errors, warnings } = await bootWith(
      { users: HUMANS, accounts: [] },
      {
        OS_TENANCY_POSTURE: 'isolated',
        OS_PLATFORM_OWNER_EMAIL: 'owner@corp.example',
        OS_SSO_ENABLED: '1',
      },
    );
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(1);
    expect(warnings.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// One report per boot, and one page read per boot.
// ---------------------------------------------------------------------------

describe('#14353 — a deployment matching BOTH shapes gets exactly one report', () => {
  it('the no-sign-in error fires and the walled-owner warning is SUPPRESSED', async () => {
    // Walled, owner declared, nothing wired, humans present, zero accounts:
    // the neighbour's `owner-absent` shape AND this card's shape at once.
    const { errors, warnings } = await bootWith(
      { users: HUMANS, accounts: [] },
      { OS_TENANCY_POSTURE: 'isolated', OS_PLATFORM_OWNER_EMAIL: 'owner@corp.example' },
    );
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(1);
    expect(warnings.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });

  it('the neighbour is UNTOUCHED when this report did not fire', async () => {
    // Same walled dead end, but an account exists — so only the neighbour
    // has anything to say, and it still says it.
    const { errors, warnings } = await bootWith(
      { users: HUMANS, accounts: [{ id: 'acc_1' }] },
      { OS_TENANCY_POSTURE: 'isolated', OS_PLATFORM_OWNER_EMAIL: 'owner@corp.example' },
    );
    expect(errors.filter((m) => m.includes(NO_SIGN_IN_ACCOUNT_AT_BOOT))).toHaveLength(0);
    expect(warnings.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(1);
  });

  it('`sys_user` is paged ONCE per boot even when BOTH probes need the answer', async () => {
    // The addendum's hard constraint: no second prober duplicating the page
    // read. The walled-owner probe takes the answer this pass already has.
    const { reads } = await bootWith(
      { users: HUMANS, accounts: [] },
      { OS_TENANCY_POSTURE: 'isolated', OS_PLATFORM_OWNER_EMAIL: 'owner@corp.example' },
    );
    const userPages = reads.filter(
      (r) => r.object === 'sys_user' && r.query.limit === HUMAN_POPULATION_PROBE_LIMIT,
    );
    expect(userPages).toHaveLength(1);
  });
});
