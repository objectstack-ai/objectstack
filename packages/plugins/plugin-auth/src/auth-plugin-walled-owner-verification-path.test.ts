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
 *
 * [#12751] (maintainer ruling 2026-08-28, 「运营方创建即视为已验证」): the
 * operator-provisioning stamp is itself a verification path, so the firing
 * now follows the OWNER ACCOUNT STATE the caller probes — a fresh walled
 * boot with nothing wired is SILENT (its owner's first-account creation
 * arrives verified), while an owner account already existing unverified, a
 * populated store with no owner account, and an unanswerable probe keep
 * warning. The `#12751` describe below is that two-sided contract's pin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthPlugin } from './auth-plugin';
import {
  WALLED_OWNER_NO_VERIFICATION_PATH,
  resolveWalledOwnerVerificationPathWarning,
  warnIfWalledOwnerCannotVerify,
  type WalledOwnerAccountState,
} from './walled-owner-verification-path';
import type { PluginContext } from '@objectstack/core';

const OWNER = 'operator@corp.example';
const DEV_SEED_ADMIN = 'admin@objectos.ai';

/**
 * No transport, no federated sign-in, with the caller-resolved owner account
 * state. [#12751] The default state here is `owner-unverified` — the shape
 * that stays a dead end after the operator-provisioning stamp — so every
 * pre-existing "the dead-end shape warns" pin below keeps measuring a real
 * dead end rather than the fresh boot the stamp now covers.
 */
const nothingWired = (ownerAccountState: WalledOwnerAccountState = 'owner-unverified') =>
  ({ hasEmailTransport: false, hasFederatedSignIn: false, ownerAccountState }) as const;
const NOTHING_WIRED = nothingWired();

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

// ---------------------------------------------------------------------------
describe('[#13147] the boot diagnostic under a comma-separated OS_PLATFORM_OWNER_EMAIL', () => {
  const SECOND_OWNER = 'ops@corp.example';
  const OWNER_LIST = `${OWNER}, ${SECOND_OWNER}`;

  it('NAMES each declared administrator instead of printing the raw list in an address slot', () => {
    // The card's fourth reader. It does not COMPARE the value, it PRINTS it —
    // so "correct" here is not the comparators' fix pattern: the line must name
    // the declared set, each member as the operator typed it, in a slot an
    // operator reads as addresses.
    walledWithDeclaredOwner('isolated', OWNER_LIST);
    const msg = resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)!;
    expect(msg).toBeTruthy();
    expect(msg).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect(msg).toContain(OWNER);
    expect(msg).toContain(SECOND_OWNER);
    // Each member named separately — ⛔ not the raw string with its separator
    // swallowed into one address-looking token.
    expect(msg).toContain(`OS_PLATFORM_OWNER_EMAIL=${OWNER}, ${SECOND_OWNER}`);
    expect(msg).toContain(WALLED_OWNER_NO_VERIFICATION_PATH);
  });

  it('prints the entries as TYPED, and only the entries the parse kept', () => {
    // Trailing separators and blank entries are dropped by the parse, so what
    // is printed is exactly the set that was understood — an operator comparing
    // this line to their config can SEE an entry that did not survive.
    walledWithDeclaredOwner('isolated', ` Ops.Lead@Corp.EXAMPLE , ${SECOND_OWNER} ,`);
    const msg = resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)!;
    expect(msg).toContain(`OS_PLATFORM_OWNER_EMAIL=Ops.Lead@Corp.EXAMPLE, ${SECOND_OWNER}`);
  });

  it('the dev-seed silence clause matches ANY declared member, not just the first', () => {
    // `seedStampsDeclaredOwner`: the seed rescues the fresh-store shape when it
    // provisions a declared administrator. Under a list that used to compare
    // the seed address against the whole raw value and never match, so a dev
    // boot warned about a dead end the seed had already closed.
    process.env.NODE_ENV = 'development';
    process.env.OS_SEED_ADMIN = '1';
    walledWithDeclaredOwner('isolated', `${OWNER}, ${DEV_SEED_ADMIN}`);
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'))).toBeNull();
  });

  it('⛔ a REFUSED list declares nobody, so the diagnostic stays silent like an unset variable', () => {
    walledWithDeclaredOwner('isolated', `${OWNER},not-an-email`);
    expect(resolveWalledOwnerVerificationPathWarning(NOTHING_WIRED)).toBeNull();
  });
});

