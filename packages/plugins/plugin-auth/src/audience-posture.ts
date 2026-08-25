// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Audience posture — the SINGLE owner of "who may become a user of this
 * environment" (#11739 / epic #11723; vocabulary and completeness predicates
 * declared in `@objectstack/spec/system` `AudienceConfigSchema`).
 *
 * ## The one enforcement point
 *
 * Enforcement rides better-auth 1.7.1's `user.validateUserInfo` gate — the
 * vendor's own admission seam, invoked by `internalAdapter.createUser` for
 * EVERY creation path (measured against the installed dist: sign-up.mjs passes
 * `{method:'email-password'}`, link-account.mjs `{method:'oauth'|'sso-*'}`,
 * admin routes `{method:'admin'}`, @better-auth/scim `{method:'scim'}`,
 * magic-link / email-otp / phone-number / anonymous each their own). A
 * rejection surfaces as a 403 `APIError` whose `code` is OURS, and browser
 * OAuth flows redirect to the error URL carrying the same code. The gate
 * fails CLOSED by vendor construction (a throwing hook rejects provisioning).
 * This module owns the DECISION (`decideAudienceAdmission`, a pure function
 * the test matrix drives); auth-manager owns the wiring and the I/O
 * (bootstrap probe, invitation lookup, permission-set resolution).
 *
 * ## What is gated, and what deliberately is not
 *
 * The posture governs SELF-registration — a person becoming a user by their
 * own act. Three creation classes ({@link classifyCreationMethod}):
 *
 * - `self-serve` (POSTURE-GATED): email/password sign-up, social-provider
 *   OAuth JIT (`socialProviders` — a public IdP account is not an operator
 *   act), magic-link, email-otp, phone-number, anonymous, siwe, and ANY
 *   unrecognized method (fail closed: a future plugin's creation path is
 *   gated until deliberately classified).
 * - `operator` (never gated): `admin` (create-user / bulk import) and `scim`
 *   (IdP-driven provisioning) — these ARE the invite/provisioning mechanisms
 *   the closed postures point operators at.
 * - `provider` (never gated): JIT provisioning through an OPERATOR-REGISTERED
 *   identity authority — `sso-oidc` / `sso-saml` (@better-auth/sso providers;
 *   registration is platform-admin-only, #10009) and `oauth` whose providerId
 *   is a configured `oidcProviders` entry (enterprise SSO incl. the cloud
 *   platform IdP, whose OP side additionally enforces app-assignment, D5.1).
 *   Registering an IdP is the operator declaring "this directory is my
 *   audience"; and the closed vocabulary could not express the standard
 *   enterprise combo (self-registration closed + IdP JIT on) any other way —
 *   gating these under `invite_only` would hard-brick every SSO-enforced
 *   deployment whose entire user base arrives via the IdP.
 *
 * Only `action: 'create-user'` is judged: `link-account` and provider
 * `sign-in` concern an EXISTING user's identity, not audience admission.
 *
 * ## The invitation carve-out
 *
 * `invite_only` means BY INVITATION — not "no new users". better-auth's
 * organization invitation flow requires the invitee to hold an account before
 * `accept-invitation`, and for a brand-new invitee that account comes from the
 * self-serve sign-up route. So a self-serve creation whose email holds a
 * PENDING, unexpired `sys_invitation` row is admitted under every posture
 * (under `email_domain` an explicit invitation also trumps the domain list —
 * an operator inviting an external contractor must not dead-end them).
 * Without this carve-out the posture would be "admin-create only" and the
 * invitation surface would be dead for new users — the invite dead-end class.
 *
 * ## Pinned domain-matching rules (`email_domain`)
 *
 * An unpinned matcher is where this class of gate leaks, so the rules are
 * stated and test-locked ({@link emailDomainAllowed}):
 *
 *  1. The candidate domain is everything after the LAST `@` of the address;
 *     an address with no `@`, or an empty remainder, has no domain and never
 *     matches (placeholder addresses for phone-only users land here).
 *  2. Comparison is case-insensitive on both sides.
 *  3. A list entry matches by EXACT equality — subdomains are NOT implied
 *     (`user@mail.acme.com` is not admitted by `acme.com`; declare
 *     `mail.acme.com` too) and wildcards are refused at declaration.
 *  4. `+tag` local-part suffixes are irrelevant — matching never reads the
 *     local part, so `user+anything@acme.com` matches like `user@acme.com`.
 *  5. No punycode/IDN normalization is applied: the declared entry and the
 *     address's domain are compared as lowercased strings. Declare an
 *     internationalized domain in the exact form addresses carry it.
 *
 * ## Fail postures, mirrored from the MembershipPolicy precedent (#5205)
 *
 * An off-vocabulary posture at admission time is REFUSED with
 * `AUTH_CONFIG_ERROR` — a verdict distinct from `SELF_REGISTRATION_CLOSED`
 * ("a valid posture said no") because sending the debugger to re-read a
 * setting that looks exactly as they left it is the recorded failure mode. A
 * declared permission set that cannot be resolved refuses admission the same
 * way: admitting a self-registrant WITHOUT the declared grant would be the
 * ADR-0078 "declared but inert" defect at runtime, and fail-open is the one
 * direction this gate must never take.
 */

import {
  AUDIENCE_POSTURES,
  SystemUserId,
  isAudiencePosture,
  audiencePermitsSelfRegistration,
  type AudienceConfig,
  type AudiencePosture,
  type EmailAndPasswordConfig,
} from '@objectstack/spec/system';

/** Wire code for "a valid posture closed self-registration" (ADR-0112 ledger). */
export const SELF_REGISTRATION_CLOSED = 'SELF_REGISTRATION_CLOSED';
/** Wire code for "the address's domain is off the email_domain allowlist" (ADR-0112 ledger). */
export const EMAIL_DOMAIN_NOT_ALLOWED = 'EMAIL_DOMAIN_NOT_ALLOWED';
/** Wire code for "the audience configuration itself is unusable" (registered pre-existing). */
export const AUDIENCE_CONFIG_ERROR = 'AUTH_CONFIG_ERROR';

/** The audience declaration as the live config resolves it. */
export interface ResolvedAudience {
  posture: AudiencePosture;
  allowedEmailDomains: readonly string[];
  selfRegistrationPermissionSet?: string;
  /**
   * Present when the RAW posture was off-vocabulary (reachable only by
   * mutating config past the entry validation). `posture` is then coerced to
   * `invite_only` for DISPLAY surfaces; the admission path refuses with
   * `AUTH_CONFIG_ERROR` instead of trusting the coercion (fail closed, and
   * the refusal names the offending value — never "policy said no").
   */
  invalid?: { raw: string };
}

/** Bounded, type-safe description of a rejected value (the #5205 pattern). */
export function describeAudiencePosture(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 64 ? `'${value.slice(0, 64)}…' (truncated)` : `'${value}'`;
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `[${typeof value}]`;
}

/**
 * Resolve the raw authored `audience` config to the shape every consumer
 * reads. Undeclared ⇒ `invite_only` (maintainer ruling 2026-08-24, epic
 * #11723 — no legacy/undeclared limbo). Never throws: entry refusal is
 * {@link assertAudienceConfig}'s job; this only marks an off-vocabulary
 * posture `invalid` so consumers fail closed rather than fail open.
 */
export function resolveAudience(raw: AudienceConfig | undefined): ResolvedAudience {
  const rawPosture = (raw as { posture?: unknown } | undefined)?.posture;
  const domains = Array.isArray(raw?.allowedEmailDomains) ? raw.allowedEmailDomains : [];
  const set =
    typeof raw?.selfRegistrationPermissionSet === 'string' && raw.selfRegistrationPermissionSet
      ? raw.selfRegistrationPermissionSet
      : undefined;
  if (rawPosture === undefined || rawPosture === null) {
    return { posture: 'invite_only', allowedEmailDomains: domains, selfRegistrationPermissionSet: set };
  }
  if (!isAudiencePosture(rawPosture)) {
    return {
      posture: 'invite_only',
      allowedEmailDomains: domains,
      selfRegistrationPermissionSet: set,
      invalid: { raw: describeAudiencePosture(rawPosture) },
    };
  }
  return { posture: rawPosture, allowedEmailDomains: domains, selfRegistrationPermissionSet: set };
}

/**
 * Entry validation — REFUSES an unusable audience declaration at the point it
 * enters the manager (constructor and `applyConfigPatch`), loudly, with the
 * remedy in the message. Mirrors `AudienceConfigSchema`'s predicates (the
 * schema guards the authoring surface; the runtime receives plain objects) and
 * adds the one cross-field invariant the schema cannot see:
 *
 *   posture permits self-registration ⇒ `emailAndPassword.requireEmailVerification`
 *   must not be explicitly `false` (verification is FORCED on by the wiring;
 *   an explicit contradiction is a config that opens self-registration while
 *   disabling verification — refused, an unverified allowlisted-domain signup
 *   is colleague impersonation and makes the domain gate decorative).
 */
export function assertAudienceConfig(
  raw: AudienceConfig | undefined,
  emailAndPassword: EmailAndPasswordConfig | undefined,
): void {
  if (raw === undefined || raw === null) return;
  const fail = (message: string): never => {
    throw new Error(`[audience] invalid audience configuration: ${message}`);
  };
  const rawPosture = (raw as { posture?: unknown }).posture;
  if (rawPosture !== undefined && !isAudiencePosture(rawPosture)) {
    fail(
      `posture ${describeAudiencePosture(rawPosture)} is not a recognized audience posture — ` +
      `expected one of: ${AUDIENCE_POSTURES.join(', ')}. Refused, never coerced (#5205 fail-open precedent).`,
    );
  }
  const posture: AudiencePosture = (rawPosture as AudiencePosture | undefined) ?? 'invite_only';
  const domains = raw.allowedEmailDomains;
  if (domains !== undefined && !Array.isArray(domains)) {
    fail('allowedEmailDomains must be an array of bare domain names');
  }
  if (posture === 'email_domain') {
    if (!domains || domains.length === 0) {
      fail(
        "posture 'email_domain' requires a non-empty allowedEmailDomains list — declare the domains, " +
        "or use posture 'invite_only'.",
      );
    }
  } else if (domains !== undefined) {
    fail(
      `allowedEmailDomains is only read under posture 'email_domain' — under '${posture}' it is declared ` +
      'but inert (ADR-0078) and reads as a wall that does not exist. Remove it, or set posture to email_domain.',
    );
  }
  if (domains) {
    const seen = new Set<string>();
    for (const entry of domains) {
      if (typeof entry !== 'string' || !isDeclarableEmailDomain(entry)) {
        fail(
          `allowedEmailDomains entry ${describeAudiencePosture(entry)} is not a bare domain name ` +
          '(expected e.g. "acme.com" — no scheme, no "@", no wildcard, at least one dot).',
        );
      }
      const lowered = entry.toLowerCase();
      if (seen.has(lowered)) fail(`allowedEmailDomains entry '${entry}' is duplicated (matching is case-insensitive)`);
      seen.add(lowered);
    }
  }
  const set = raw.selfRegistrationPermissionSet;
  if (audiencePermitsSelfRegistration(posture)) {
    if (typeof set !== 'string' || set.length === 0) {
      fail(
        `posture '${posture}' permits self-registration, so selfRegistrationPermissionSet must DECLARE the ` +
        'permission set a self-registrant receives (the implicit member_default fallback is retired; ' +
        'declaring member_default explicitly is allowed).',
      );
    }
    if (set === 'admin_full_access') {
      fail(
        "selfRegistrationPermissionSet must not be 'admin_full_access' — a platform-admin grant to every " +
        'self-registrant is never a declarable audience.',
      );
    }
    if (emailAndPassword?.requireEmailVerification === false) {
      fail(
        `posture '${posture}' opens self-registration, which FORCES email verification on — ` +
        'emailAndPassword.requireEmailVerification: false contradicts it and is refused ' +
        '(an unverified allowlisted-domain signup is colleague impersonation). ' +
        "Remove the explicit false, or close the posture to 'invite_only'.",
      );
    }
  } else if (set !== undefined) {
    fail(
      "selfRegistrationPermissionSet is only read under a posture that permits self-registration — under " +
      `'${posture}' it is declared but inert (ADR-0078). Remove it, or open the posture deliberately.`,
    );
  }
}

/** Declaration-side domain shape (mirrors the spec schema's regex). */
const DECLARABLE_DOMAIN = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

export function isDeclarableEmailDomain(entry: string): boolean {
  return DECLARABLE_DOMAIN.test(entry);
}

/**
 * Pinned rule 1: the candidate domain is everything after the LAST `@`,
 * lowercased; no `@` / empty remainder ⇒ `null` (never matches).
 */
export function extractEmailDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

/** Pinned rules 2–5: exact, case-insensitive, per-entry equality. */
export function emailDomainAllowed(email: unknown, allowedDomains: readonly string[]): boolean {
  const domain = extractEmailDomain(email);
  if (!domain) return false;
  for (const entry of allowedDomains) {
    if (typeof entry === 'string' && entry.toLowerCase() === domain) return true;
  }
  return false;
}

/**
 * THE bootstrap population predicate — "does this environment already have a
 * HUMAN user?" — owned once, here, and asked by every consumer of the
 * first-run bypass.
 *
 * ## Humans, not rows (the canonical answer)
 *
 * The bootstrap bypass counts **non-system humans**, never "any `sys_user`
 * row". Three call sites ask this same question and they must agree:
 *
 *  - the audience gate's bootstrap bypass (`isBootstrapCreation`);
 *  - plugin-auth's dev-admin seed, whose own precondition has always filtered
 *    `usr_system` / `role === 'system'` before deciding to seed;
 *  - plugin-security's first-user detection, which prints "no human users yet
 *    — first sign-up will be promoted to platform admin" off the identical
 *    filter and then promotes that sign-up.
 *
 * If the audience gate counted ANY row while those two counted humans, the
 * two would disagree on exactly one population: a database still carrying the
 * legacy `usr_system` service row (`SystemUserId.SYSTEM` — no longer
 * provisioned, but present in every DB an older runtime created). There,
 * plugin-security would announce "no human users yet" and stand ready to
 * promote the first sign-up while the audience gate refused that very
 * sign-up with `SELF_REGISTRATION_CLOSED` — a fresh-looking install locked
 * out of itself, which is the one outcome the bypass exists to prevent.
 * Humans is therefore canonical, and the disagreement is closed by both
 * plugin-auth call sites reading THIS function rather than re-spelling the
 * filter.
 *
 * ## Why the filter runs in JS and not in the where-clause
 *
 * A store-side `role != 'system'` drops rows whose `role` is NULL under SQL
 * three-valued logic — i.e. it would hide ordinary humans, the direction that
 * fails open. The rows are read unfiltered and judged here.
 */
export function isHumanUserRow(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const user = row as { id?: unknown; role?: unknown };
  if (user.id === SystemUserId.SYSTEM) return false;
  if (user.role === 'system') return false;
  return true;
}

/**
 * How the incoming creation reached the platform, from the vendor-supplied
 * `source` (see the module doc for why each class lands where it does).
 */
export type AudienceCreationClass = 'operator' | 'provider' | 'self-serve';

const OPERATOR_METHODS: ReadonlySet<string> = new Set(['admin', 'scim']);
const PROVIDER_METHODS: ReadonlySet<string> = new Set(['sso-oidc', 'sso-saml']);

export function classifyCreationMethod(
  source: { method?: unknown; oauth?: { providerId?: unknown } } | undefined,
  opts: { enterpriseOAuthProviderIds: ReadonlySet<string> },
): AudienceCreationClass {
  const method = typeof source?.method === 'string' ? source.method : '';
  if (OPERATOR_METHODS.has(method)) return 'operator';
  if (PROVIDER_METHODS.has(method)) return 'provider';
  if (method === 'oauth') {
    const providerId = source?.oauth?.providerId;
    if (typeof providerId === 'string' && opts.enterpriseOAuthProviderIds.has(providerId)) {
      return 'provider';
    }
    return 'self-serve';
  }
  // Known self-serve methods AND any unrecognized method: posture-gated
  // (fail closed — an unclassified future creation path must not bypass the
  // audience wall silently).
  return 'self-serve';
}

export type AudienceAdmission =
  | { admit: true; grantPermissionSet: boolean }
  | { admit: false; code: string; message: string };

export interface AudienceAdmissionInput {
  audience: ResolvedAudience;
  creationClass: AudienceCreationClass;
  /** The would-be user's email, as the creation path carries it. */
  email: string | undefined;
  /** A pending, unexpired `sys_invitation` row exists for this email. */
  hasPendingInvitation: boolean;
  /**
   * No user exists yet — the first-run owner wizard / seeded admin creating
   * the very first account. Mirrors the `disableSignUp` bootstrap bypass: a
   * fresh install must never lock its operator out.
   */
  isBootstrap: boolean;
}

/**
 * THE admission decision — pure, so the posture × method matrix is a table of
 * direct calls. Order: creation-class exemptions → bootstrap → vocabulary
 * guard (fail closed) → posture semantics.
 */
export function decideAudienceAdmission(input: AudienceAdmissionInput): AudienceAdmission {
  const { audience, creationClass, email, hasPendingInvitation, isBootstrap } = input;
  if (creationClass === 'operator' || creationClass === 'provider') {
    return { admit: true, grantPermissionSet: false };
  }
  if (isBootstrap) {
    return { admit: true, grantPermissionSet: false };
  }
  if (audience.invalid) {
    return {
      admit: false,
      code: AUDIENCE_CONFIG_ERROR,
      message:
        `audience posture ${audience.invalid.raw} is not a recognized value (expected one of: ` +
        `${AUDIENCE_POSTURES.join(', ')}) — self-registration is refused until the configuration is fixed. ` +
        'This is a configuration error, not a policy refusal.',
    };
  }
  if (hasPendingInvitation) {
    // An explicit invitation is a stronger operator act than any posture —
    // it admits the invitee's own account creation under invite_only AND
    // trumps the email_domain allowlist (module doc: the invite dead-end).
    return { admit: true, grantPermissionSet: false };
  }
  switch (audience.posture) {
    case 'invite_only':
      return {
        admit: false,
        code: SELF_REGISTRATION_CLOSED,
        message:
          'Self-registration is closed on this environment (audience posture invite_only). ' +
          'Ask an administrator for an invitation.',
      };
    case 'email_domain':
      if (emailDomainAllowed(email, audience.allowedEmailDomains)) {
        return { admit: true, grantPermissionSet: true };
      }
      return {
        admit: false,
        code: EMAIL_DOMAIN_NOT_ALLOWED,
        message:
          'Self-registration on this environment is limited to approved email domains, and this address ' +
          'is not on the list. Use your organization email, or ask an administrator for an invitation.',
      };
    case 'open':
      return { admit: true, grantPermissionSet: true };
    default: {
      // Unreachable for a well-typed posture; keep the fail-closed floor.
      return {
        admit: false,
        code: AUDIENCE_CONFIG_ERROR,
        message: `audience posture ${describeAudiencePosture(audience.posture)} is not a recognized value.`,
      };
    }
  }
}
