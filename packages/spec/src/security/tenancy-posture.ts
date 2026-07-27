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
 * The wall's CORRECTNESS is never a paid feature (cloud ADR-0016 铁律): every
 * posture is enforced by the open engine. What stays commercial is managing
 * organizations at scale, not being safe.
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
 * Does this posture stamp and validate `organization_id` on write (ADR-0105 D5)?
 * True exactly when a wall is enforced — the write side must be the twin of the
 * read side or a forged/absent value would slip under the wall.
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
