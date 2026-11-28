// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What Setup → Authentication's switches read while nothing is stored: the
 * value the running config takes for the key, not the manifest's console
 * default.
 *
 * The settings pass applies only stored or `OS_*` values, and with nothing
 * stored the running config keeps the deployment's own declaration (plugin
 * options and `auth:configure` handlers, `auth-settings-declared.ts`). The
 * settings service resolved such a key to the manifest default, so a
 * deployment that declared email and password off showed the switch on, and
 * a save of that default read as "no change" to the key's write predicates.
 * Each key here states its declaration to the settings service
 * (`registerDeclaredDefault`, ADR-0007 §Resolution rung 4 as amended); the
 * service answers it at the bottom of the cascade, still `source: 'default'`
 * (nothing is stored), and a stored value or an `OS_*` override still wins.
 *
 * Every key whose running value is taken from a value the deployment itself
 * states, each computed through the formula the running config answers with,
 * so the two cannot disagree. Measured key by key on a real `AuthPlugin`:
 * with nothing declared each formula answers the manifest default (or nothing,
 * for a key with no manifest default), so a deployment that declares nothing
 * reads as before; with a declaration, the switch reads it.
 *
 *  - `email_password_enabled` (manifest `true`): `emailAndPassword.enabled`,
 *    on unless declared `false` (`getPublicConfig().emailPassword.enabled`).
 *  - `signup_enabled` (manifest `true`): off where self-registration is
 *    forced off (SSO-only, cloud-managed), else per the deployment env, else
 *    per the declared `emailAndPassword.disableSignUp`
 *    (`AuthManager.resolveDisableSignUp`).
 *  - `require_email_verification` (manifest `false`): the declared
 *    `emailAndPassword.requireEmailVerification` under the audience posture in
 *    force (`resolveEmailVerificationRequirement`) — on under `email_domain`,
 *    on under `open` unless declared `false`.
 *  - The password, MFA, API-key, session, network and lockout keys, the
 *    membership policy and the audience trio: the declared option the manager
 *    reads, through the manager's own default and clamp where it has one
 *    ({@link AUTH_DECLARED_DEFAULTS} names the reader each mirrors).
 *
 * Each answer is in the shape the key's specifier takes: days for a session
 * lifetime the manager holds in seconds, one entry per line for a list the
 * console edits as a textarea, and a select's value only when it is one of
 * the select's options (an off-vocabulary declaration answers nothing, so the
 * manifest default stands, rather than serving a value the page cannot offer).
 *
 * Not declared here, by design:
 *
 *  - `rate_limit_max` / `rate_limit_window_seconds`: with nothing stored the
 *    sign-in, sign-up and password-reset endpoints run on the auth library's
 *    own per-path rules (and its production-only switch), or a declared
 *    `rateLimit` that is not the per-endpoint cap the setting writes, so no
 *    one number states what runs.
 *  - `api_key_policy_started_at`: recorded into the store by the first boot
 *    that runs the policy, so it is not left unstored.
 *  - `google_enabled`: an intent toggle whose runtime default is the manifest
 *    default (on); a Google button needs it and both credentials.
 *  - `google_client_id` / `google_client_secret`: a credential declared in the
 *    server configuration outranks a saved one, so it is not the value a
 *    clear returns to, and a secret is never served as a default.
 *
 * Asked by the settings service on each read, never recorded here, so a
 * posture change or a host flag is followed at once.
 */

import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_INACTIVITY_DAYS,
  API_KEY_MAX_EXPIRY_DAYS,
} from '@objectstack/core';
import type { AudiencePosture } from '@objectstack/spec/system';
import { resolveAudience, resolveEmailVerificationRequirement } from './audience-posture.js';
import { readBooleanEnv } from './auth-manager.js';
import { resolveMfaGracePeriodDays } from './auth-manager-password-session-policy.js';
import type { DeclaredAuthOptions } from './auth-settings-declared.js';
import { isMfaRequirementLevel } from './organization-access-policy.js';
import { isMembershipPolicy } from './reconcile-membership.js';

/** What a declared default is computed from, all read when asked. */
export interface AuthDeclaredDefaultFacts {
  /** The deployment's own values, captured in `init()` before any setting applied. */
  declared(): DeclaredAuthOptions;
  /** `AuthManager.resolveDisableSignUp`: self-registration off for a declared `disableSignUp`. */
  resolveDisableSignUp(declared: boolean | undefined): boolean;
  /** The audience posture in force (`AuthManager.getAudience().posture`). */
  audiencePosture(): AudiencePosture;
}

/** A non-empty list as the console's textarea holds it (one entry per line), else nothing declared. */
function asLines(list: readonly string[] | undefined): string | undefined {
  return Array.isArray(list) && list.length > 0 ? list.join('\n') : undefined;
}

