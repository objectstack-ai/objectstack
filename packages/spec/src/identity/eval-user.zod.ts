// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * EvalUser — the one user-context contract (ADR-0068 D1).
 *
 * The signed-in user exposed to every predicate surface (server formula, server
 * RLS, client UI gates) under the canonical variable name `current_user`
 * (aliases `user`, `ctx.user`) with an **identical shape**. A predicate such as
 * `current_user.positions.exists(p, p == 'org_admin')` (or
 * `'org_admin' in current_user.positions`) therefore evaluates identically wherever
 * it is written.
 *
 * `positions: string[]` is the **only canonical** membership field (renamed from
 * `roles`, ADR-0090 D3). A singular field is NOT part of this contract — its legacy "overwritten to 'admin' on promotion"
 * behavior is the footgun this eliminates.
 *
 * @see docs/adr/0068-unified-user-context-and-built-in-identity-roles.md
 */

// ==========================================
// Built-in identity role names (ADR-0068 D2)
// ==========================================

/**
 * Platform operator (SaaS admin). NOT a tenant user role.
 * Unscoped (`org_id = null`); source of truth = unscoped
 * `sys_user_permission_set` -> `admin_full_access`.
 */
export const BUILTIN_IDENTITY_PLATFORM_ADMIN = 'platform_admin';
/** Organization owner within a tenant. Source: `sys_member.role = owner`. */
export const BUILTIN_IDENTITY_ORG_OWNER = 'org_owner';
/** Organization administrator within a tenant. Source: `sys_member.role = admin`. */
export const BUILTIN_IDENTITY_ORG_ADMIN = 'org_admin';
/** Organization member within a tenant. Source: `sys_member.role = member`. */
export const BUILTIN_IDENTITY_ORG_MEMBER = 'org_member';

/**
 * The reserved, framework-seeded role names (ADR-0068 D2). These are a
 * normalized **projection** into `current_user.positions`; their sources of truth
 * (membership rows, the unscoped admin link) are never changed by the projection.
 */
export const BUILTIN_IDENTITY_NAMES = [
  BUILTIN_IDENTITY_PLATFORM_ADMIN,
  BUILTIN_IDENTITY_ORG_OWNER,
  BUILTIN_IDENTITY_ORG_ADMIN,
  BUILTIN_IDENTITY_ORG_MEMBER,
] as const;

export type BuiltinIdentityName = (typeof BUILTIN_IDENTITY_NAMES)[number];

/**
 * Permission-set name whose unscoped grant is the source of truth for
 * `platform_admin` (ADR-0068 D2). Under ADR-0095 D3 this is also the capability
 * grant the `PLATFORM_ADMIN` posture rung derives from (it carries
 * `viewAllRecords`/`modifyAllRecords`).
 */
export const ADMIN_FULL_ACCESS = 'admin_full_access';

/**
 * Permission-set name whose grant is the source of truth for the `TENANT_ADMIN`
 * posture rung (ADR-0095 D3). Auto-granted (org-scoped) to every `sys_member`
 * whose better-auth role contains `owner`/`admin` by
 * `plugin-security/src/auto-org-admin-grant.ts` — so the better-auth role is a
 * *provisioning source* of this capability grant, never an enforcement input.
 * It carries `viewAllRecords`/`modifyAllRecords` but is tenant-scoped by Layer 0.
 */
export const ORGANIZATION_ADMIN = 'organization_admin';

/**
 * [ADR-0105 D4] The wall-less variant of {@link ORGANIZATION_ADMIN}: identical
 * administration rights, WITHOUT the `viewAllRecords`/`modifyAllRecords`
 * superuser bits.
 *
 * `organization_admin` is safe because Layer 0 bounds its superuser bits to the
 * caller's organization scope. Under the `single` posture there is no wall to
 * bound them — and a wall-less deployment that accumulates organizations (the
 * personal-org-on-signup shape) would make every owner/admin an
 * ENVIRONMENT-WIDE superuser (ADR-0105 finding F2). So the auto-grant hands out
 * THIS set instead whenever no wall is enforced: an org admin still administers
 * their organization, but blanket record visibility must be granted
 * deliberately (`admin_full_access`, or an explicit set carrying the bits) —
 * never as a side effect of a better-auth membership role.
 *
 * It resolves the `TENANT_ADMIN` rung exactly like `organization_admin` does.
 */
export const ORGANIZATION_ADMIN_NO_BYPASS = 'organization_admin_no_bypass';

