// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11640] The walled deployment that declares an owner it can never verify.
 *
 * Maintainer ruling 2026-08-25 (decision-inbox batch 5, verbatim: 「全部同意」
 * accepting option **A**): at boot, a walled deployment with
 * `OS_PLATFORM_OWNER_EMAIL` **declared** but **no verification path** — no
 * email transport wired, no trusted federated sign-in — emits a **loud, named
 * warning**, so the operator sees the dead end at deploy time instead of at
 * the owner's rejected registration weeks later.
 *
 * ⛔ **Boot PROCEEDS. This is not a refusal**, and it changes no accept/reject
 * behaviour anywhere. The two fail-closed clauses around it are untouched:
 *   - walled + owner UNDECLARED still REFUSES STARTUP (`auth-plugin.ts`
 *     `init()`, #11184) — this check never runs in that shape, because boot
 *     already aborted;
 *   - walled + owner declared but the account unverified still REFUSES
 *     ELEVATION (`bootstrapPlatformAdmin`, `walled_owner_not_verified`,
 *     #11343) — this check is the *forecast* of that refusal, not a
 *     replacement for it.
 *
 * ## Why the deployment is a dead end
 *
 * #11343 made walled platform-admin elevation require a VERIFIED owner-email
 * match (the string alone proves nothing — anyone who knows the address could
 * register it first). Verification can arrive two ways:
 *
 *   1. an **email transport**, which delivers the verification link, or
 *   2. a **trusted federated sign-in** (enterprise SSO or a social/OIDC
 *      provider), which inserts the account already verified — better-auth
 *      writes `emailVerified: userInfo.emailVerified` straight off the IdP
 *      profile when it creates the user (`better-auth/dist/oauth2/
 *      link-account.mjs`, the new-user branch).
 *
 * With NEITHER wired, the declared owner registers, is refused, and has no
 * in-product way to ever satisfy the condition. Nothing else in the boot path
 * notices: the refusal is correct and the deployment looks healthy until the
 * one account that matters tries to sign in.
 *
 * ## Why the message names the remedy
 *
 * The ruling folded the docs-only option (C) into A: a warning that says "the
 * owner cannot be verified" and stops there sends the operator back to the
 * docs, which is the state this card exists to end. So the text says which
 * inputs are missing and what wiring EITHER of them looks like — one of the
 * two is enough, and the warning says so.
 *
 * ## Why `kernel:ready`, and why `warn`
 *
 * The check runs on `kernel:ready`, not in `init()`, because the email
 * transport is not knowable earlier: `EmailServicePlugin` registers the
 * kernel `email` service after plugin-auth initialises, and plugin-auth wires
 * it into `AuthManager` on its own `kernel:ready` hook. An `init()`-time read
 * would report "no transport" for every deployment that has one — a warning
 * that fires on every boot is the failure mode this check has controls
 * against.
 *
 * `warn` is the loud channel here rather than a quieter one: `os serve`
 * blanks stdout while the kernel boots, and #4012 makes that window a buffer
 * rather than a drain — records at `warn` and above are captured and replayed
 * into the startup banner's boot diagnostics (`collectBootDiagnostics`). A
 * boot-phase `info` is dropped; a boot-phase `warn` reaches the operator's
 * terminal.
 *
 * ## [#12751] The operator-provisioning stamp changed which shapes dead-end
 *
 * Maintainer ruling 2026-08-28 (cloud#1677, 「运营方创建即视为已验证」): the
 * declared owner's account, created through an OPERATOR provisioning path on
 * a walled deployment — the bootstrap first account, admin create-user, SCIM
 * — is stamped `email_verified` AT CREATION (`walled-owner-operator-stamp.ts`).
 * So "no transport and no federated sign-in" is no longer, by itself, a dead
 * end: a FRESH deployment's owner arrives verified through the operator's own
 * first-account creation. What still dead-ends is an owner account that
 * already exists UNVERIFIED (created outside the operator path — before this
 * ruling, or through an invitation-admitted self-registration), or a
 * populated store whose bootstrap window is spent with no owner account in
 * it. Telling those apart requires the one runtime fact the original ruling
 * deliberately left out — whether the declared address is already spoken for
 * — so the caller now probes it ({@link probeWalledOwnerAccountState}) and
 * this predicate reads the result. An unanswerable probe warns (the
 * pre-#12751 behaviour for every shape): a diagnostic that cannot see may be
 * noisy, never silent about a real dead end.
 *
 * ⚠️ **For whoever rewrites this surface** (the #11663 re-anchor legs L2
 * #11970 / L4 #11974, both `pm:blocked` as of 2026-08-25): the decision lives
 * entirely in this module and the call site is one `kernel:ready` hook in
 * `AuthPlugin.start()`. Move the call; the predicate, the probe and the
 * message travel with the file.
 */

import {
  PLATFORM_OWNER_EMAIL_ENV,
  isEmailVerifiedUserRow,
  resolveTenancyPosture,
} from '@objectstack/types';
import { isConfiguredPlatformAdminEmail, resolvePlatformAdminEmails } from '@objectstack/core';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { SystemObjectName } from '@objectstack/spec/system';
import { isHumanUserRow } from './audience-posture.js';

/**
 * The stable NAME of this warning — the "named" half of the ruled "loud, named
 * warning". It leads the message so an operator (or a support thread) can grep
 * one token, the same way the elevation refusals are keyed by
 * `walled_owner_email_undeclared` / `walled_owner_not_verified`.
 */
export const WALLED_OWNER_NO_VERIFICATION_PATH = 'walled_owner_no_verification_path';

/** Default address the dev-admin seed provisions (see {@link devSeedAdminEmail}). */
const DEV_SEED_ADMIN_EMAIL_DEFAULT = 'admin@objectos.ai';

/** `OS_SEED_ADMIN` spellings that turn the dev-admin seed off. */
const DEV_SEED_DISABLED_SPELLINGS = ['0', 'false', 'off', 'no'];

const env = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string | undefined> } })?.process?.env ?? {});

/**
 * The address `AuthPlugin.maybeSeedDevAdmin` provisions. Exported so the seed
 * and this check read ONE resolution: the check treats the seed as a
 * verification path (it stamps the seeded account `email_verified`, #11343),
 * which is only true while both agree on which address gets stamped.
 */
export function devSeedAdminEmail(): string {
  return env().OS_SEED_ADMIN_EMAIL?.trim() || DEV_SEED_ADMIN_EMAIL_DEFAULT;
}

/**
 * Whether the dev-admin seed is armed for this process — HARD-gated to
 * `NODE_ENV==='development'`, opt-out via `OS_SEED_ADMIN=0|false|off|no`.
 * Same two clauses `maybeSeedDevAdmin` gates itself on, read from one place.
 *
 * "Armed" is a statement about CONFIGURATION, not about what the seed will do:
 * it also requires an empty database, which is runtime state neither the seed
 * nor this check can know at this point.
 */
export function isDevAdminSeedArmed(): boolean {
  if (env().NODE_ENV !== 'development') return false;
  const flag = String(env().OS_SEED_ADMIN ?? '').trim().toLowerCase();
  return !DEV_SEED_DISABLED_SPELLINGS.includes(flag);
}

/**
 * [#12751] What the user store says about the declared owner's account at
 * boot — the runtime fact that separates "the operator provisioning path will
 * verify the owner at creation" from a genuine dead end.
 */
export type WalledOwnerAccountState =
  /** Zero human users: the bootstrap first account is still ahead, and an owner-email bootstrap creation is stamped verified. */
  | 'no-human-users'
  /** An account holding the declared address exists and IS verified — nothing left to verify. */
  | 'owner-verified'
  /** An account holding the declared address exists and is NOT verified — created outside the operator path; the dead end. */
  | 'owner-unverified'
  /** Human users exist but none holds the declared address — the bootstrap window is spent. */
  | 'owner-absent'
  /** The store could not be consulted (no engine, probe failure) — treated as the dead end, loudly. */
  | 'unknown';

/** The bounded read this module's probe performs — every data engine satisfies it. */
export interface WalledOwnerProbeEngine {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/**
 * What this deployment has wired that could ever verify an address. All
 * members are resolved by the caller from the live runtime — the services,
 * provider config and user store as they stand at `kernel:ready` — because
 * none of them is an env-only fact.
 */
export interface VerificationPathWiring {
  /**
   * An outbound email transport (the kernel `email` service, or one handed to
   * `AuthManager` directly). Without it the verification link has nowhere to
   * go: the callback throws rather than faking a send.
   */
  hasEmailTransport: boolean;
  /**
   * At least one federated sign-in provider — enterprise SSO (`OS_SSO_ENABLED`
   * / `plugins.sso`) or a configured social/OIDC provider. An account created
   * through one is inserted already verified when the IdP says the address is.
   */
  hasFederatedSignIn: boolean;
  /**
   * [#12751] The declared owner's account state, from
   * {@link probeWalledOwnerAccountState} — pass `'unknown'` when the store is
   * not consultable (the predicate then keeps the pre-#12751 loud posture).
   */
  ownerAccountState: WalledOwnerAccountState;
}

/**
 * [#12751] Resolve {@link WalledOwnerAccountState} from the live user store.
 *
 * Mirrors the two reads the elevation gate performs rather than inventing new
 * ones: the bounded human-population page (`isBootstrapCreation`'s shape —
 * humans, not rows; a FULL page of non-humans cannot prove absence and reads
 * as populated) and the by-email owner lookup (both the lowercased and the
 * verbatim spelling, matches re-checked trimmed + lowercased, exactly as
 * `bootstrapPlatformAdmin` queries). The verified answer is the shared
 * [#11343] allow-list (`isEmailVerifiedUserRow`) — the SAME predicate the
 * elevation gate refuses on, so this probe can never forecast a refusal the
 * gate would not make, nor stay quiet about one it would.
 *
 * [#13147] `OS_PLATFORM_OWNER_EMAIL` takes one address OR a comma-separated
 * list (#11663 Choice 2B), so the probe asks the ONE shared parser and answers
 * about the DECLARED SET: `owner-verified` when at least one declared address
 * has a verified account (one verified administrator is all the elevation gate
 * needs to promote), `owner-unverified` when accounts exist for declared
 * addresses but none is verified, `owner-absent` when none exists at all.
 * Those are exactly the elevation gate's own three outcomes, which is what
 * keeps this probe from forecasting a refusal the gate would not make.
 *
 * Never throws: any unanswerable read is `'unknown'`.
 */
export async function probeWalledOwnerAccountState(
  engine: WalledOwnerProbeEngine | undefined,
): Promise<WalledOwnerAccountState> {
  const config = resolvePlatformAdminEmails();
  if (config.emails.length === 0 || !engine || typeof engine.find !== 'function') return 'unknown';
  const SYSTEM = { context: { isSystem: true } };
  const PROBE_LIMIT = 50;
  const asRows = (raw: unknown): Record<string, unknown>[] => {
    if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    const records = (raw as { records?: unknown } | null | undefined)?.records;
    return Array.isArray(records) ? (records as Record<string, unknown>[]) : [];
  };
  try {
    // Both spellings for EVERY declared address, exactly as the elevation gate
    // queries them — the as-typed forms come from the parser's own
    // `declaredSpellings`, never from splitting the raw value a second time.
    const spellings = [...new Set([...config.emails, ...config.declaredSpellings])];
    const byId = new Map<unknown, Record<string, unknown>>();
    for (const spelling of spellings) {
      for (const row of asRows(
        await engine.find(SystemObjectName.USER, { where: { email: spelling }, limit: 5 }, SYSTEM),
      )) {
        if (row?.id) byId.set(row.id, row);
      }
    }
    const owners = [...byId.values()].filter(
      (row) =>
        isHumanUserRow(row) &&
        isConfiguredPlatformAdminEmail((row as { email?: unknown }).email, config),
    );
    if (owners.length > 0) {
      return owners.some(isEmailVerifiedUserRow) ? 'owner-verified' : 'owner-unverified';
    }
    const page = asRows(await engine.find(SystemObjectName.USER, { limit: PROBE_LIMIT }, SYSTEM));
    const humansExist = page.some(isHumanUserRow) || page.length >= PROBE_LIMIT;
    return humansExist ? 'owner-absent' : 'no-human-users';
  } catch {
    return 'unknown';
  }
}

/** The `warn` channel this check needs — every kernel logger satisfies it. */
export interface WalledOwnerVerificationLogger {
  warn?(message: string, ...rest: unknown[]): void;
}

/**
 * The predicate and its message, with no I/O — the whole decision, testable
 * shape by shape (the caller resolves the probe, {@link
 * probeWalledOwnerAccountState}, and hands the result in as wiring).
 *
 * Returns the warning text for the dead-end shapes (walled + owner declared
 * + no transport + no federated sign-in + an owner account state the
 * operator provisioning stamp can no longer reach), or `null` for every
 * other shape. Each `null` shape is `null` for its own reason:
 *
 *   - **not walled** — `single` still promotes the first human user, so a
 *     declared owner that cannot verify costs nothing;
 *   - **owner undeclared** — a walled boot never reaches here (`init()`
 *     refuses), and off the boot path the undeclared case has its own refusal;
 *   - **a transport is wired** — the verification link can be delivered;
 *   - **federated sign-in is wired** — the owner can arrive already verified;
 *   - **the owner's account exists VERIFIED** — nothing left to verify (also
 *     what stops this warning re-firing on every boot of a healthy, settled
 *     deployment);
 *   - **no human users yet** — [#12751] the bootstrap first-account creation
 *     of the declared owner is stamped verified at creation, so a fresh
 *     walled boot with nothing wired is no longer a dead end. Two dev-boot
 *     sub-shapes keep their pre-#12751 answers: a seed armed for the
 *     declared owner's own address was already `null` (#11343's seed stamp),
 *     and a seed armed for some OTHER address still WARNS — the seed will
 *     spend the bootstrap carve-out on a non-owner account at `kernel:ready`,
 *     before the owner can ever be first.
 *
 * And each warning shape names its own situation:
 *
 *   - **`owner-unverified`** — the account exists, created outside the
 *     operator path; the stamp is creation-only, so it stays refused;
 *   - **`owner-absent`** — the store is populated, the bootstrap window is
 *     spent, and an invitation-admitted registration arrives UNVERIFIED;
 *   - **`unknown`** — the store could not be consulted; unanswerable reads
 *     warn (the pre-#12751 posture: noisy over silent about a dead end).
 */
export function resolveWalledOwnerVerificationPathWarning(
  wiring: VerificationPathWiring,
): string | null {
  const posture = resolveTenancyPosture();
  if (!postureEnforcesWall(posture)) return null;

  // [#13147] The declared administrators, from the ONE shared parser. An
  // unset, blank or REFUSED variable all arrive here as an empty list — and all
  // three are `null` for the same reason the undeclared case always was: a
  // walled boot never reaches here (`init()` refuses) and off the boot path the
  // undeclared case has its own refusal.
  const config = resolvePlatformAdminEmails();
  if (config.emails.length === 0) return null;

  if (wiring.hasEmailTransport || wiring.hasFederatedSignIn) return null;

  const state = wiring.ownerAccountState;
  if (state === 'owner-verified') return null;

  // The dev-admin seed provisions the declared owner AND stamps it verified
  // (#11343) — but only ever on an EMPTY store, so it rescues exactly the
  // shapes where the store is empty or unknowable (the verify-harness boots
  // that probe nothing). An owner account that already exists unverified, or
  // a populated store with no owner account, is past the seed's reach and
  // warns below whatever the seed configuration says. Address-matched on
  // purpose: a dev boot that declares some OTHER owner still dead-ends (the
  // seed spends the bootstrap carve-out on the seed address at kernel:ready,
  // so the [#12751] first-account stamp can never reach the owner).
  const seedArmed = isDevAdminSeedArmed();
  const seedStampsDeclaredOwner =
    seedArmed && isConfiguredPlatformAdminEmail(devSeedAdminEmail(), config);

  if (state === 'no-human-users') {
    if (seedStampsDeclaredOwner) return null;
    if (!seedArmed) {
      // [#12751] Fresh store, no seed in the way: the operator's own first
      // account IS the verification path — an owner-email bootstrap creation
      // is stamped verified at creation.
      return null;
    }
    // Seed armed for a NON-owner address: it will be first; fall through.
  }
  if (state === 'unknown' && seedStampsDeclaredOwner) return null;

  const situation =
    state === 'owner-unverified'
      ? 'An account holding a declared address ALREADY EXISTS and is NOT verified — it was created ' +
        'outside the operator provisioning path (the #12751 stamp applies at operator-provisioned ' +
        'CREATION only), so elevation keeps being refused (walled_owner_not_verified) and the ' +
        'account has no in-product way to satisfy the condition. '
      : state === 'owner-absent'
        ? 'Human users already exist but none holds a declared address, so the first-account bootstrap ' +
          'window (whose owner-email creation would have been stamped verified) is spent; an ' +
          'invitation-admitted registration arrives UNVERIFIED, would be refused ' +
          '(walled_owner_not_verified), and would have no in-product way to satisfy the condition. '
        : state === 'no-human-users'
          ? `The dev-admin seed is armed and will provision '${devSeedAdminEmail()}' as the FIRST ` +
            'account at kernel:ready, spending the bootstrap carve-out on an address that is not ' +
            'the declared owner — the owner then registers later, is refused ' +
            '(walled_owner_not_verified), and has no in-product way to satisfy the condition. '
          : 'The user store could not be consulted at boot, so the declared administrators\' account state ' +
            'is unknown; an owner account not created through an operator provisioning path is ' +
            'refused (walled_owner_not_verified) with no in-product way to satisfy the condition. ';

  return (
    `[auth] ${WALLED_OWNER_NO_VERIFICATION_PATH}: tenancy posture '${posture}' declares its ` +
    // [#13147] NAME each declared administrator, as the operator typed it —
    // the variable takes a comma-separated LIST, and this line used to print
    // the whole raw value in a slot an operator reads as one address. The
    // spellings come from the parser, so what is printed is exactly the set
    // that was understood: an entry the parse dropped is visibly absent here,
    // and a refused value never reaches this line at all.
    `platform administrators (${PLATFORM_OWNER_EMAIL_ENV}=${config.declaredSpellings.join(', ')}) ` +
    'but this deployment has NO way ' +
    'to verify those addresses — no email transport is wired AND no trusted federated sign-in ' +
    '(enterprise SSO or a social/OIDC provider) is configured. Boot continues, but ' +
    'platform-admin elevation requires a declared administrator\'s address to be VERIFIED. ' +
    situation +
    'Wire EITHER path: (1) an EMAIL ' +
    'TRANSPORT — register an email service (EmailServicePlugin + OS_EMAIL_*), which delivers ' +
    'the verification link; or (2) a TRUSTED FEDERATED SIGN-IN — enterprise SSO ' +
    '(OS_SSO_ENABLED=1 plus a sys_sso_provider row) or a social provider (e.g. ' +
    'GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET), which inserts the owner already verified. ' +
    'Either one alone clears this.'
  );
}

/**
 * Emit the warning when this deployment is in the dead-end shape. Returns the
 * message that was logged, or `null` when nothing was wrong — the return value
 * is what tests assert on, so a shape that must stay quiet is pinned by
 * `null` rather than by the absence of a log call.
 *
 * Never throws: a diagnostic that can break a boot is worse than the gap it
 * reports.
 */
export function warnIfWalledOwnerCannotVerify(
  wiring: VerificationPathWiring,
  logger?: WalledOwnerVerificationLogger,
): string | null {
  let message: string | null = null;
  try {
    message = resolveWalledOwnerVerificationPathWarning(wiring);
  } catch {
    return null;
  }
  if (!message) return null;
  try {
    logger?.warn?.(message);
  } catch {
    /* a logger that throws must not abort the boot */
  }
  return message;
}
