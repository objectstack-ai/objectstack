// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D1] Tenancy posture — the deployment's organization-scope shape.
 *
 * Tenancy is a SPECTRUM, not a boolean. The posture is the single fact that
 * decides what the Layer 0 authorization wall enforces, so it lives in the
 * protocol rather than being re-derived per package (the exact drift ADR-0093
 * retired for the two-valued `mode`).
 *
 * | Posture    | Layer 0 wall                              | Shape |
 * |------------|-------------------------------------------|-------|
 * | `single`   | none (inert)                              | one logical tenant; factories modeled as business units in one tree |
 * | `group`    | `organization_id IN accessible_org_ids`   | organizations are membership/invitation boundaries over one shared dataset; union (MOAC) read access |
 * | `isolated` | `organization_id = activeOrganizationId`  | legal-entity / sovereignty isolation — the hard wall |
 *
 * `isolated` is the posture formerly called `multi`; existing configuration
 * maps to it unchanged. `group` is the middle that group-shaped customers
 * (multi-plant manufacturing, multi-branch retail, holding structures) need:
 * group-wide visibility and cross-org workflow are inherent to the shape, and
 * a hard per-org wall makes both an architecture problem.
 *
 * ## Open code, entitled activation
 *
 * The wall's IMPLEMENTATION is open — the Layer 0 compiler, `accessible_org_ids`
 * resolution and the D5 write stamping all ship in open packages — but ENABLING
 * a multi-organization posture (`group` or `isolated`) requires the enterprise
 * `@objectstack/organizations` runtime (ADR-0105 D12). The two are separate
 * questions and must not be conflated: open code does not mean free activation.
 *
 * Cloud ADR-0016's 铁律 (强制免费、治理收费) is satisfied by the first half alone —
 * it guarantees that a deployment RUNNING a multi-org shape is safe, which the
 * platform delivers by REFUSING to run one unwalled (ADR-0093 D5), not by giving
 * the posture away. You never silently get an unenforced organization boundary.
 */

import { z } from 'zod';

/** The three tenancy postures. */
export const TenancyPostureSchema = z.enum(['single', 'group', 'isolated']);
export type TenancyPosture = z.infer<typeof TenancyPostureSchema>;

/** Every posture, in ascending isolation order. */
export const TENANCY_POSTURES: readonly TenancyPosture[] = ['single', 'group', 'isolated'] as const;

/**
 * Does this posture enforce an organization wall at Layer 0?
 *
 * `false` for `single` only. A wall-less posture has NO engine-enforced org
 * boundary, which is why ADR-0105 D4 forbids auto-granting unbounded
 * `viewAllRecords`/`modifyAllRecords` there — nothing would contain it.
 */
export function postureEnforcesWall(posture: TenancyPosture): boolean {
  return posture !== 'single';
}

/**
 * Does this posture require `organization_id` to be stamped on write?
 *
 * True exactly when a wall is enforced: an absent value would land a row behind
 * a wall that then hides it. The STAMPER, however, is the enterprise
 * `@objectstack/organizations` runtime, not the open engine — the same runtime
 * whose presence activates these postures in the first place, so the two can
 * never be out of step. This predicate is the shared vocabulary that runtime
 * compiles against; the open engine only VALIDATES supplied values (the write
 * side of the Layer 0 wall), which is a security property rather than a
 * packaging one.
 */
export function postureStampsOrganization(posture: TenancyPosture): boolean {
  return postureEnforcesWall(posture);
}

/**
 * Does this posture grant READ reach across the caller's whole membership set
 * (union / MOAC semantics) rather than only the active organization?
 *
 * `group` only. In `isolated` the active organization bounds reads; in `single`
 * there is no wall to widen.
 */
export function postureUsesUnionScope(posture: TenancyPosture): boolean {
  return posture === 'group';
}

/**
 * [ADR-0105 D12] The shape the `org-scoping` service may expose to declare which
 * walled postures the installed multi-organization runtime entitles.
 *
 * Presence-of-package answers "may this deployment run multi-org at all"; it
 * cannot answer "which shapes of it" — that is a packaging decision, and the
 * commercial runtime owns it. Declaring the set here lets the enterprise package
 * gate `group` and `isolated` independently (different tiers, a license flag, a
 * trial) without the open core hard-coding anyone's price list.
 *
 * Omitting `supportedPostures` entitles every walled posture, which is what
 * every runtime predating this seam did.
 *
 * ## Per-deployment wall shaping (#12699, cloud#1653 ruling 2026-08-26)
 *
 * The two keys below extend the same seam in the same direction: they are
 * DEPLOYMENT facts declared by the mounted org-scoping runtime — never
 * authorable app metadata — and both FAIL CLOSED: an absent (or unparseable)
 * declaration leaves behaviour byte-identical to a runtime predating the key.
 *
 * They exist because the alternative seams are dead. Host self-declaration of
 * the boundary is a paywall bypass (only a mounted enterprise runtime may
 * declare anything here, which is what keeps the org-create gate intact), and
 * carrying `tenancy` through `objectExtensions` silently drops it in the merge
 * (objectstack#12680). Nor can the per-object authoring channel
 * (`tenancy: { enabled: false }`) express either fact: that declaration travels
 * with the OBJECT into every deployment, while these are facts about ONE
 * deployment — the same object that is platform-global on the platform's own
 * control plane genuinely walls on tenant runtimes.
 */
