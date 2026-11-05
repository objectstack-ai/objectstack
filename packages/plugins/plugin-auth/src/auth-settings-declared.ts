// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30312] What a cleared `auth.*` setting hands the running config back to.
 *
 * A stored `auth.*` value rules the manager while it is stored. When it is
 * cleared (the console sends `null`) or the namespace is restored to its
 * defaults, the key resolves `source: 'default'`, and the running value returns
 * in the same pass to what the deployment itself declared: the plugin options
 * and `auth:configure` handlers, as the boot pass handed them to the manager,
 * and the manager's own built-in default where they declared nothing. The
 * manifest default is a console default and never rules here.
 *
 * Two pieces live here, both data:
 *
 *  - {@link captureDeclaredAuthOptions} takes the declared values once, in
 *    `init()`, before any setting is applied.
 *  - {@link AUTH_SETTING_RESTORE} names, for every key the settings pass
 *    applies, the piece its declared value goes back through. A key whose
 *    stored value lands in a block the manager can refuse (`emailAndPassword`,
 *    `plugins`, `audience`) restores through that same block, so the manager
 *    judges a restored value exactly as it judges a saved one. Keys that rule
 *    one runtime value together (the rate-limit pair, the Google trio, the
 *    audience trio) restore as a group, and only once none of them is stored.
 */

import type { AuthManagerOptions } from './auth-manager.js';

/** The manager options a stored `auth.*` setting can drive. */
const DECLARED_FIELDS = [
  'emailAndPassword',
  'membershipPolicy',
  'plugins',
  'passwordRequireComplexity',
  'passwordMinClasses',
  'passwordHistoryCount',
  'passwordExpiryDays',
  'mfaRequired',
  'mfaGracePeriodDays',
  'apiKeyDefaultExpiryDays',
  'apiKeyMaxExpiryDays',
  'apiKeyInactivityDays',
  'apiKeyPolicyStartedAt',
  'session',
  'sessionIdleTimeoutMinutes',
  'sessionAbsoluteMaxHours',
  'maxConcurrentSessions',
  'allowedIpRanges',
  'lockoutThreshold',
  'lockoutDurationMinutes',
  'rateLimit',
  'audience',
] as const satisfies ReadonlyArray<keyof AuthManagerOptions>;

type DeclaredField = (typeof DECLARED_FIELDS)[number];

/** The deployment's own values for {@link DECLARED_FIELDS}, taken before any setting applies. */
export type DeclaredAuthOptions = Readonly<Pick<AuthManagerOptions, DeclaredField>>;

/** A fresh copy one level deep, so the manager never shares an object with the snapshot. */
export function copyDeclared<T>(value: T): T {
  if (Array.isArray(value)) return [...value] as T;
  if (value !== null && typeof value === 'object') return { ...(value as object) } as T;
  return value;
}

/**
 * The declared values, as the boot pass hands them to the manager: call it in
 * `init()` after `auth:configure`, on the config the manager is built from.
 */
export function captureDeclaredAuthOptions(config: AuthManagerOptions): DeclaredAuthOptions {
  const declared: Record<string, unknown> = {};
  for (const field of DECLARED_FIELDS) declared[field] = copyDeclared(config[field]);
  return declared as DeclaredAuthOptions;
}

type EmailAndPasswordField = keyof NonNullable<AuthManagerOptions['emailAndPassword']>;

/** The piece a key's declared value goes back through. */
export type AuthSettingRestore =
  /** A top-level option the manager does not judge: rides the pass's plain patch. */
  | { readonly via: 'patch'; readonly field: DeclaredField }
  /** A field of `emailAndPassword`: its own refusable piece, judged by `assertAudienceConfig`. */
  | { readonly via: 'emailAndPassword'; readonly field: EmailAndPasswordField }
  /** A flag of `plugins`: its own refusable piece, judged by `assertScimAdminCoherence`. */
  | { readonly via: 'plugins'; readonly field: 'passwordRejectBreached' }
  /** A field of `session`, merged over the declared `session` object. */
  | { readonly via: 'session'; readonly field: 'expiresIn' | 'updateAge' }
  /** Enforced MFA: restored exactly as a save of the declared value would apply. */
  | { readonly via: 'mfaRequired' }
  /** One runtime value ruled by several keys: restored whole once none of them is stored. */
  | { readonly via: 'group'; readonly group: 'rateLimit' | 'google' | 'audience' };

