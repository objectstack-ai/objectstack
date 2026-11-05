// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30201] An organization cannot require multi-factor authentication while
 * nobody can enroll a second factor (ADR-0069 D3).
 *
 * ## The dead end this closes
 *
 * `sys_organization.require_mfa` is a generically editable extension column
 * (`MANAGED_EXTENSION_EDITABLE_FIELDS`): an administrator ticks it on the
 * organization's edit form and it saves. The per-user MFA gate then holds every
 * unenrolled member once their grace period ends (`resolveUserAuthGates`,
 * `MFA_REQUIRED`). The only way to enroll is better-auth's `twoFactor` plugin
 * (`/two-factor/*`), which is off by default; on such a deployment the held
 * member was sent to enroll and the enrollment endpoint answered 404. Every
 * member, the owner included, was locked out, and nobody could undo it from
 * inside the product, because Setup sits behind the same gate.
 *
 * The global switch never had this hole: the `auth.mfa_required` setting
 * applies the requirement and the plugin as ONE piece (`auth-plugin.ts`, the
 * settings binding), so the requirement is never in force without its
 * enrollment path. The organization column had no such pairing.
 *
 * ## Why the write is refused rather than paired
 *
 * The plugin's switch is process configuration — the settings pass and the
 * `OS_AUTH_TWO_FACTOR` env var, re-applied at every boot — and an organization
 * row is data. Turning the plugin on from an organization write would hold in
 * the process that took the write only: it would not survive a restart or
 * reach another node, because nothing that builds the plugin list reads
 * organization rows. And turning it off again when the last organization
 * clears the column would silently drop the second factor of every member who
 * enrolled. So the card's own fallback is taken: the save is refused, and says
 * why and what to do.
 *
 * ## The rule
 *
 * A write to `sys_organization` whose payload sets `require_mfa` to anything
 * but an explicit off value is refused while {@link
 * OrganizationMfaEnrollmentGuardOptions.isTwoFactorEnabled} answers false —
 * `400 VALIDATION_FAILED` with one `fields[]` entry, `require_mfa` /
 * `invalid_value` (the closed ADR-0114 catalog), built by `validationFailure`.
 * Clearing the column, writing other columns, and every write while two-factor
 * is on pass untouched.
 *
 * Judged for EVERY write context, the system's included, like the last-admin
 * guard: the lockout does not depend on who wrote the row. And judged on the
 * payload, not on the stored row, so it covers the by-id path, a multi-row
 * update (whose per-row contexts share one payload) and an insert alike; a
 * form that re-sends `require_mfa: true` for a row stored before this guard is
 * told the requirement is not enforceable, which is true.
 *
 * Rows stored before this guard are not touched. The gate itself does not
 * enforce a requirement nobody can comply with (`resolveUserAuthGates`), so
 * such a row locks no one out; it starts holding members, with a fresh grace
 * window, once two-factor is turned on.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { validationFailure } from '@objectstack/types';

/** After the ADR-0092 D2 identity write guard (10), before default-priority hooks (100). */
export const ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY = 15;

export const REQUIRE_MFA_FIELD = 'require_mfa';

export interface OrganizationMfaEnrollmentGuardOptions {
  packageId: string;
  /**
   * Can a user enroll a second factor right now — is the twoFactor plugin
   * wired? Read per write (`AuthManager.isTwoFactorEnabled`, the same answer
   * the plugin list and `features.twoFactor` give), so a settings pass that
   * turns the plugin on admits the next write.
   */
  isTwoFactorEnabled: () => boolean;
}

/** The engine surface this guard uses. */
export interface OrganizationMfaEnrollmentGuardEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => Promise<void>,
    options?: { object?: string; priority?: number; packageId?: string },
  ): void;
}

/**
 * The values that leave the requirement off. Anything else a payload carries
 * for the column — `true`, `1`, `'true'`, or a value the engine would refuse
 * later anyway — is judged as turning it on, so the guard never admits a value
 * the gate could read as a requirement.
 */
const OFF_VALUES: ReadonlySet<unknown> = new Set([false, 0, '0', 'false', null, undefined]);

/** True when `value`, written to `require_mfa`, turns the requirement on. */
export function turnsMfaRequirementOn(value: unknown): boolean {
  if (typeof value === 'string') return !OFF_VALUES.has(value.trim().toLowerCase());
  return !OFF_VALUES.has(value);
}

/** The refusal: what was refused, why, who it would have locked out, and the two ways forward. */
export function organizationMfaWithoutEnrollmentRefusal(): Error {
  const message =
    'This organization cannot require multi-factor authentication yet: two-factor enrollment is off on this ' +
    'deployment, so once the grace period ended every member, the owner included, would be blocked with no way ' +
    'to enroll an authenticator app. Turn two-factor on first, then require it here: set OS_AUTH_TWO_FACTOR=true ' +
    'on the deployment, or turn on the auth.mfa_required setting, which requires multi-factor authentication for ' +
    'every organization and turns enrollment on with it.';
  return validationFailure(message, [{ field: REQUIRE_MFA_FIELD, code: 'invalid_value', message }]);
}

/** Register the guard's insert and update hooks on `sys_organization`. */
export function registerOrganizationMfaEnrollmentGuard(
  engine: OrganizationMfaEnrollmentGuardEngine,
  opts: OrganizationMfaEnrollmentGuardOptions,
): void {
  const judge = async (ctx: any): Promise<void> => {
    const data = ctx?.input?.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object' || !(REQUIRE_MFA_FIELD in data)) return;
    if (!turnsMfaRequirementOn(data[REQUIRE_MFA_FIELD])) return;
    if (opts.isTwoFactorEnabled()) return;
    throw organizationMfaWithoutEnrollmentRefusal();
  };
  const options = {
    object: SystemObjectName.ORGANIZATION,
    priority: ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY,
    packageId: opts.packageId,
  };
  engine.registerHook('beforeInsert', judge, options);
  engine.registerHook('beforeUpdate', judge, options);
}
