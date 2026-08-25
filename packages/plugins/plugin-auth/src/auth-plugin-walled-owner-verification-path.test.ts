// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11640] The boot-time warning for a walled deployment that declares a
 * platform owner it can never verify — maintainer ruling 2026-08-25 (option
 * A, verbatim 「全部同意」).
 *
 * ⛔ Nothing here may become a refusal: boot proceeds in EVERY shape below,
 * including the one that warns. The two refusals around this check
 * (`walled_owner_email_undeclared` at boot, `walled_owner_not_verified` at
 * elevation) are pinned by their own suites and are untouched.
 *
 * The load-bearing half of this file is the CONTROLS. A warning that fires on
 * every boot satisfies "the dead-end shape warns" just as well as a correct
 * one does, so each neighbouring shape — a transport wired, a federated
 * sign-in wired, an unwalled posture, an undeclared owner, and the dev/harness
 * boot that verifies its own seeded owner — is pinned SILENT.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthPlugin } from './auth-plugin';
import {
  WALLED_OWNER_NO_VERIFICATION_PATH,
  resolveWalledOwnerVerificationPathWarning,
  warnIfWalledOwnerCannotVerify,
} from './walled-owner-verification-path';
import type { PluginContext } from '@objectstack/core';

const OWNER = 'operator@corp.example';
const DEV_SEED_ADMIN = 'admin@objectos.ai';

/** No transport, no federated sign-in — the shape the ruling is about. */
const NOTHING_WIRED = { hasEmailTransport: false, hasFederatedSignIn: false } as const;

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

/** The ruled dead end: walled posture, owner declared. */
const walledWithDeclaredOwner = (posture = 'isolated', owner = OWNER) => {
  process.env.OS_TENANCY_POSTURE = posture;
  process.env.OS_PLATFORM_OWNER_EMAIL = owner;
};

describe('#11640 — the dead-end shape warns, by name and with the remedy', () => {
  it('walled + owner declared + no transport + no federated sign-in produces the named warning', () => {
    walledWithDeclaredOwner();
    const msg = resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED);
    expect(msg).toBeTruthy();
    expect(msg).toContain(WALLED_OWNER_NO_VERIFICATION_PATH);
    // Names the posture and the declared owner, so an operator reading one
    // line knows which deployment and which address.
    expect(msg).toContain("'isolated'");
    expect(msg).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect(msg).toContain(OWNER);
  });

  it('the warning NAMES BOTH REMEDIES — the card is only closed if it is actionable', () => {
    walledWithDeclaredOwner();
    const msg = resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)!;
    // (1) the email transport, named concretely enough to act on
    expect(msg).toContain('EMAIL TRANSPORT');
    expect(msg).toContain('OS_EMAIL_');
    // (2) the federated sign-in, likewise
    expect(msg).toContain('FEDERATED SIGN-IN');
    expect(msg).toContain('OS_SSO_ENABLED');
    expect(msg).toContain('GOOGLE_CLIENT_ID');
    // Either input alone is enough, and the text says so — otherwise the
    // operator wires both, or reads the docs to find out. C is subsumed by A
    // exactly here.
    expect(msg).toContain('Either one alone clears this');
    // …and it says what goes wrong if nothing is wired, in the vocabulary of
    // the refusal the owner will actually hit.
    expect(msg).toContain('walled_owner_not_verified');
  });

  it('⛔ it is a WARNING, never a refusal — the text promises boot continues', () => {
    walledWithDeclaredOwner();
    const msg = resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)!;
    expect(msg).toContain('Boot continues');
    expect(msg).not.toContain('Refusing to boot');
    expect(msg).not.toContain('REFUSING');
  });

  it('the other walled posture (`group`) is covered, and names itself', () => {
    walledWithDeclaredOwner('group');
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toContain("'group'");
  });

  it('the legacy boolean spelling of a wall (OS_MULTI_ORG_ENABLED=true) is covered too', () => {
    process.env.OS_MULTI_ORG_ENABLED = 'true';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toContain(
      WALLED_OWNER_NO_VERIFICATION_PATH,
    );
  });
});

