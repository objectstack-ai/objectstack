// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * EvalUser — the one user-context contract (ADR-0068 D1).
 *
 * The signed-in user exposed to every predicate surface (server formula, server
 * RLS, client UI gates) under the canonical variable name `current_user`
 * (aliases `user`, `ctx.user`) with an **identical shape**. A predicate such as
 * `current_user.roles.exists(r, r == 'org_admin')` (or
 * `'org_admin' in current_user.roles`) therefore evaluates identically wherever
 * it is written.
 *
 * `roles: string[]` is the **only canonical** role field. Singular `role` is NOT
 * part of this contract — its legacy "overwritten to 'admin' on promotion"
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
export const BUILTIN_ROLE_PLATFORM_ADMIN = 'platform_admin';
/** Organization owner within a tenant. Source: `sys_member.role = owner`. */
export const BUILTIN_ROLE_ORG_OWNER = 'org_owner';
/** Organization administrator within a tenant. Source: `sys_member.role = admin`. */
export const BUILTIN_ROLE_ORG_ADMIN = 'org_admin';
/** Organization member within a tenant. Source: `sys_member.role = member`. */
export const BUILTIN_ROLE_ORG_MEMBER = 'org_member';

/**
 * The reserved, framework-seeded role names (ADR-0068 D2). These are a
 * normalized **projection** into `current_user.roles`; their sources of truth
 * (membership rows, the unscoped admin link) are never changed by the projection.
 */
export const BUILTIN_ROLE_NAMES = [
  BUILTIN_ROLE_PLATFORM_ADMIN,
  BUILTIN_ROLE_ORG_OWNER,
  BUILTIN_ROLE_ORG_ADMIN,
  BUILTIN_ROLE_ORG_MEMBER,
] as const;

export type BuiltinRoleName = (typeof BUILTIN_ROLE_NAMES)[number];

/**
 * Permission-set name whose unscoped grant is the source of truth for
 * `platform_admin` (ADR-0068 D2).
 */
export const ADMIN_FULL_ACCESS = 'admin_full_access';

/** Human-readable metadata for the built-in roles (seeded into `sys_role`; AI grounding). */
export const BUILTIN_ROLE_METADATA: Record<BuiltinRoleName, { label: string; description: string }> = {
  [BUILTIN_ROLE_PLATFORM_ADMIN]: { label: 'Platform Admin', description: 'Platform operator (SaaS admin). NOT a tenant user role.' },
  [BUILTIN_ROLE_ORG_OWNER]: { label: 'Organization Owner', description: 'Organization owner within a tenant.' },
  [BUILTIN_ROLE_ORG_ADMIN]: { label: 'Organization Admin', description: 'Organization administrator within a tenant.' },
  [BUILTIN_ROLE_ORG_MEMBER]: { label: 'Organization Member', description: 'Organization member within a tenant.' },
};

/** Normalize a raw better-auth membership role (owner/admin/member) to its canonical
 * built-in role name (org_owner/org_admin/org_member). Unknown values pass through. */
export function mapMembershipRole(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case 'owner': return BUILTIN_ROLE_ORG_OWNER;
    case 'admin': return BUILTIN_ROLE_ORG_ADMIN;
    case 'member': return BUILTIN_ROLE_ORG_MEMBER;
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
    /** CANONICAL. Scope-resolved (ADR-0068 D3); includes built-in + business roles. */
    roles: z.array(z.string()).default([]).describe('Canonical role names assigned to the user (scope-resolved)'),
    /** DERIVED alias of roles.includes(platform_admin) (ADR-0068 D2). Deprecated surface. */
    isPlatformAdmin: z.boolean().optional().describe("DERIVED alias of 'platform_admin' in roles. Deprecated."),
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
 * derivation — never drifts. isPlatformAdmin is always derived from roles.
 */
export function createEvalUser(input: {
  id: string;
  name?: string | null;
  email?: string | null;
  roles?: readonly string[] | null;
  organizationId?: string | null;
}): EvalUser {
  const roles = Array.from(
    new Set((input.roles ?? []).map((r) => String(r).trim()).filter(Boolean))
  );
  return {
    id: input.id,
    ...(input.name != null ? { name: input.name } : {}),
    ...(input.email != null ? { email: input.email } : {}),
    roles,
    isPlatformAdmin: roles.includes(BUILTIN_ROLE_PLATFORM_ADMIN),
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
  };
}