export interface OrgScopingEntitlement {
  readonly supportedPostures?: readonly TenancyPosture[];
  /**
   * Objects THIS deployment declares platform-global: on this deployment each
   * one gets NO organization column (ADR-0131 D7 — the #12699 declaration
   * made total). The injected-columns plan reads the declaration
   * (`resolveInjectedSystemColumns`' deployment input, `@objectstack/spec/data`),
   * so the engine's schema registry neither injects nor provisions
   * `organization_id` for a declared object and registers it as declaring
   * `systemFields.tenant: false`: Layer 0 and the driver agree by having
   * nothing to scope, and the object is governed by object permission, not by
   * the wall. The same object keeps its column, and walls, on every
   * deployment that does not declare it. It composes with (never replaces)
   * the object-level authoring channel.
   *
   * Read by the ObjectQL plugin at `start()`, before the first schema sync:
   * every `init()` has run by then (ADR-0116, the Phase 1/2 split), so a
   * provider that registers `org-scoping` in its `init()` — and declares it in
   * `providesServices` — has always registered. An object registered earlier
   * is re-planned there, before its table is created.
   *
   * Entries are exact object machine names ({@link PlatformGlobalObjectsSchema}
   * — no wildcards: a pattern would let one declaration drop the column from
   * an open-ended set, and the whole point of the seam is an explicit,
   * auditable carve-out). An object that DECLARES its own `organization_id`
   * keeps that column (it is the author's, not the platform's), walls on it,
   * and is reported once at boot.
   *
   * Fail closed: absent ⇒ every object's plan is byte-identical to a runtime
   * predating the key; a junk shape is refused loudly at the reading seam (the
   * `MembershipPolicy` precedent — never coerced), which also resolves to
   * "absent". Existing rows' column on a declaring deployment is not touched
   * by any boot step (ADR-0131 D14): schema sync is additive, and the column
   * stays as an orphan until the operator removes it.
   */
  readonly platformGlobalObjects?: readonly string[];
  /**
   * When `true`, arming a walled posture must NOT auto-grant the
   * `organization_admin` role's unbounded `viewAllRecords`/`modifyAllRecords`
   * superbits: the membership-driven auto-grant hands out
   * `organization_admin_no_bypass` (the de-VAMA'd variant) instead, on walled
   * postures too. The ADR-0105 D4 rationale for granting the unbounded set
   * under a wall — "Layer 0 bounds it" — stops holding on a deployment that
   * declares objects platform-global with {@link platformGlobalObjects} (they
   * carry no organization column there, so no wall bounds them), so the same
   * runtime that declares the carve-out declares this suppression.
   *
   * Fail closed: absent or `false` ⇒ today's posture-keyed grant; junk is
   * refused loudly and resolves to "absent".
   */
  readonly suppressUnboundedOrgAdminGrant?: boolean;
}

/**
 * [#12699] `platformGlobalObjects` value shape: exact object machine names
 * (the `ObjectSchema.name` grammar), at least one character, no wildcards.
 *
 * A junk shape — a bare string, non-string entries, `''`, `'*'` — must be
 * REFUSED at the consuming seam, never coerced or partially honoured: the
 * declarer is first-party runtime code, so a malformed declaration is a bug to
 * surface, and refusing resolves to the fail-closed default (everything walls).
 */
export const PlatformGlobalObjectsSchema = z
  .array(z.string().regex(/^[a-z_][a-z0-9_]*$/))
  .readonly();
export type PlatformGlobalObjects = z.infer<typeof PlatformGlobalObjectsSchema>;

/**
 * [ADR-0105 D12 / #12699] Runtime twin of {@link OrgScopingEntitlement} for the
 * keys with structural shape requirements. Deliberately a plain (non-strict)
 * object schema: the `org-scoping` service is usually a live plugin instance
 * carrying service machinery alongside the declaration, and unknown keys are
 * not junk. Consumers validate PER KEY (each key fails closed independently)
 * rather than all-or-nothing — see `readDeploymentOrgScopingEntitlement`
 * (`@objectstack/core`).
 */
export const OrgScopingEntitlementSchema = z.object({
  supportedPostures: z.array(TenancyPostureSchema).readonly().optional(),
  platformGlobalObjects: PlatformGlobalObjectsSchema.optional(),
  suppressUnboundedOrgAdminGrant: z.boolean().optional(),
});

/**
 * Normalize a stored/env-supplied posture value, accepting the legacy `multi`
 * spelling as `isolated` (ADR-0093 → ADR-0105 rename). Returns `undefined` for
 * anything unrecognized so callers can fall back deliberately rather than
 * silently landing in a weaker posture.
 */
export function normalizeTenancyPosture(value: unknown): TenancyPosture | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'multi') return 'isolated';
  const parsed = TenancyPostureSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
