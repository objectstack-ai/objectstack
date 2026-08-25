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
 * ## Scope — deliberately half the problem
 *
 * This covers the no-verification-path route only. Whether the *declared
 * address itself* is already spoken for is a runtime state a boot check
 * cannot see, and the ruling leaves it out on purpose; it stays an ungraded
 * finding on the card's thread.
 *
 * ⚠️ **For whoever rewrites this surface** (the #11663 re-anchor legs L2
 * #11970 / L4 #11974, both `pm:blocked` as of 2026-08-25): the decision lives
 * entirely in this module and the call site is one `kernel:ready` hook in
 * `AuthPlugin.start()`. Move the call; the predicate and its message travel
 * with the file.
 */

import {
  PLATFORM_OWNER_EMAIL_ENV,
  resolvePlatformOwnerEmail,
  resolveTenancyPosture,
} from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';

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
 * What this deployment has wired that could ever verify an address. Both
 * members are resolved by the caller from the live runtime — the services and
 * provider config as they stand at `kernel:ready` — because neither is an
 * env-only fact.
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
}

/** The `warn` channel this check needs — every kernel logger satisfies it. */
export interface WalledOwnerVerificationLogger {
  warn?(message: string, ...rest: unknown[]): void;
}

/**
 * The predicate and its message, with no I/O — the whole decision, testable
 * shape by shape.
 *
 * Returns the warning text for the ONE dead-end shape (walled + owner declared
 * + no transport + no federated sign-in), or `null` for every other shape.
 * Each neighbouring shape is `null` for its own reason:
 *
 *   - **not walled** — `single` still promotes the first human user, so a
 *     declared owner that cannot verify costs nothing;
 *   - **owner undeclared** — a walled boot never reaches here (`init()`
 *     refuses), and off the boot path the undeclared case has its own refusal;
 *   - **a transport is wired** — the verification link can be delivered;
 *   - **federated sign-in is wired** — the owner can arrive already verified;
 *   - **the dev-admin seed will stamp this very address** — a dev/harness boot
 *     verifies its own declared owner at startup (#11343's `email_verified`
 *     stamp), which is a verification path even with no mailbox anywhere.
 */
export function resolveWalledOwnerVerificationPathWarning(
  wiring: VerificationPathWiring,
): string | null {
  const posture = resolveTenancyPosture();
  if (!postureEnforcesWall(posture)) return null;

  const ownerEmail = resolvePlatformOwnerEmail();
  if (!ownerEmail) return null;

  if (wiring.hasEmailTransport || wiring.hasFederatedSignIn) return null;

  // The dev-admin seed provisions the declared owner AND stamps it verified,
  // so a dev/harness walled boot is not a dead end even with nothing wired.
  // Address-matched on purpose: a dev boot that declares some OTHER owner is
  // the dead end this warning is for.
  if (
    isDevAdminSeedArmed() &&
    devSeedAdminEmail().toLowerCase() === ownerEmail.toLowerCase()
  ) {
    return null;
  }

  return (
    `[auth] ${WALLED_OWNER_NO_VERIFICATION_PATH}: tenancy posture '${posture}' declares its ` +
    `platform owner (${PLATFORM_OWNER_EMAIL_ENV}=${ownerEmail}) but this deployment has NO way ` +
    'to verify that address — no email transport is wired AND no trusted federated sign-in ' +
    '(enterprise SSO or a social/OIDC provider) is configured. Boot continues, but ' +
    "platform-admin elevation requires the declared owner's address to be VERIFIED, so the " +
    'owner will register, be refused (walled_owner_not_verified), and have no in-product way ' +
    'to satisfy the condition. Wire EITHER path before the owner registers: (1) an EMAIL ' +
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