describe('#11640 — controls: every neighbouring shape stays SILENT', () => {
  it('an email transport is wired ⇒ the verification link can be delivered ⇒ no warning', () => {
    walledWithDeclaredOwner();
    // Even against the worst account state: the transport IS the remedy.
    expect(
      resolveWalledOwnerVerificationPathWarning({
        hasEmailTransport: true,
        hasFederatedSignIn: false,
        ownerAccountState: 'owner-unverified',
      }),
    ).toBeNull();
  });

  it('a federated sign-in is wired ⇒ the owner can arrive already verified ⇒ no warning', () => {
    walledWithDeclaredOwner();
    expect(
      resolveWalledOwnerVerificationPathWarning({
        hasEmailTransport: false,
        hasFederatedSignIn: true,
        ownerAccountState: 'owner-unverified',
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
    // mailbox anywhere — the verify harness boots exactly this shape. The
    // seed acts on an empty store, and the harness boots that cannot probe
    // one hand in 'unknown' — both stay silent.
    process.env.NODE_ENV = 'development';
    walledWithDeclaredOwner('isolated', DEV_SEED_ADMIN);
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'))).toBeNull();
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('unknown'))).toBeNull();

    // …and it follows the seed's own address knob, not a hard-coded default.
    process.env.OS_SEED_ADMIN_EMAIL = 'seeded-owner@corp.example';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'seeded-owner@corp.example';
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'))).toBeNull();
  });

  it('…but a dev boot whose declared owner is NOT the seeded one is a real dead end', () => {
    process.env.NODE_ENV = 'development';
    walledWithDeclaredOwner('isolated', OWNER); // seed provisions admin@objectos.ai
    const msg = resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'));
    expect(msg).toContain(WALLED_OWNER_NO_VERIFICATION_PATH);
    // [#12751] …and the message says WHY the first-account stamp cannot help:
    // the armed seed will spend the bootstrap carve-out on its own address.
    expect(msg).toContain(DEV_SEED_ADMIN);
  });

  it('[#12751] …and the seed cannot rescue a store it will never touch — a populated dev boot still warns', () => {
    // The seed acts only on an EMPTY store. An owner account that already
    // exists unverified is past its reach, so even the address-matched dev
    // shape is a real dead end there.
    process.env.NODE_ENV = 'development';
    walledWithDeclaredOwner('isolated', DEV_SEED_ADMIN);
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('owner-unverified'))).toContain(
      WALLED_OWNER_NO_VERIFICATION_PATH,
    );
  });
});

// ---------------------------------------------------------------------------
// [#12751] 「运营方创建即视为已验证」 (maintainer, 2026-08-28): the operator
// provisioning stamp is itself a verification path, so the warning's firing
// now follows the OWNER ACCOUNT STATE — quiet where the stamp (or a finished
// verification) covers the deployment, loud where the store is past the
// stamp's reach.
// ---------------------------------------------------------------------------

describe('#12751 — the warning follows the owner account state', () => {
  it('THE CASE THIS CARD CLOSES: a fresh production walled boot with nothing wired stays SILENT — the operator first-account creation arrives verified', () => {
    walledWithDeclaredOwner();
    // NODE_ENV is production-shaped here (the beforeEach cleared it), so the
    // dev seed is NOT armed — pre-#12751 this exact shape warned on every
    // fresh walled EE deployment following the shipped .env.example.
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('no-human-users'))).toBeNull();
  });

  it('an owner account that exists VERIFIED needs nothing — silent (also on every later boot of a settled deployment)', () => {
    walledWithDeclaredOwner();
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('owner-verified'))).toBeNull();
  });

  it('an owner account that exists UNVERIFIED is the dead end — warns, and names the situation', () => {
    walledWithDeclaredOwner();
    const msg = resolveWalledOwnerVerificationPathWarning(nothingWired('owner-unverified'));
    expect(msg).toContain(WALLED_OWNER_NO_VERIFICATION_PATH);
    expect(msg).toContain('ALREADY EXISTS');
    expect(msg).toContain('walled_owner_not_verified');
  });

  it('a populated store with NO owner account warns — the bootstrap window is spent and an invitee arrives unverified', () => {
    walledWithDeclaredOwner();
    const msg = resolveWalledOwnerVerificationPathWarning(nothingWired('owner-absent'));
    expect(msg).toContain(WALLED_OWNER_NO_VERIFICATION_PATH);
    expect(msg).toContain('UNVERIFIED');
  });

  it('an unanswerable probe warns — noisy over silent about a real dead end (the pre-#12751 posture)', () => {
    walledWithDeclaredOwner();
    expect(resolveWalledOwnerVerificationPathWarning(nothingWired('unknown'))).toContain(
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
      warnIfWalledOwnerCannotVerify(
        { hasEmailTransport: true, hasFederatedSignIn: false, ownerAccountState: 'owner-unverified' },
        logger,
      ),
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