describe('#11640 — controls: every neighbouring shape stays SILENT', () => {
  it('an email transport is wired ⇒ the verification link can be delivered ⇒ no warning', () => {
    walledWithDeclaredOwner();
    expect(
      resolveWalledOwnerVerificationPathWarning({
        hasEmailTransport: true,
        hasFederatedSignIn: false,
      }),
    ).toBeNull();
  });

  it('a federated sign-in is wired ⇒ the owner can arrive already verified ⇒ no warning', () => {
    walledWithDeclaredOwner();
    expect(
      resolveWalledOwnerVerificationPathWarning({
        hasEmailTransport: false,
        hasFederatedSignIn: true,
      }),
    ).toBeNull();
  });

  it('an UNWALLED posture never warns — `single` still promotes the first human user', () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toBeNull();
  });

  it('an UNDECLARED owner is not this check\'s business — `init()` already refused that boot', () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toBeNull();
    process.env.OS_PLATFORM_OWNER_EMAIL = '   ';
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toBeNull();
  });

  it('a dev/harness boot that seeds THIS owner verifies it at startup ⇒ no warning', () => {
    // The dev-admin seed provisions the declared owner and stamps it
    // `email_verified` (#11343), which is a verification path even with no
    // mailbox anywhere — the verify harness boots exactly this shape.
    process.env.NODE_ENV = 'development';
    walledWithDeclaredOwner('isolated', DEV_SEED_ADMIN);
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toBeNull();

    // …and it follows the seed's own address knob, not a hard-coded default.
    process.env.OS_SEED_ADMIN_EMAIL = 'seeded-owner@corp.example';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'seeded-owner@corp.example';
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toBeNull();
  });

  it('…but a dev boot whose declared owner is NOT the seeded one is a real dead end', () => {
    process.env.NODE_ENV = 'development';
    walledWithDeclaredOwner('isolated', OWNER); // seed provisions admin@objectos.ai
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toContain(
      WALLED_OWNER_NO_VERIFICATION_PATH,
    );
  });

  it('…and a dev boot with the seed switched OFF gets no free pass either', () => {
    process.env.NODE_ENV = 'development';
    process.env.OS_SEED_ADMIN = '0';
    walledWithDeclaredOwner('isolated', DEV_SEED_ADMIN);
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toContain(
      WALLED_OWNER_NO_VERIFICATION_PATH,
    );
  });
});

describe('#11640 — the emitter logs once, on the channel `serve` replays', () => {
  it('warns exactly once and returns what it logged', () => {
    walledWithDeclaredOwner();
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const returned = warnIfWalledOwnerCannotVerify(NOTHING_WIRED, logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain(WALLED_OWNER_NO_VERIFICATION_PATH);
    expect(returned).toBe(logger.warn.mock.calls[0][0]);
    // `warn`, not `error`: the ruling is a warning, and #4012's boot-log
    // capture replays `warn` records into the startup banner.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a control shape logs nothing at all', () => {
    walledWithDeclaredOwner();
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    expect(
      warnIfWalledOwnerCannotVerify({ hasEmailTransport: true, hasFederatedSignIn: false }, logger),
    ).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a logger that throws cannot break the boot', () => {
    walledWithDeclaredOwner();
    const logger = { warn: () => { throw new Error('sink is down'); } };
    expect(() => warnIfWalledOwnerCannotVerify(NOTHING_WIRED, logger)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Wired at boot, not merely written: the check has to run from the plugin's
// own `kernel:ready` hook, or none of the above ever reaches an operator.
// ---------------------------------------------------------------------------

type Hooked = { event: string; handler: (...a: unknown[]) => unknown };

const makeCtx = (services: Record<string, unknown> = {}) => {
  const hooks: Hooked[] = [];
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      return services[name];
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

describe('#11640 — the check is wired into AuthPlugin boot', () => {
  const plugin = () =>
    new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', registerRoutes: false });

  it('a walled boot with nothing wired emits the named warning from kernel:ready', async () => {
    walledWithDeclaredOwner();
    const { ctx, hooks, logger } = makeCtx();
    const p = plugin();
    await p.init(ctx);
    await p.start(ctx);
    await runKernelReady(hooks);
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(1);
  });

  it('control — the same boot with an `email` service registered stays silent', async () => {
    walledWithDeclaredOwner();
    const { ctx, hooks, logger } = makeCtx({ email: { sendTemplate: vi.fn() } });
    const p = plugin();
    await p.init(ctx);
    await p.start(ctx);
    await runKernelReady(hooks);
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });

  it('control — the same boot with a social provider configured stays silent', async () => {
    walledWithDeclaredOwner();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    const { ctx, hooks, logger } = makeCtx();
    const p = plugin();
    await p.init(ctx);
    await p.start(ctx);
    await runKernelReady(hooks);
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });

  it('control — an unwalled boot never warns, whatever is (not) wired', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    const { ctx, hooks, logger } = makeCtx();
    const p = plugin();
    await p.init(ctx);
    await p.start(ctx);
    await runKernelReady(hooks);
    const warned = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes(WALLED_OWNER_NO_VERIFICATION_PATH))).toHaveLength(0);
  });
});
