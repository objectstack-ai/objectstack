// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12699 / cloud#1653] Read the per-deployment wall-shaping keys off the
 * mounted `org-scoping` service (`OrgScopingEntitlement`,
 * `@objectstack/spec/security`).
 *
 * ## Why it lives in core
 *
 * The two keys have two consumers in two packages that cannot import each
 * other: the engine's schema registry (`@objectstack/objectql`) plans the
 * columns from `platformGlobalObjects` (ADR-0131 D7: a declared object gets no
 * organization column on this deployment), and `@objectstack/plugin-security`
 * shapes the `organization_admin` auto-grant from
 * `suppressUnboundedOrgAdminGrant`. Both depend on this package, so the ONE
 * reader — and its fail-closed contract — lives here. Each caller warns for
 * the refused key it consumes, and only that one.
 *
 * ## Why a reader, and why it fails closed per key
 *
 * The `org-scoping` service is the enterprise runtime's own object — a live
 * plugin instance, not a parsed document — so its declaration arrives through
 * an untyped boundary exactly like the `auth.membership_policy` setting did.
 * The `MembershipPolicy` precedent (`@objectstack/plugin-auth`,
 * reconcile-membership.ts) governs what happens to a value the type would have
 * rejected: it is REFUSED loudly with a verdict naming the offending value,
 * never coerced onto a permissive branch. Here the non-permissive branch is
 * "the key was never declared":
 *
 *   - `platformGlobalObjects` junk ⇒ NO object is declared (every object's
 *     injected-columns plan is exactly what its own declaration says);
 *   - `suppressUnboundedOrgAdminGrant` junk ⇒ the auto-grant keeps today's
 *     posture-keyed behaviour.
 *
 * Each key is validated INDEPENDENTLY: junk in one must not silently void the
 * other's valid declaration (all-or-nothing refusal would turn one typo into
 * two behaviour changes, only one of which the log line explains).
 *
 * ⛔ Partial honouring is refusal's other failure mode: one junk ENTRY voids
 * the whole `platformGlobalObjects` key rather than dropping the entry. The
 * declarer is first-party runtime code; half-honouring a malformed list hides
 * the bug behind mostly-working behaviour, while a whole-key refusal keeps the
 * organization column (and the wall) on every named object — loud on the
 * first smoke test, and safe.
 *
 * ## Read timing
 *
 * The reader itself is pure and cheap; validation is memoized per service
 * instance (WeakMap), so callers may read it live — the same pattern as the
 * seam's existing consumer (`plugin-auth`'s `probeEntitledPostures`, which
 * resolves `getService('org-scoping')` per call precisely because the provider
 * registers after the reader's own init). A re-registered service is a new
 * instance and re-validates; in-place mutation of a declaration is outside the
 * contract (the interface is readonly, and every declared key is expected to
 * be constant for the kernel's life). The engine reads `platformGlobalObjects`
 * once, at its plugin's `start()`, before the first schema sync — see
 * `SchemaRegistry.setDeploymentPlatformGlobalObjects` for the ordering.
 */

import {
  PlatformGlobalObjectsSchema,
  type OrgScopingEntitlement,
} from '@objectstack/spec/security';

/** One refused key, for the caller's loud warn (the caller owns logging). */
export interface RefusedEntitlementKey {
  readonly key: 'platformGlobalObjects' | 'suppressUnboundedOrgAdminGrant';
  /** Human-readable shape complaint, stable enough to warn-once on. */
  readonly problem: string;
  /** The offending declared value, for the log line. */
  readonly value: unknown;
}

/** The validated, fail-closed reading of the deployment's declaration. */
export interface DeploymentOrgScopingEntitlementReading {
  /**
   * Objects this deployment declares platform-global — each gets no
   * organization column on this deployment (ADR-0131 D7). Empty when the key is
   * absent, junk, or no service is mounted.
   */
  readonly platformGlobalObjects: ReadonlySet<string>;
  /**
   * Whether the walled-posture `organization_admin` auto-grant must hand out
   * the de-VAMA'd variant. `false` when absent, junk, or no service is mounted.
   */
  readonly suppressUnboundedOrgAdminGrant: boolean;
  /** Keys whose declared value was refused — non-empty ⇒ the caller warns. */
  readonly refused: readonly RefusedEntitlementKey[];
}

const ABSENT: DeploymentOrgScopingEntitlementReading = Object.freeze({
  platformGlobalObjects: new Set<string>(),
  suppressUnboundedOrgAdminGrant: false,
  refused: [],
});

/** Validation memo, keyed on the service instance (declarations are readonly). */
const readingMemo = new WeakMap<object, DeploymentOrgScopingEntitlementReading>();

/**
 * Validate the deployment's `OrgScopingEntitlement` wall-shaping keys.
 *
 * `service` is whatever `getService('org-scoping')` returned — `undefined`/
 * non-object resolves to the fail-closed ABSENT reading. Never throws.
 */
export function readDeploymentOrgScopingEntitlement(
  service: unknown,
): DeploymentOrgScopingEntitlementReading {
  if (service === null || typeof service !== 'object') return ABSENT;
  const memoized = readingMemo.get(service);
  if (memoized) return memoized;

  const declared = service as Partial<OrgScopingEntitlement> & Record<string, unknown>;
  const refused: RefusedEntitlementKey[] = [];

  let platformGlobalObjects: ReadonlySet<string> = ABSENT.platformGlobalObjects;
  const rawObjects = declared.platformGlobalObjects;
  if (rawObjects !== undefined) {
    const parsed = PlatformGlobalObjectsSchema.safeParse(rawObjects);
    if (parsed.success) {
      platformGlobalObjects = new Set(parsed.data);
    } else {
      refused.push({
        key: 'platformGlobalObjects',
        problem:
          'must be an array of exact object machine names (^[a-z_][a-z0-9_]*$ — no wildcards, no empty strings); ' +
          'the whole key is refused and NO object is exempted (fail closed)',
        value: rawObjects,
      });
    }
  }

  let suppressUnboundedOrgAdminGrant = false;
  const rawSuppress = declared.suppressUnboundedOrgAdminGrant;
  if (rawSuppress !== undefined) {
    if (typeof rawSuppress === 'boolean') {
      suppressUnboundedOrgAdminGrant = rawSuppress;
    } else {
      refused.push({
        key: 'suppressUnboundedOrgAdminGrant',
        problem:
          'must be a boolean; the key is refused and the walled-posture organization_admin ' +
          'auto-grant keeps today\'s behaviour (fail closed)',
        value: rawSuppress,
      });
    }
  }

  const reading: DeploymentOrgScopingEntitlementReading = Object.freeze({
    platformGlobalObjects,
    suppressUnboundedOrgAdminGrant,
    refused,
  });
  readingMemo.set(service, reading);
  return reading;
}
