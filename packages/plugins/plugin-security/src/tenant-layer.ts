// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { RLS_DENY_FILTER } from './rls-compiler.js';

/**
 * ── Layer 0: tenant isolation (ADR-0095 D1) ─────────────────────────────────
 *
 * The tenant wall lives HERE — outside the RLS (business-policy) compiler — as
 * an independent, always-first, AND-composed filter. It shares no compiler, no
 * merge step, and no bypass bit with Layer 1 (business RLS), so a business-RLS
 * change can never weaken tenant isolation (W1), and the superuser business-RLS
 * bypass can never cross the tenant wall (W2).
 *
 * Effective read/write filter = `Layer0(tenant) AND Layer1(business RLS)`.
 *
 * This module deliberately does NOT reuse `security-plugin`'s `extractTargetField`
 * (which recognizes only the legacy single-`=`/`IN` shape, not canonical `==`);
 * it decides "is this a tenant object?" directly from the object's field set and
 * tenancy posture. That is what makes ADR-0095 delta (c) — a member reading a
 * `tenancy.enabled:false` global object — resolve correctly (see tracking issue
 * for the broader `extractTargetField` `==` blind spot, which still affects
 * Layer-1 business policies and is out of scope for D1).
 */

/** Inputs the Layer 0 decision needs — all cheap, already-loaded facts. */
export interface TenantLayer0Input {
  /**
   * True iff multi-org isolation is actually active (ADR-0093 `tenancy.mode ===
   * 'multi'` / `tenancy.isolationActive`). In `single` mode Layer 0 is inert.
   */
  isolationActive: boolean;
  /** The resolved authz context's active organization id (`ExecutionContext.tenantId`). */
  organizationId?: string;
  /**
   * Whether the object carries an `organization_id` column. `undefined` = the
   * schema/field-set could not be resolved yet (boot); treated as "assume tenant
   * object" so a not-yet-registered object still fails safe toward isolation
   * (parity with the pre-extraction path, which kept the wildcard tenant policy
   * when the field set was unavailable).
   */
  objectHasOrgIdField?: boolean;
  /**
   * Whether the object opted out of tenancy (`tenancy.enabled === false` or
   * `systemFields.tenant === false`) — a platform-global object. Such objects
   * are NOT tenant objects; Layer 0 contributes nothing.
   */
  tenancyDisabled: boolean;
  /**
   * Whether the object's POSTURE permits a platform admin to cross the tenant
   * wall — `private`, platform-global (`tenancy.enabled:false`), or
   * better-auth-managed (exactly the ADR-0066 ① gate). Business (public) tenant
   * objects do NOT permit it, so a platform admin stays org-scoped on them.
   */
  posturePermitsCrossTenant: boolean;
  /**
   * TRUE-platform-admin evidence (ADR-0095 D3 `PLATFORM_ADMIN` rung) for THIS
   * operation side. This is the ONLY gate that lets a caller cross the tenant
   * wall, so it MUST distinguish a PLATFORM operator from a TENANT `org_admin`.
   *
   * It is NOT merely the superuser bit (`viewAllRecords`/`modifyAllRecords`):
   * `organization_admin` holds that bit via its `'*'` wildcard grant
   * (`default-permission-sets.ts`), so gating the exemption on the superuser bit
   * alone let an org admin cross the wall on a `private` (or platform-global /
   * better-auth) TENANT object — the D1 "B2 posture stand-in" gap this field's
   * former semantics carried. The caller now requires the superuser bit AND a
   * platform-EXCLUSIVE capability (`manage_metadata`/`manage_platform_settings`/
   * `studio.access`/`manage_users` — the caps `admin_full_access` carries and
   * `organization_admin` deliberately withholds), i.e. the `PLATFORM_ADMIN`
   * posture. It is NEVER the better-auth role.
   */
  isPlatformAdmin: boolean;
}

/**
 * Compute the Layer 0 (tenant) filter to AND onto a read/write.
 *
 * - `null` → Layer 0 contributes nothing (single mode; non-tenant object; or an
 *   exempt platform admin). The caller applies only Layer 1.
 * - `{ organization_id }` → the tenant wall, AND-composed unconditionally.
 * - {@link RLS_DENY_FILTER} → multi mode on a tenant object but the context has
 *   no active organization → fail closed (zero rows / write denied).
 */
export function computeTenantLayer0Filter(
  input: TenantLayer0Input,
): Record<string, unknown> | null {
  // `single` mode / isolation absent → parity with today's policy stripping.
  if (!input.isolationActive) return null;

  // Not a tenant object: platform-global (tenancy disabled) or simply carries no
  // `organization_id` column (e.g. better-auth identity tables like `sys_user`).
  // Layer 0 contributes nothing — the object's own business RLS (Layer 1, e.g.
  // `_self` carve-outs) is its only scoping.
  if (input.tenancyDisabled) return null;
  if (input.objectHasOrgIdField === false) return null;

  // Exemption is a Layer 0 rule (W2 fix): only a TRUE PLATFORM_ADMIN caller on an
  // object whose posture permits it crosses the wall — NOT a tenant `org_admin`
  // that merely holds the superuser bit (Finding 2 / #2937). Layer 1's superuser
  // bypass no longer implies Layer 0's.
  if (input.isPlatformAdmin && input.posturePermitsCrossTenant) return null;

  // Enforce the wall. Missing active org in multi mode → fail closed.
  if (!input.organizationId) return { ...RLS_DENY_FILTER };
  return { organization_id: input.organizationId };
}

/**
 * AND-compose Layer 0 onto Layer 1. Layer 0 is placed FIRST (outermost) so the
 * tenant predicate is always evaluated and can never be widened by a Layer 1
 * disjunction. `null` on either side means "no contribution".
 */
export function andComposeLayers(
  layer0: Record<string, unknown> | null,
  layer1: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (layer0 == null) return layer1;
  if (layer1 == null) return layer0;
  return { $and: [layer0, layer1] };
}