/** Both org-admin capability grants — either one resolves the `TENANT_ADMIN` rung. */
export const ORGANIZATION_ADMIN_GRANTS: readonly string[] = [
  ORGANIZATION_ADMIN,
  ORGANIZATION_ADMIN_NO_BYPASS,
] as const;

/** Human-readable metadata for the built-in identity names (seeded into `sys_position`; AI grounding). */
export const BUILTIN_IDENTITY_METADATA: Record<BuiltinIdentityName, { label: string; description: string }> = {
  [BUILTIN_IDENTITY_PLATFORM_ADMIN]: { label: 'Platform Admin', description: 'Platform operator (SaaS admin). NOT a tenant user role.' },
  [BUILTIN_IDENTITY_ORG_OWNER]: { label: 'Organization Owner', description: 'Organization owner within a tenant.' },
  [BUILTIN_IDENTITY_ORG_ADMIN]: { label: 'Organization Admin', description: 'Organization administrator within a tenant.' },
  [BUILTIN_IDENTITY_ORG_MEMBER]: { label: 'Organization Member', description: 'Organization member within a tenant.' },
};

/**
 * [ADR-0105 D8 / #3697] The better-auth organization role that makes the
 * scope-bounded issuance path REACHABLE.
 *
 * D8 authorizes invitation *placement* against the issuer's `adminScope`
 * (ADR-0090 D12) — but better-auth grants `invitation: ["create"]` to `owner`
 * and `admin` only, and under a wall-enforcing posture those two are
 * auto-elevated to tenant admins (`auto-org-admin-grant.ts`), for whom the
 * scope gate narrows nothing. The two sets were disjoint: the gate had no
 * caller. This role is the missing one — a membership grade that may reach
 * `/organization/invite-member` **without** being an org admin.
 *
 * It carries NO ObjectStack authority by construction: `mapMembershipRole`
 * passes it through as a position name, and with no
 * `sys_position_permission_set` binding that name resolves to nothing.
 * Reaching the endpoint is not authority to place — placement authority comes
 * solely from a separately-granted `adminScope`. Role = *can reach the
 * endpoint*; adminScope = *what the endpoint permits*.
 *
 * Doubly opt-in, so a default deployment changes not at all: someone must set
 * the membership role AND grant an adminScope set.
 */
export const MEMBERSHIP_ROLE_DELEGATED_ADMIN = 'delegated_admin';

/** Normalize a raw better-auth membership role (owner/admin/member) to its canonical
 * built-in role name (org_owner/org_admin/org_member). Unknown values pass through. */
export function mapMembershipRole(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case 'owner': return BUILTIN_IDENTITY_ORG_OWNER;
    case 'admin': return BUILTIN_IDENTITY_ORG_ADMIN;
    case 'member': return BUILTIN_IDENTITY_ORG_MEMBER;
    default: return raw.trim();
  }
}

// ==========================================
// Contract
// ==========================================

export const EvalUserSchema = lazySchema(() =>
  z.object({
    id: z.string().describe('User ID'),
    name: z.string().optional().describe('Display name'),
    email: z.string().optional().describe('Email address'),
    /** CANONICAL. Scope-resolved (ADR-0068 D3); built-in identity names + position names. */
    positions: z.array(z.string()).default([]).describe('Canonical position/identity names assigned to the user (scope-resolved)'),
    /** DERIVED alias of positions.includes(platform_admin) (ADR-0068 D2). Deprecated surface. */
    isPlatformAdmin: z.boolean().optional().describe("DERIVED alias of 'platform_admin' in positions. Deprecated."),
    organizationId: z.string().nullable().optional().describe('Active organization ID (null = platform/unscoped)'),
  })
);

export type EvalUser = z.infer<typeof EvalUserSchema>;
/** Authoring input for EvalUser — defaulted fields are optional. */
export type EvalUserInput = z.input<typeof EvalUserSchema>;

/**
 * Build a canonical EvalUser from loosely-typed source fields. The single factory
 * every surface uses (server buildScope, the customSession bridge, objectui
 * fallback/guest/preview users) so the user shape — and the isPlatformAdmin
 * derivation — never drifts. isPlatformAdmin is always derived from positions.
 */
export function createEvalUser(input: {
  id: string;
  name?: string | null;
  email?: string | null;
  positions?: readonly string[] | null;
  organizationId?: string | null;
}): EvalUser {
  const positions = Array.from(
    new Set((input.positions ?? []).map((r) => String(r).trim()).filter(Boolean))
  );
  return {
    id: input.id,
    ...(input.name != null ? { name: input.name } : {}),
    ...(input.email != null ? { email: input.email } : {}),
    positions,
    isPlatformAdmin: positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN),
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
  };
}