/** `AuthManager#resolveApiKeyLifecyclePolicy`'s reading of one window. */
function apiKeyDays(value: unknown, fallback: number, min: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Each key's declared default, by key: what the running config takes for it
 * while nothing is stored. `undefined` means the deployment declared nothing
 * the specifier can show, and the manifest default stands.
 */
export const AUTH_DECLARED_DEFAULTS: Readonly<Record<string, (facts: AuthDeclaredDefaultFacts) => unknown>> = {
  email_password_enabled: (facts) => facts.declared().emailAndPassword?.enabled !== false,
  signup_enabled: (facts) => !facts.resolveDisableSignUp(facts.declared().emailAndPassword?.disableSignUp),
  require_email_verification: (facts) =>
    resolveEmailVerificationRequirement(
      facts.audiencePosture(),
      facts.declared().emailAndPassword?.requireEmailVerification,
    ),
  // The auth library's own bounds (8 / 128) are the manifest defaults: only a declared bound is stated.
  password_min_length: (facts) => numberOrUndefined(facts.declared().emailAndPassword?.minPasswordLength),
  password_max_length: (facts) => numberOrUndefined(facts.declared().emailAndPassword?.maxPasswordLength),
  // `AuthManager#getMembershipPolicy`.
  membership_policy: (facts) => {
    const declared = facts.declared().membershipPolicy ?? 'auto';
    return isMembershipPolicy(declared) ? declared : undefined;
  },
  // `buildPluginList`: the deployment env, else the declared flag, else off.
  password_reject_breached: (facts) =>
    readBooleanEnv('OS_AUTH_PASSWORD_REJECT_BREACHED') ?? facts.declared().plugins?.passwordRejectBreached ?? false,
  // `assertPasswordComplexity`.
  password_require_complexity: (facts) => Boolean(facts.declared().passwordRequireComplexity),
  password_min_classes: (facts) =>
    Math.min(4, Math.max(1, Math.floor(Number(facts.declared().passwordMinClasses) || 3))),
  // The password history and expiry policy bodies.
  password_history_count: (facts) => Math.floor(Number(facts.declared().passwordHistoryCount) || 0),
  password_expiry_days: (facts) => Math.floor(Number(facts.declared().passwordExpiryDays) || 0),
  // `AuthManager#getDeploymentAccessFloor`.
  mfa_required: (facts) => {
    const declared = facts.declared().mfaRequirement ?? 'off';
    return isMfaRequirementLevel(declared) ? declared : undefined;
  },
  mfa_grace_period_days: (facts) => resolveMfaGracePeriodDays(facts.declared()),
  // `AuthManager#resolveApiKeyLifecyclePolicy` (the ceiling rules the default too).
  api_key_default_expiry_days: (facts) => {
    const declared = facts.declared();
    const max = apiKeyDays(declared.apiKeyMaxExpiryDays, API_KEY_MAX_EXPIRY_DAYS, 1);
    return Math.min(max, apiKeyDays(declared.apiKeyDefaultExpiryDays, API_KEY_DEFAULT_EXPIRY_DAYS, 1));
  },
  api_key_max_expiry_days: (facts) => apiKeyDays(facts.declared().apiKeyMaxExpiryDays, API_KEY_MAX_EXPIRY_DAYS, 1),
  api_key_inactivity_days: (facts) => apiKeyDays(facts.declared().apiKeyInactivityDays, API_KEY_INACTIVITY_DAYS, 0),
  // The auth instance's `session` block, seconds as days.
  session_expiry_days: (facts) => (facts.declared().session?.expiresIn || 60 * 60 * 24 * 7) / 86_400,
  session_refresh_days: (facts) => (facts.declared().session?.updateAge || 60 * 60 * 24) / 86_400,
  // `AuthManager#getDeploymentAccessFloor`.
  session_idle_timeout_minutes: (facts) => facts.declared().sessionIdleTimeoutMinutes ?? 0,
  session_absolute_max_hours: (facts) => facts.declared().sessionAbsoluteMaxHours ?? 0,
  max_concurrent_sessions_per_user: (facts) => facts.declared().maxConcurrentSessions ?? 0,
  allowed_ip_ranges: (facts) => asLines(facts.declared().allowedIpRanges),
  // The sign-in lockout bodies.
  lockout_threshold: (facts) => Number(facts.declared().lockoutThreshold) || 0,
  lockout_duration_minutes: (facts) => Number(facts.declared().lockoutDurationMinutes) || 15,
  // `AuthManager#getAudience` (`resolveAudience`): undeclared or off-vocabulary is `invite_only`.
  audience_posture: (facts) => resolveAudience(facts.declared().audience).posture,
  audience_allowed_email_domains: (facts) => asLines(resolveAudience(facts.declared().audience).allowedEmailDomains),
  audience_self_registration_permission_set: (facts) =>
    resolveAudience(facts.declared().audience).selfRegistrationPermissionSet,
};

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The slice of the settings service this needs (structural: no package dependency). */
export interface DeclaredDefaultHost {
  registerDeclaredDefault?(namespace: string, key: string, provider: () => unknown): void;
}

/**
 * Register every key in {@link AUTH_DECLARED_DEFAULTS}. A settings surface
 * without the seam is skipped, as every optional method of that surface is
 * (`registerLiveStatus`, `subscribe`). A registration that throws leaves that
 * switch reading the manifest default while nothing is stored: said at
 * `warn` (a functional degradation — nothing stored is lost), naming the
 * consequence.
 */
export function registerAuthDeclaredDefaults(
  host: DeclaredDefaultHost,
  facts: AuthDeclaredDefaultFacts,
  logger: { warn(message: string): void },
): void {
  if (typeof host.registerDeclaredDefault !== 'function') return;
  for (const [key, compute] of Object.entries(AUTH_DECLARED_DEFAULTS)) {
    try {
      host.registerDeclaredDefault('auth', key, () => compute(facts));
    } catch (err: any) {
      logger.warn(
        `[auth] Setup → Authentication: the declared default of auth.${key} was NOT registered `
          + `(${String(err?.message ?? err)}), so with nothing saved that setting shows the console default rather `
          + 'than what this deployment runs.',
      );
    }
  }
}
