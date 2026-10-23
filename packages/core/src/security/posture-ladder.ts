// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ── The monotonic posture ladder (ADR-0095 D2/D3) ───────────────────────────
 *
 * The principal-tiering enum resolved ONCE in `resolveAuthzContext`
 * (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER > EXTERNAL`). This module owns two
 * things and deliberately nothing more:
 *
 *  1. **Derivation (D3).** {@link derivePosture} maps held *capability grants*
 *     — never a better-auth role — to a rung. `PLATFORM_ADMIN` derives from the
 *     unscoped `admin_full_access` grant (the `viewAllRecords`/`modifyAllRecords`
 *     evidence the superuser bypass already trusts); `TENANT_ADMIN` from the
 *     `organization_admin` grant. The better-auth `role='admin'` is upstream a
 *     *provisioning source* of those grants (`auto-org-admin-grant.ts`), so it
 *     never re-enters adjudication here — the #2836 dual-track class is closed
 *     by construction. `EXTERNAL` derives from holding the reserved identity
 *     `org_external`, which the resolver projects from the membership row once
 *     (never re-read from the role here).
 *
 *  2. **The rung → injection-rule mapping + its tested invariants (D2).** Each
 *     rung maps to EXACTLY ONE row-visibility injection rule
 *     ({@link POSTURE_INJECTION_RULE}). {@link postureVisibleRows} is the
 *     REFERENCE MODEL of those rules over a synthetic row-set — it locks the two
 *     properties the ADR requires as invariants: strict nesting (rung n's
 *     visible set ⊇ rung n−1's) and the EXTERNAL deny-by-default semantics
 *     (explicit grants only, OWD never widens it).
 *
 * This module is NOT the enforcement path. The effective read/write filter is
 * `Layer0(tenant) AND Layer1(business RLS)`, computed in `@objectstack/plugin-
 * security` (`tenant-layer.ts` + `security-plugin.ts`), and the real behavior
 * guard is the `authz-matrix-gate` unit snapshot + the dogfood conformance
 * matrix. The reference model here exists so the ladder's *mathematical*
 * properties can be asserted at the unit layer without an enforcement boot.
 *
 * [Ruling of record 6355206139, letter B] The EXTERNAL rung is live: its
 * holders are the organization's `external` members (`sys_member.role =
 * external`, projected to the reserved identity `org_external`), and its rule
 * is re-ruled from "explicit shares only" to EXPLICIT GRANTS only — shares
 * (share links included), sharing rules, and position and permission-set
 * grants with their RLS evaluated. Enforcement: the `everyone` anchor withheld
 * (`resolve-authz-context.ts`), the `external_default` baseline
 * (`plugin-security`), the OWD floor (`plugin-sharing`), the directory doors
 * (`plugin-auth`).
 */

import type { AuthzPosture } from '@objectstack/spec/security';

/**
 * The rung ordering, high privilege → low, matching the spec enum's numeric
 * values (`PLATFORM_ADMIN=3 … EXTERNAL=0`). Visibility grows monotonically UP
 * this ladder (see {@link postureVisibleRows}).
 */
export const POSTURE_LADDER = [
  'PLATFORM_ADMIN',
  'TENANT_ADMIN',
  'MEMBER',
  'EXTERNAL',
] as const satisfies readonly AuthzPosture[];

/** Numeric rank per rung (mirrors the spec `AuthzPosture` enum values). */
export const POSTURE_RANK: Record<AuthzPosture, number> = {
  PLATFORM_ADMIN: 3,
  TENANT_ADMIN: 2,
  MEMBER: 1,
  EXTERNAL: 0,
};

/**
 * The ONE row-visibility injection rule each rung maps to (ADR-0095 D2). Prose,
 * because the machine artifacts live in enforcement (Layer 0 + the per-rung
 * Layer 1 rule); this is the enumerable contract the explain track reports and
 * {@link postureVisibleRows} models.
 */
export const POSTURE_INJECTION_RULE: Record<AuthzPosture, string> = {
  PLATFORM_ADMIN:
    'Layer 0 exemption where the object posture permits (private / platform-global / better-auth-managed) — crosses the tenant wall; org-scoped like TENANT_ADMIN on ordinary tenant business objects.',
  TENANT_ADMIN:
    'All rows within the active organization (organization_id == ctx.tenantId); no ownership / depth / sharing narrowing.',
  MEMBER:
    'Business RLS within the organization — ownership (owner / unit depth), the OWD baseline, and explicit sharing.',
  EXTERNAL:
    'Explicit grants ONLY — shares (share links included), sharing rules, and position and permission-set grants with their RLS evaluated, within the organization. The OWD baseline never widens it (owner_only floor), and the everyone-anchored default sets and the member directory never reach it; a misconfiguration can only shrink visibility, never widen it.',
};

/** Capability-grant evidence the posture derivation consumes (ADR-0095 D3). */
export interface PostureEvidence {
  /**
   * Holds the UNSCOPED platform-admin capability grant (`admin_full_access` →
   * `viewAllRecords`/`modifyAllRecords`) — the same evidence the superuser
   * bypass trusts. NOT a better-auth role.
   */
  isPlatformAdmin: boolean;
  /**
   * Holds the org-admin capability grant (`organization_admin`, tenant-scoped
   * `viewAllRecords`/`modifyAllRecords`). Provisioned from the better-auth
   * owner/admin role upstream, consumed here only as a held capability.
   */
  isTenantAdmin: boolean;
  /**
   * [Ruling of record 6355206139, letter B] Holds the reserved identity
   * `org_external` — the projection of `sys_member.role = external` in the
   * active organization (with no active organization, of any external
   * membership: the fail-closed reading the resolver gives the `everyone`
   * anchor). An organization MEMBERSHIP fact, not a capability grant, and the
   * one input that may LOWER the rung: optional, so every caller that predates
   * it derives exactly what it did.
   */
  isExternal?: boolean;
}

/**
 * Resolve the principal's posture rung from held capability grants (ADR-0095 D3).
 *
 * `PLATFORM_ADMIN` from the unscoped platform grant, then — [ruling of record
 * 6355206139, letter B] — `EXTERNAL` for a holder of `org_external`, then
 * `TENANT_ADMIN` from the org-admin grant, and `MEMBER`, the authenticated
 * floor.
 *
 * Why EXTERNAL sits ABOVE the org-admin test: the posture is EXTERNAL, not a
 * restricted member and not an administrator (the ruling keeps ADR-0095's
 * rejection of "EXTERNAL as a restricted MEMBER"). An external cannot carry
 * `owner`/`admin` beside `external` (E5 refuses the mixed list at write), so
 * the org-admin grant can only reach one through an explicit
 * `organization_admin` assignment; that grant then reaches it as a grant, but
 * it does not lift the rung, so the Layer 0 wall and every posture reader keep
 * treating the holder as external. `PLATFORM_ADMIN` stays first: the unscoped
 * platform grant is a deployment-level standing that no organization's
 * membership role can demote.
 */
export function derivePosture(evidence: PostureEvidence): AuthzPosture {
  if (evidence.isPlatformAdmin) return 'PLATFORM_ADMIN';
  if (evidence.isExternal === true) return 'EXTERNAL';
  if (evidence.isTenantAdmin) return 'TENANT_ADMIN';
  return 'MEMBER';
}

// ── Reference visibility model (invariant lock, NOT enforcement) ─────────────

/** A synthetic record for the ladder reference model. */
export interface LadderRow {
  id: string;
  /** The row's tenant. `undefined` = a non-tenant (platform-global) row. */
  organization_id?: string;
  /** The row's owner (drives the ownership disjunct, the EXTERNAL owner_only floor included). */
  owner_id?: string;
  /**
   * Whether the OWD baseline would admit this row for a member (a
   * `public_read` / `public_read_write` object). EXTERNAL deliberately ignores
   * this field: the OWD baseline never widens an external.
   */
  owdVisible?: boolean;
  /**
   * Whether an explicit position or permission-set grant the principal holds
   * admits this row through its own RLS (`supplier in current_user.<key>`).
   * Reaches EXTERNAL and MEMBER alike.
   */
  grantVisible?: boolean;
  /**
   * User ids this row is shared to — a share, a share link, or a sharing rule's
   * materialised grant. Reaches EXTERNAL and MEMBER alike.
   */
  sharedTo?: readonly string[];
}

/** The principal the reference model evaluates a rung for. */
export interface LadderPrincipal {
  userId: string;
  /** The principal's active organization (undefined for an unscoped principal). */
  organizationId?: string;
}

function isSharedTo(row: LadderRow, userId: string): boolean {
  return (row.sharedTo ?? []).includes(userId);
}

/**
 * EXTERNAL rung: explicit grants ONLY — rows shared to it, and, within its
 * organization, rows it owns (the owner_only floor) and rows an explicit
 * grant's RLS admits. Never the OWD baseline, never org-wide.
 */
function externalVisible(rows: readonly LadderRow[], p: LadderPrincipal): LadderRow[] {
  return rows.filter(
    (r) =>
      isSharedTo(r, p.userId) ||
      (r.organization_id === p.organizationId && (r.owner_id === p.userId || r.grantVisible === true)),
  );
}

/**
 * MEMBER rung: business RLS within the org — everything EXTERNAL reaches, plus
 * the OWD baseline. Composed as `EXTERNAL ∪ (in-org OWD)` so the
 * EXTERNAL ⊆ MEMBER leg of the nesting invariant holds by construction.
 */
function memberVisible(rows: readonly LadderRow[], p: LadderPrincipal): LadderRow[] {
  const external = new Set(externalVisible(rows, p));
  return rows.filter((r) => external.has(r) || (r.organization_id === p.organizationId && r.owdVisible === true));
}

/**
 * TENANT_ADMIN rung: all rows in the active organization. Composed as
 * `MEMBER ∪ (all in-org)` so MEMBER ⊆ TENANT_ADMIN holds by construction.
 */
function tenantAdminVisible(rows: readonly LadderRow[], p: LadderPrincipal): LadderRow[] {
  const member = new Set(memberVisible(rows, p));
  return rows.filter((r) => member.has(r) || r.organization_id === p.organizationId);
}

/** PLATFORM_ADMIN rung: crosses the tenant wall — every row (⊇ TENANT_ADMIN trivially). */
function platformAdminVisible(rows: readonly LadderRow[]): LadderRow[] {
  return [...rows];
}

/**
 * Reference model of the per-rung injection rule: the visible-row set a rung
 * would resolve to over `rows` for `principal`. Used to lock the ADR-0095 D2
 * invariants (strict nesting + EXTERNAL deny-by-default). NOT an enforcement
 * path — see the module header.
 */
export function postureVisibleRows(
  posture: AuthzPosture,
  rows: readonly LadderRow[],
  principal: LadderPrincipal,
): LadderRow[] {
  switch (posture) {
    case 'PLATFORM_ADMIN':
      return platformAdminVisible(rows);
    case 'TENANT_ADMIN':
      return tenantAdminVisible(rows, principal);
    case 'MEMBER':
      return memberVisible(rows, principal);
    case 'EXTERNAL':
      return externalVisible(rows, principal);
  }
}
