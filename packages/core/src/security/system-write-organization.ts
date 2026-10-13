// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0131 D9 — the ONE "which organization does this resolve to?" predicate
 * for a caller that carries no organization of its own: derived when exactly
 * one organization exists under `single`, refused otherwise.
 *
 * ## Why it lives here, in `@objectstack/core`
 *
 * It has two askers, one layer apart:
 *
 *  - the engine's system-context insert (`Engine.resolveSystemInsertOrganization`,
 *    `@objectstack/objectql`, #8844) — the write that carries no organization;
 *  - the guest entry's organization step ({@link resolveGuestOrganization},
 *    ADR-0138 D4) — the anonymous request that carries no organization.
 *
 * ADR-0138 D4 item 2 binds the second to the first's predicate, "never a second
 * spelling of it". `@objectstack/objectql` depends on this package, so the
 * guest step cannot import the engine's copy; the predicate moved down to the
 * layer both askers already depend on, and `@objectstack/objectql` re-exports
 * these exact bindings unchanged (`tenancy/system-write-organization.ts`), so
 * every existing import of it keeps resolving to this one function. The same
 * relocation `isMissingTableError` made to `@objectstack/types` for the same
 * reason: a second copy of a security-relevant classifier is the defect.
 *
 * The refusal each asker raises stays its own: the engine's
 * `SystemWriteOrganizationRequiredError` speaks to an automation author about a
 * write, the guest step's refusal speaks to an anonymous caller about a door.
 * Only the DECISION is shared.
 */

import type { TenancyPosture } from '@objectstack/spec/security';

/**
 * Why no organization could be derived. Each is a refusal: nothing defaults
 * to any organization but the derivable one (ADR-0131 D9).
 */
export type SystemWriteRefusalReason =
  /**
   * A walled posture (`group` / `isolated`). Organizations are a real boundary
   * here, so "the install's organization" is not a thing that exists.
   */
  | 'walled-posture'
  /**
   * The posture says `single` but the data holds several organizations. The
   * posture is what the deployment ASKED for; the count is what the data
   * actually is, and where they disagree there is no unambiguous answer — the
   * topology is refused rather than given a guessed default.
   * #8686's backfill draws the same line (`skipped-ambiguous-organization`).
   */
  | 'ambiguous-organization'
  /**
   * The posture says `single`, the composition registers the organization
   * object, and it holds NO organization. Under ADR-0131 D3 the Default
   * Organization exists before anything writes (plugin-auth creates it at
   * boot, and a failure to is a boot error), so this is the boot invariant
   * broken — and there is no owner to derive, which D9 refuses rather than
   * guessing.
   */
  | 'no-organization';

/**
 * What a caller with no organization of its own resolves to.
 *
 * `refuse` is a decision, not a throw: each asker turns it into its own
 * refusal, so the decision stays a pure, directly-testable function of the
 * facts.
 */
export type SystemWriteOrganizationDecision =
  /**
   * Nothing to resolve — this COMPOSITION registers no organization object at
   * all (a lean embedding, a bare-kernel test), so no organization can exist
   * and there is nothing to stamp or to refuse in the name of.
   *
   * ⚠️ Deliberately NOT "the install has no organization yet". That reading
   * used to share this kind, and it was the normal state of a fresh `single`
   * boot while the Default Organization arrived only with the first sign-up.
   * ADR-0131 D3 made that organization load-bearing — it exists before the
   * application seeds and before the listener — so a `single` install that
   * registers `sys_organization` and holds none of it is the boot invariant
   * broken, and is refused (`no-organization`) like every other topology with
   * no derivable owner (D9). Only the composition with no organization object
   * keeps this branch; whether D9's refusal also reaches it is ADR-0131 C8's
   * question, not this one's.
   */
  | { kind: 'no-organization-object' }
  /** Exactly one organization under `single`, so the answer is derivable. */
  | { kind: 'derived'; organizationId: string }
  /** No derivable answer: refuse loudly rather than default to any organization. */
  | { kind: 'refuse'; reason: SystemWriteRefusalReason; organizationCount?: number };

/**
 * Resolve the organization a caller with no organization of its own acts in
 * (ADR-0131 D9): derived at exactly one organization under `single`, refused
 * at zero, at several, and under a wall.
 *
 * `probeOrganizations` is called ONLY on the single-tenant branch — a walled
 * posture is refused without asking the database anything, because the answer
 * could not change the verdict.
 *
 * `organizationObjectRegistered` separates the two facts an empty probe can
 * mean: an install with the organization object and none of its rows (refused,
 * `no-organization`) and a composition with no organization object at all
 * (`no-organization-object`, unchanged). It is a required input, not a
 * defaulted one: a caller that does not know the answer must not be handed the
 * permissive reading by omission.
 */
export async function resolveSystemWriteOrganization(args: {
  posture: TenancyPosture;
  /** Organization ids, capped at 2 by the caller — only "0 / 1 / several" matters. */
  probeOrganizations: () => Promise<readonly string[]>;
  /** Does this composition register the organization object (`sys_organization`) at all? */
  organizationObjectRegistered: boolean;
}): Promise<SystemWriteOrganizationDecision> {
  if (args.posture !== 'single') {
    return { kind: 'refuse', reason: 'walled-posture' };
  }
  const ids = await args.probeOrganizations();
  if (ids.length === 0) {
    return args.organizationObjectRegistered
      ? { kind: 'refuse', reason: 'no-organization', organizationCount: 0 }
      : { kind: 'no-organization-object' };
  }
  if (ids.length === 1) return { kind: 'derived', organizationId: ids[0] };
  return { kind: 'refuse', reason: 'ambiguous-organization', organizationCount: ids.length };
}
