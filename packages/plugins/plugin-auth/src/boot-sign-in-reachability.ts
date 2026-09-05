// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14353] The deployment that seeded a people directory and no logins.
 *
 * A store with human `sys_user` rows and ZERO `sys_account` rows is an
 * unrecoverable deployment, and today it is entirely silent. Measured on a
 * real `ObjectQL` over `better-sqlite3` (#14349, 13 seeded human rows, no
 * accounts, default audience posture):
 *
 *   - nobody can sign in — there is no `sys_account` row for anyone;
 *   - `api.signUpEmail(...)` answers `SELF_REGISTRATION_CLOSED`: the
 *     first-account bootstrap carve-out counts HUMANS, and humans exist, so
 *     it does not open;
 *   - the default `invite_only` audience posture refuses self-registration;
 *   - no administrator exists who could send an invitation.
 *
 * ⇒ Outside development (the dev-admin seed is hard-gated to
 * `NODE_ENV==='development'`) the deployment cannot be recovered from inside,
 * and its only symptom is a 401 on credentials nobody holds.
 *
 * ⛔ **Boot PROCEEDS, and no admission semantics change here.** This module
 * only reports. Whether the carve-out should count humans or logins was
 * #14349's question and is RULED: maintainer ruling 2026-09-02 (decision
 * batch #2, verbatim 「14361 你不处理；14261 现在就改，定位为 minor；其他同意」,
 * adopting option **A**) — `isBootstrapCreation()` keeps answering on the
 * human population, no public door moves, and the ruling names this card's
 * licence explicitly: its "message text may now say plainly that the door
 * stays shut and the remedy is out-of-band provisioning". The message below
 * says exactly that.
 *
 * ## [#15588] Why the remedy names an INVITATION, and warns off the other two
 *
 * The first version of this line ended with two remedies, and measured on the
 * exact population this report fires on, NEITHER did what its sentence said.
 * The message is the only thing that changed for #15588 — no admission
 * semantics move, exactly as #14353 scoped itself — but each clause it now
 * carries is a claim about behaviour, and each is pinned in the sibling suite
 * rather than merely string-matched:
 *
 *  - **The invitation row is the way out.** `decideAudienceAdmission` short-
 *    circuits on `hasPendingInvitation` BEFORE the posture switch, so a
 *    self-serve creation holding a pending, unexpired `sys_invitation`
 *    (`audience-posture.ts`, "The invitation carve-out") is admitted under
 *    every posture in `AUDIENCE_POSTURES`. No door needs widening. ⚠️ But the
 *    carve-out is an ADMISSION verdict and NOT a verification bypass, so the
 *    third bullet below applies to the INVITED login too: only under the
 *    default `invite_only` posture is the recovery mail-transport-free, and on
 *    `open`/`email_domain` the invited login is created and then refused
 *    `EMAIL_NOT_VERIFIED` — which also SILENCES this report, the very
 *    transition the second bullet warns about, delivered by the primary
 *    remedy. The message therefore scopes the no-mail-transport rider and
 *    tells the operator to close the posture first; ⛔ never re-state that
 *    rider for EVERY posture. Pinned across the whole posture vocabulary, with
 *    the un-invited `invite_only` refusal as its control, and the scope itself
 *    pinned beside it.
 *  - **A hand-written credential row blinds this very check.**
 *    {@link probeSignInAccountsPresence} asks only whether ANY
 *    `sys_account` row exists, so the operator's first attempt at "provision
 *    an account out of band" turns the loud dead end back into the silent one
 *    this report was written to end — while a plaintext `password` column
 *    still authenticates nothing. ⛔ TIGHTENING THE PROBE IS NOT THIS CARD:
 *    that would move #14353's diagnostic semantics. The message tells the
 *    truth about today's probe instead, and the pin fails the day the probe
 *    changes — which is the day this sentence must be rewritten.
 *  - **Widening the posture cannot recover an EXISTING person at all, and
 *    only half-works for a new one.** The operator reading this line is
 *    usually trying to recover somebody the directory already holds, and for
 *    them the posture is not the lever: self-registration is a user-CREATION
 *    path, so it cannot attach a login to an address that already carries a
 *    `sys_user` row, whatever the posture — the audience gate ADMITS such an
 *    address under `open` (pinned), which is precisely why moving the posture
 *    cannot reach what refuses them. ⚠️ Stated in MECHANISM terms on purpose:
 *    what that refusal answers on the wire is #15587's surface, in flight, and
 *    this line must stay true on both sides of it — a pin holds it there.
 *    For a NEW address, widening does create the account, and then
 *    `audiencePermitsSelfRegistration(posture)` drives `createAuthInstance()`
 *    to wire `requireEmailVerification: true` (mirrored by
 *    `getPublicConfig()`), so that login is refused `EMAIL_NOT_VERIFIED` at
 *    first sign-in — no login at all on a deployment with no mail transport,
 *    which is the shape a locked-out self-hosted install usually is.
 *
 * The message deliberately does NOT describe what a SEEDED person's own
 * re-registration answers: that response is #15587's surface and is being
 * changed. Every clause above holds on both sides of that landing.
 * `content/docs/deployment/self-hosting.mdx` (#14495) is the long form of the
 * same three facts; this line and that page must keep agreeing.
 *
 * ## Why this is `error` and the walled-owner neighbour is `warn`
 *
 * AGENTS.md → "Degradation log levels" decides with one question: after the
 * degradation, does the system still look normal from the outside while
 * something it claims is true has not landed? Here, emphatically yes — the
 * runtime boots clean, serves, and answers 401; the loss surfaces to whoever
 * is handed the deployment, who cannot connect it to this boot. The
 * walled-owner neighbour reports a DEGRADED path (one address cannot reach
 * platform-admin standing); this reports an UNRECOVERABLE one (no address can
 * reach anything). Per that rule an `error` owes two things in its first
 * line — ① the consequence, concretely, including that the system will keep
 * looking healthy, and ② the fix — and the message carries both.
 *
 * The #13398-class ruling caps this, and is satisfied rather than dodged:
 * what it forbids is GROWING `error?` onto a published sink that lacks it.
 * {@link BootDiagnosticLogger} declares `error?` AND a required `warn` from
 * birth and nothing is widened — in particular the neighbouring
 * `WalledOwnerVerificationLogger` (a `warn?`-only sink) is untouched. Spelled
 * the `share-link-service.ts` way: a conditional `error?.(…)` against a host
 * sink without `error` emits nothing, so the `warn` fallback is an explicit
 * branch, and a host that publishes only `warn` still hears this.
 *
 * ## Why `kernel:ready`, and why it shares the neighbour's hook
 *
 * Same hook site as the [#11640] walled-owner verification-path reporter, and
 * for a stronger reason than symmetry: both questions are answered from ONE
 * bounded human-population page read, performed here
 * ({@link probeHumanUsersPresence}) and handed to
 * `probeWalledOwnerAccountState` rather than read a second time. A second
 * independent prober would double the boot read and could emit two
 * overlapping reports for one deployment; the hook therefore emits at most
 * ONE report, this one taking precedence — an owner who cannot verify is moot
 * on a deployment where nobody can sign in at all.
 *
 * ## Why silence when the store cannot be read
 *
 * The neighbour warns on an unanswerable probe ("noisy over silent about a
 * real dead end"). That posture does not survive the level change: at `error`
 * it would fire on every engine-less boot — every MSW/mock embedding, every
 * host that serves auth without an `objectql` service — which is the
 * fires-on-every-boot failure mode this family has controls against, and
 * AGENTS.md's own caution that escalating trains everyone to skim `error`.
 * This report therefore makes a POSITIVE claim only: it fires when humans
 * were SEEN and accounts were SEEN ABSENT. Every other shape, `unknown`
 * included, is silent — an absence of measurement is not evidence of a dead
 * end.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { isHumanUserRow } from './audience-posture.js';
import { SELF_REGISTRATION_CLOSED } from './audience-posture.js';

/**
 * The stable NAME of this report — the grep token an operator or a support
 * thread keys on, the same way the neighbouring
 * `walled_owner_no_verification_path` leads its line.
 */
export const NO_SIGN_IN_ACCOUNT_AT_BOOT = 'no_sign_in_account_at_boot';

/**
 * The bounded read this family's probes perform — every data engine satisfies
 * it. One shape for the whole family: `WalledOwnerProbeEngine` is an alias of
 * this, so the two probes cannot drift apart on what they require of a store.
 */
export interface BootProbeEngine {
  find(
    object: string,
    query: Record<string, unknown>,
    options?: unknown,
  ): Promise<Array<Record<string, unknown>>>;
}

/**
 * A bounded existence answer. `'unknown'` is NOT a third kind of absence — it
 * means the question was not answered, and every consumer here treats it as
 * "make no claim".
 */
export type BootStorePresence = 'present' | 'absent' | 'unknown';

/**
 * The page size of the human-population probe. Matches the neighbour's
 * historical `PROBE_LIMIT`: a FULL page of non-humans cannot prove absence and
 * so reads as populated (the direction that fails safe — this report only ever
 * fires on a POSITIVE human sighting).
 */
export const HUMAN_POPULATION_PROBE_LIMIT = 50;

/** What the store says at boot about whether anyone can sign in at all. */
export interface SignInReachabilityFacts {
  /** Whether any human `sys_user` row exists ({@link isHumanUserRow}). */
  humanUsers: BootStorePresence;
  /** Whether any `sys_account` row exists — a credential, a federated link, any login. */
  signInAccounts: BootStorePresence;
}

const SYSTEM = { context: { isSystem: true } };

const usable = (engine: BootProbeEngine | undefined): engine is BootProbeEngine =>
  !!engine && typeof engine.find === 'function';

/**
 * THE human-population page read for this family — performed once per boot.
 *
 * Humans, not rows: a database still carrying the legacy `usr_system` service
 * row is EMPTY of humans, and counting it would make a fresh install look
 * populated. {@link isHumanUserRow} owns that predicate for all three call
 * sites; this one does not re-spell it.
 *
 * Never throws: an unanswerable read is `'unknown'`.
 */
export async function probeHumanUsersPresence(
  engine: BootProbeEngine | undefined,
): Promise<BootStorePresence> {
  if (!usable(engine)) return 'unknown';
  try {
    const page = await engine.find(
      SystemObjectName.USER,
      { limit: HUMAN_POPULATION_PROBE_LIMIT },
      SYSTEM,
    );
    // A full page of non-humans cannot prove absence: it reads as populated.
    const humansExist = page.some(isHumanUserRow) || page.length >= HUMAN_POPULATION_PROBE_LIMIT;
    return humansExist ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

/**
 * Whether ANY `sys_account` row exists — one bounded row is the whole
 * question. No predicate over the rows on purpose: a row of any provider,
 * any issuer, banned or not, means SOMEBODY has a login, and this report is
 * about the total absence of one. Never throws.
 */
export async function probeSignInAccountsPresence(
  engine: BootProbeEngine | undefined,
): Promise<BootStorePresence> {
  if (!usable(engine)) return 'unknown';
  try {
    const rows = await engine.find(SystemObjectName.ACCOUNT, { limit: 1 }, SYSTEM);
    return rows.length > 0 ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

/**
 * Both facts, from one probe pass. The account read is skipped when no human
 * was seen: with no humans the report cannot fire whatever the accounts say
 * (a genuinely empty store is a healthy pre-bootstrap deployment, not a dead
 * end), so a fresh boot pays for one page read and nothing else.
 */
export async function probeSignInReachability(
  engine: BootProbeEngine | undefined,
): Promise<SignInReachabilityFacts> {
  const humanUsers = await probeHumanUsersPresence(engine);
  if (humanUsers !== 'present') return { humanUsers, signInAccounts: 'unknown' };
  return { humanUsers, signInAccounts: await probeSignInAccountsPresence(engine) };
}

/**
 * The predicate and its message, with no I/O — the whole decision, testable
 * fact by fact.
 *
 * Returns the report text for the ONE dead-end shape (humans SEEN, accounts
 * SEEN ABSENT), or `null` for every other shape. Each `null` is `null` for its
 * own reason:
 *
 *   - **no humans** — a genuinely empty store is a healthy deployment whose
 *     first-account bootstrap is still ahead of it; the carve-out opens for
 *     the first visitor exactly as designed;
 *   - **an account exists** — somebody can sign in, and whoever that is can
 *     invite the rest; nothing here is unrecoverable;
 *   - **`unknown` on either fact** — the store was not consulted (no engine,
 *     a probe failure). See the module doc: at `error` level this report makes
 *     a positive claim or none at all.
 */
export function resolveNoSignInAccountReport(facts: SignInReachabilityFacts): string | null {
  if (facts.humanUsers !== 'present') return null;
  if (facts.signInAccounts !== 'absent') return null;

  return (
    `[auth] ${NO_SIGN_IN_ACCOUNT_AT_BOOT}: this deployment has human '${SystemObjectName.USER}' rows ` +
    `but ZERO '${SystemObjectName.ACCOUNT}' rows — there is no credential, no federated link, no login ` +
    'of any kind, for anyone. NOBODY CAN SIGN IN, and the deployment CANNOT BE RECOVERED FROM INSIDE: ' +
    'the first-account bootstrap carve-out counts HUMANS and humans already exist, so it does not open ' +
    `(maintainer ruling 2026-09-02, option A — the door stays shut); self-registration is refused with ` +
    `${SELF_REGISTRATION_CLOSED} under the default 'invite_only' audience posture; and no administrator ` +
    'exists who could send an invitation. Boot continues and this deployment will keep LOOKING healthy — ' +
    'its only symptom is a 401 on credentials nobody holds. RECOVER IT FROM OUTSIDE THE RUNNING ' +
    'PRODUCT, and the path that works is ONE ROW: INVITE ONE ADDRESS — write a pending ' +
    `'${SystemObjectName.INVITATION}' row directly against the store ('email' a LOWERCASE address ` +
    `this directory does NOT already hold, 'status' 'pending', a future 'expires_at', 'inviter_id' ` +
    `the id of any existing '${SystemObjectName.USER}' row — the pending-invitation lookup ` +
    'lowercases the address it searches for, so a mixed-case row is never found), then have that ' +
    'person register through the ordinary sign-up endpoint. The invitation carve-out admits that ' +
    'ONE creation under EVERY audience posture, so no door needs widening — but it is an ADMISSION ' +
    "verdict, not a verification bypass: under the default 'invite_only' posture no mail transport " +
    "is needed either, whereas an 'open' or 'email_domain' posture forces email verification on the " +
    "INVITED login too (see (b)), so close the posture back to 'invite_only' BEFORE that person " +
    "registers. On the 'single' tenancy posture that account holder is then promoted to platform " +
    'admin. Afterwards, re-run the provisioning job that seeded these people so it seeds their ' +
    'logins too. TWO THINGS THAT LOOK LIKE REMEDIES AND ARE NOT: (a) HAND-WRITING A CREDENTIAL ' +
    `ROW — a '${SystemObjectName.ACCOUNT}' row's 'password' column must carry a secret in the ` +
    "platform's own hash format, so a plaintext password authenticates nothing — a 401 or a 500 " +
    'depending on the row shape, never a session — and ' +
    `writing ANY '${SystemObjectName.ACCOUNT}' row SILENCES THIS REPORT, which asks only whether such ` +
    'a row EXISTS — the deployment stops being loudly broken and becomes quietly broken; and (b) ' +
    'OPENING THE AUDIENCE POSTURE — which cannot recover an EXISTING person at all: ' +
    'self-registration is a user-CREATION path, so it cannot hand a login to somebody whose ' +
    `'${SystemObjectName.USER}' row already exists, and NO posture changes that. Widening only ever ` +
    "admits a NEW address — and then every posture other than 'invite_only' ('open', " +
    "'email_domain') FORCES email verification ON, so that login is refused EMAIL_NOT_VERIFIED at " +
    'its first sign-in until a mail transport delivers the link, and a locked-out self-hosted ' +
    'install usually has none. Nothing here happens by itself.'
  );
}

/**
 * The `error` channel this report needs, with the `warn` fallback the
 * #13398-class ruling requires of a sink that may not declare `error`.
 *
 * `warn` is REQUIRED and `error` is optional, which is the #9754 shape
 * (`check:optional-error-sink`): the fallback channel a durability report
 * degrades to must be present in EVERY value of the type, or the type still
 * permits a sink that prints nothing and the guarantee lives only in this
 * module's call branch. Making `error` required instead is the falsified
 * option — hosts do inject reduced sinks — and a required `info` would not
 * do: a lost sign-in path reported at `info` is the reassuring half-truth
 * AGENTS.md → "Degradation log levels" exists to remove.
 *
 * Both members are still declared HERE, at birth: no published sink is
 * widened by this module.
 */
export interface BootDiagnosticLogger {
  error?(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
}

/**
 * Emit the report when this deployment is in the dead-end shape. Returns the
 * message that was logged, or `null` when nothing was wrong — the return value
 * is what tests assert on and what the caller reads to decide precedence, so a
 * shape that must stay quiet is pinned by `null` rather than by the absence of
 * a log call.
 *
 * Never throws: a diagnostic that can break a boot is worse than the gap it
 * reports.
 */
export function reportIfNoSignInAccountExists(
  facts: SignInReachabilityFacts,
  logger?: BootDiagnosticLogger,
): string | null {
  let message: string | null = null;
  try {
    message = resolveNoSignInAccountReport(facts);
  } catch {
    return null;
  }
  if (!message) return null;
  try {
    // An `error?.(…)` against a sink without `error` emits NOTHING, so the
    // `warn` fallback is an explicit branch rather than an optional call.
    if (logger?.error) logger.error(message);
    else logger?.warn(message);
  } catch {
    /* a logger that throws must not abort the boot */
  }
  return message;
}
