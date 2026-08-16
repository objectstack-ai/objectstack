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
 */
export interface OrgScopingEntitlement {
  readonly supportedPostures?: readonly TenancyPosture[];
}

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
