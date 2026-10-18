// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  postureEnforcesWall,
  postureUsesUnionScope,
  type TenancyPosture,
  type TenantLayer0Verdict,
} from '@objectstack/spec/security';

/**
 * ── The ONE tenant read predicate (ADR-0131 D8 「一道谓词，算一次」) ──────────
 *
 * What the organization wall decides for one operation, computed by ONE
 * function for both of its enforcers:
 *
 * - **Layer 0** (`plugin-security`'s `tenant-layer.ts`, ADR-0095 D1) projects
 *   the verdict onto the `where` predicate it AND-composes first, and records
 *   it on the operation (`OperationContext.tenantLayer0Verdict`, #15813);
 * - **the engine** (`@objectstack/objectql`, `buildDriverOptions`) projects the
 *   same verdict onto `DriverOptions.tenantId` / `tenantIds`, the driver's
 *   native read scope — the recorded verdict where the wall ran, this function
 *   over the engine's own facts where it did not (a system context, a by-id
 *   write, a composition with no security layer).
 *
 * Before this module the engine derived the driver's scope on its own, from
 * the active organization alone: a scope under `single`, where the wall is
 * inert, and a scope for the exempt platform admin, whom the wall lets
 * through — two walls, two answers. Here, so `@objectstack/objectql` and
 * `@objectstack/plugin-security` (both already depend on this package) read
 * one decision rather than two copies of it.
 */

/** Inputs the Layer 0 decision needs — all cheap, already-loaded facts. */
export interface TenantLayer0Input {
  /**
   * [ADR-0105 D1] The tenancy posture actually IN FORCE (`tenancy.posture`) —
   * the single fact that decides what this layer enforces:
   *
   * - `single`   → inert (no wall)
   * - `group`    → `organization_id IN accessibleOrgIds` (union / MOAC)
   * - `isolated` → `organization_id = organizationId` (the hard wall)
   *
   * A degraded deployment (a wall requested but not enforceable) already
   * resolves to `single` at the service, so this layer never sees a posture it
   * cannot honour.
   */
  tenancyPosture: TenancyPosture;
  /** The resolved authz context's active organization id (`ExecutionContext.tenantId`). */
  organizationId?: string;
  /**
   * [ADR-0105 D2] The caller's org access set
   * (`ExecutionContext.accessible_org_ids`) — every organization they hold a
   * currently-valid membership in. Read ONLY under the `group` posture, where
   * it is the wall. An empty/absent set there denies (fail closed): a principal
   * with no membership has no group data reach.
   */
  accessibleOrgIds?: readonly string[];
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
   * posture. It is NEVER the better-auth role. A caller holding no permission
   * sets (the engine, over its own facts) passes `false`.
   */
  isPlatformAdmin: boolean;
}

/** The two verdicts that carry no organization — shared, frozen, safe to hand out. */
const LAYER0_NONE: TenantLayer0Verdict = Object.freeze({ kind: 'none' as const });
const LAYER0_DENY: TenantLayer0Verdict = Object.freeze({ kind: 'deny' as const });

/**
 * [#15813 / ADR-0131 D8] Compute the Layer 0 VERDICT — what the wall decides
 * for this operation, as a value another package can read without re-deriving
 * it (`TenantLayer0VerdictSchema`, `@objectstack/spec/security`).
 * `computeTenantLayer0Filter` (plugin-security) is this verdict PROJECTED onto
 * a `where` predicate; the engine's driver scope is the same verdict projected
 * onto `DriverOptions`. Neither can disagree with the other, because both are
 * derived from this verdict, never computed beside it.
 *
 * The decision ladder is the wall's own, in the wall's own order: every exit
 * that answers `null` as a filter answers `none` here, every fail-closed exit
 * answers `deny`, and the two walled shapes answer the organization(s) they
 * name. The `group` set is DEDUPLICATED here (`accessible_org_ids` is a
 * membership list; a repeated membership names one organization once), so a
 * reader may test `organizationIds.length === 1` and read no further.
 *
 * - `none` → the wall contributes nothing (`single` posture; non-tenant object;
 *   or an exempt platform admin).
 * - `organization` → the `isolated` wall, `organization_id = <id>`.
 * - `organizations` → the `group` union wall, `organization_id IN <set>`
 *   (ADR-0105 D2).
 * - `deny` → a walled posture on a tenant object, but the context carries no
 *   organization scope to enforce with (no active org under `isolated`, empty
 *   access set under `group`) → fail closed (zero rows / write denied).
 */
export function computeTenantLayer0Verdict(input: TenantLayer0Input): TenantLayer0Verdict {
  // `single` posture (incl. a degraded deployment, which resolves to `single`)
  // → parity with today's policy stripping.
  if (!postureEnforcesWall(input.tenancyPosture)) return LAYER0_NONE;

  // Not a tenant object: platform-global (tenancy disabled) or simply carries no
  // `organization_id` column (e.g. better-auth identity tables like `sys_user`).
  // Layer 0 contributes nothing — the object's own business RLS (Layer 1, e.g.
  // `_self` carve-outs) is its only scoping.
  if (input.tenancyDisabled) return LAYER0_NONE;
  if (input.objectHasOrgIdField === false) return LAYER0_NONE;

  // Exemption is a Layer 0 rule (W2 fix): only a TRUE PLATFORM_ADMIN caller on an
  // object whose posture permits it crosses the wall — NOT a tenant `org_admin`
  // that merely holds the superuser bit (Finding 2 / #2937). Layer 1's superuser
  // bypass no longer implies Layer 0's.
  if (input.isPlatformAdmin && input.posturePermitsCrossTenant) return LAYER0_NONE;

  // [ADR-0105 D2] `group`: union access over the caller's memberships (MOAC).
  // The ACTIVE organization no longer bounds reads here — membership does — so
  // a group-HQ analyst sees every plant they belong to on one screen without
  // context switching, and a plant admin still sees only their own plants.
  // An empty access set is the fail-closed case: no membership, no reach.
  if (postureUsesUnionScope(input.tenancyPosture)) {
    const orgIds = input.accessibleOrgIds;
    if (!orgIds || orgIds.length === 0) return LAYER0_DENY;
    return { kind: 'organizations', organizationIds: [...new Set(orgIds)] };
  }

  // `isolated`: the hard wall. Missing active org → fail closed.
  if (!input.organizationId) return LAYER0_DENY;
  return { kind: 'organization', organizationId: input.organizationId };
}
