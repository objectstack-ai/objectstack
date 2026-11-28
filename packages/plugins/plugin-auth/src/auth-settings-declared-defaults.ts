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
 * Only the keys whose declaration can differ from their manifest default
 * through a value the deployment itself states, each computed through the
 * formula the running config answers with, so the two cannot disagree:
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
 *
 * Asked by the settings service on each read, never recorded here, so a
 * posture change or a host flag is followed at once.
 */

import type { AudiencePosture } from '@objectstack/spec/system';
import { resolveEmailVerificationRequirement } from './audience-posture.js';
import type { DeclaredAuthOptions } from './auth-settings-declared.js';

/** What a declared default is computed from, all read when asked. */
export interface AuthDeclaredDefaultFacts {
  /** The deployment's own values, captured in `init()` before any setting applied. */
  declared(): DeclaredAuthOptions;
  /** `AuthManager.resolveDisableSignUp`: self-registration off for a declared `disableSignUp`. */
  resolveDisableSignUp(declared: boolean | undefined): boolean;
  /** The audience posture in force (`AuthManager.getAudience().posture`). */
  audiencePosture(): AudiencePosture;
}

/** Each key's declared default, by key. */
export const AUTH_DECLARED_DEFAULTS: Readonly<Record<string, (facts: AuthDeclaredDefaultFacts) => boolean>> = {
  email_password_enabled: (facts) => facts.declared().emailAndPassword?.enabled !== false,
  signup_enabled: (facts) => !facts.resolveDisableSignUp(facts.declared().emailAndPassword?.disableSignUp),
  require_email_verification: (facts) =>
    resolveEmailVerificationRequirement(
      facts.audiencePosture(),
      facts.declared().emailAndPassword?.requireEmailVerification,
    ),
};

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
          + `(${String(err?.message ?? err)}), so with nothing saved that switch shows the console default rather `
          + 'than what this deployment runs.',
      );
    }
  }
}