/**
 * Every key the auth settings pass applies, and how its declared value comes
 * back. `auth-settings-clear.pin.test.ts` holds this table to the shipped auth
 * manifest: a manifest key missing here is a clear that would not take effect.
 */
export const AUTH_SETTING_RESTORE: Readonly<Record<string, AuthSettingRestore>> = {
  email_password_enabled: { via: 'emailAndPassword', field: 'enabled' },
  signup_enabled: { via: 'emailAndPassword', field: 'disableSignUp' },
  require_email_verification: { via: 'emailAndPassword', field: 'requireEmailVerification' },
  password_min_length: { via: 'emailAndPassword', field: 'minPasswordLength' },
  password_max_length: { via: 'emailAndPassword', field: 'maxPasswordLength' },
  membership_policy: { via: 'patch', field: 'membershipPolicy' },
  password_reject_breached: { via: 'plugins', field: 'passwordRejectBreached' },
  password_require_complexity: { via: 'patch', field: 'passwordRequireComplexity' },
  password_min_classes: { via: 'patch', field: 'passwordMinClasses' },
  password_history_count: { via: 'patch', field: 'passwordHistoryCount' },
  password_expiry_days: { via: 'patch', field: 'passwordExpiryDays' },
  mfa_required: { via: 'mfaRequired' },
  mfa_grace_period_days: { via: 'patch', field: 'mfaGracePeriodDays' },
  api_key_default_expiry_days: { via: 'patch', field: 'apiKeyDefaultExpiryDays' },
  api_key_max_expiry_days: { via: 'patch', field: 'apiKeyMaxExpiryDays' },
  api_key_inactivity_days: { via: 'patch', field: 'apiKeyInactivityDays' },
  api_key_policy_started_at: { via: 'patch', field: 'apiKeyPolicyStartedAt' },
  session_expiry_days: { via: 'session', field: 'expiresIn' },
  session_refresh_days: { via: 'session', field: 'updateAge' },
  session_idle_timeout_minutes: { via: 'patch', field: 'sessionIdleTimeoutMinutes' },
  session_absolute_max_hours: { via: 'patch', field: 'sessionAbsoluteMaxHours' },
  max_concurrent_sessions_per_user: { via: 'patch', field: 'maxConcurrentSessions' },
  allowed_ip_ranges: { via: 'patch', field: 'allowedIpRanges' },
  lockout_threshold: { via: 'patch', field: 'lockoutThreshold' },
  lockout_duration_minutes: { via: 'patch', field: 'lockoutDurationMinutes' },
  rate_limit_max: { via: 'group', group: 'rateLimit' },
  rate_limit_window_seconds: { via: 'group', group: 'rateLimit' },
  google_enabled: { via: 'group', group: 'google' },
  google_client_id: { via: 'group', group: 'google' },
  google_client_secret: { via: 'group', group: 'google' },
  audience_posture: { via: 'group', group: 'audience' },
  audience_allowed_email_domains: { via: 'group', group: 'audience' },
  audience_self_registration_permission_set: { via: 'group', group: 'audience' },
};

/** The keys of one restore group. */
export function restoreGroupKeys(group: 'rateLimit' | 'google' | 'audience'): string[] {
  return Object.entries(AUTH_SETTING_RESTORE)
    .filter(([, arm]) => arm.via === 'group' && arm.group === group)
    .map(([key]) => key);
}
