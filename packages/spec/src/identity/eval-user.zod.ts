// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import type { PermissionSet } from '../security/permission.zod';

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
 * [#11663 Choice 6A] The kernel platform-admin CAPABILITY DECLARATION — the
 * capability content (object grants + `systemPermissions`) of the
 * {@link ADMIN_FULL_ACCESS} permission set, declared ONCE here in the contract
 * package so exactly one copy exists:
 *
 * - `@objectstack/plugin-security`'s `admin_full_access` declaration
 *   (`objects/default-permission-sets.ts`) spreads this object into its
 *   `PermissionSetSchema.parse({ name, label, ... })` entry — the metadata
 *   declaration that wins at enforcement time.
 * - `@objectstack/core`'s platform-admin derivation (the re-anchor's L2 leg)
 *   reads the same list to fill `grants.systemPermissions`, so the derived
 *   envelope and the declared set can never drift apart.
 *
 * Shape note: these are the two capability-bearing fields of the authored
 * permission-set contract (`PermissionSetSchema`); `name`/`label` remain with
 * the declaring package. Behaviour-neutral by construction — the values are
 * byte-for-byte the ones previously inlined in plugin-security, pinned by
 * `objects/default-permission-sets.test.ts` there.
 */
export const ADMIN_FULL_ACCESS_CAPABILITIES: Pick<PermissionSet, 'objects' | 'systemPermissions'> = {
  objects: {
    '*': {
      allowRead: true,
      allowCreate: true,
      allowEdit: true,
      allowDelete: true,
      viewAllRecords: true,
      modifyAllRecords: true,
      // [#3544] Export is an OPT-IN grant and is deliberately NOT implied by
      // the super-user bits — "may see all data" and "may take a bulk copy of
      // it" are separable on purpose (SAP S_GUI 61 / segregation of duties).
      //
      // [#8681] NO `allowExport` HERE, and it is not an oversight. This set
      // shipped `allowExport: true` on the wildcard through 17.0.0 GA, which
      // made the export axis undeniable for anyone holding it: an app could
      // declare an object exportable by nobody and the platform exported it
      // anyway, with no supported opt-out (editing a code-package set answers
      // `403 [not_overridable]`, and the admin holds no app-authored set to
      // put the per-object `false` into). Measured on GA, hotcrm#1152: an org
      // owner exported three objects no app set grants export on, 200 with
      // full rows. Maintainer ruling (2026-08-15) removes the grant — the
      // export axis's half of #5491, which removed `member_default`'s CRUD
      // wildcard for the identical "a wildcard nobody can get under" reason.
      //
      // ⛔ Do not restore it, and do not restore a NARROWER wildcard either —
      // "which platform objects should ship an explicit export grant" is an
      // OPEN question the ruling deliberately left to a separate decision, and
      // any `'*'` export grant here re-opens the hole for every object the
      // platform does not know about. Where admin export is intended, grant
      // `allowExport` per object in an APP permission set.
    },
  },
  systemPermissions: [
    'manage_users',
    'manage_metadata',
    'manage_platform_settings',
    // [ADR-0111 D9] Sharing administration — gates the sharing-rule surface
    // and (in the DEPTH extension) non-owner share management.
    'manage_sharing',
    'setup.access',
    'setup.write',
    'studio.access',
  ],
};

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

export type EvalUser = z.input<typeof EvalUserSchema>;
/** Post-parse shape of {@link EvalUser} — defaults applied, transforms run (ADR-0122). */
export type EvalUserParsed = z.infer<typeof EvalUserSchema>;

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
}): EvalUserParsed {
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
