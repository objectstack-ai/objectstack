// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { RowLevelSecurityPolicySchema } from './rls.zod';
import { ApiOperationSchema } from '../data/object.zod';

/**
 * Entity (Object) Level Permissions
 * Defines CRUD + VAMA (View All / Modify All) + Lifecycle access.
 * 
 * Refined with enterprise data lifecycle controls:
 * - Transfer (Ownership change)
 * - Restore (Soft delete recovery)
 * - Purge (Hard delete / Compliance)
 */
import { lazySchema } from '../shared/lazy-schema';
/**
 * [ADR-0057 D1] Object access DEPTH — the Dataverse "access level" axis,
 * layered on top of OWD. Widens the owner-match for owner-scoped objects.
 */
export const ObjectAccessScopeSchema = z.enum(['own', 'own_and_reports', 'unit', 'unit_and_below', 'org']);
export type ObjectAccessScope = z.infer<typeof ObjectAccessScopeSchema>;

export const ObjectPermissionSchema = lazySchema(() => z.object({
  /** C: Create */
  allowCreate: z.boolean().default(false).describe('Create permission'),
  /** R: Read (Owned records or Shared records) */
  allowRead: z.boolean().default(false).describe('Read permission'),
  /** U: Edit (Owned records or Shared records) */
  allowEdit: z.boolean().default(false).describe('Edit permission'),
  /** D: Delete (Owned records or Shared records) */
  allowDelete: z.boolean().default(false).describe('Delete permission'),

  /**
   * Export (data portability) — the user-level export axis (#3391 / #3544).
   *
   * `export` derives from `list` AND this bit
   * (`@objectstack/spec/data` `resolveEffectiveApiMethods` →
   * `ResolveApiOptions.userExportAllowed`). Deliberately OPTIONAL with no
   * default so it is a backward-compatible **opt-out**, not an opt-in:
   *   - UNSET (undefined) → inherits read — the current "anyone who can list can
   *     one-click export" behavior — so adding this key changes nothing for
   *     existing permission sets.
   *   - `false` → deny export while KEEPING read (Salesforce "Export Reports",
   *     Dynamics "Export to Excel", NetSuite "Export Lists", SAP S_GUI 61 parity).
   *   - `true` → explicitly granted.
   *
   * The server resolves this into the per-object effective operation set
   * (`apiOperations` on `/me/permissions`); the frontend renders that set and
   * never reads this bit directly.
   */
  allowExport: z.boolean().optional().describe('[#3544] User-level export axis over read. Unset = inherit read (can-list ⇒ can-export, backward-compatible); false = deny export while keeping read; true = granted.'),

  /**
   * Lifecycle Operations.
   *
   * RBAC-gated, operations pending (#1883 / roadmap M2). The dedicated
   * `transfer`/`restore`/`purge` ObjectQL operations do not exist yet, but the
   * permission evaluator PRE-MAPS them to these bits
   * (`permission-evaluator.ts` OPERATION_TO_PERMISSION): the moment such an
   * operation is dispatched it is denied unless a resolved permission set
   * grants the bit (or `modifyAllRecords`). Until the operations ship,
   * authoring `restore`/`purge` grants nothing — there is no ungated window
   * either way (unmapped destructive ops additionally fail CLOSED via
   * DESTRUCTIVE_OPERATIONS, per ADR-0049).
   *
   * EXCEPTION (#3004): `allowTransfer` is ALREADY ENFORCED today through the
   * ordinary `insert`/`update` door, not only the future `transfer` op. The
   * ownership anchor `owner_id` is system-managed for non-privileged writers —
   * a write that plants a record under another user (insert) or reassigns /
   * disowns one (update) is DENIED unless the caller holds `allowTransfer`
   * (or `modifyAllRecords`, which implies it). So granting `allowTransfer`
   * grants the ownership-write capability now; the dedicated M2 `transfer`
   * operation will reuse the same bit.
   */
  allowTransfer: z.boolean().default(false).describe('[RBAC-gated; ENFORCED now via insert/update owner_id guard, #3004] Change record ownership (assign/reassign/disown owner_id)'),
  allowRestore: z.boolean().default(false).describe('[RBAC-gated; operation pending M2] Restore from trash (Undelete)'),
  allowPurge: z.boolean().default(false).describe('[RBAC-gated; operation pending M2] Permanently delete (Hard Delete/GDPR)'),

  /** 
   * View All Records: Super-user read access. 
   * Bypasses Sharing Rules and Ownership checks.
   * Equivalent to Microsoft Dataverse "Organization" level read access.
   */
  viewAllRecords: z.boolean().default(false).describe('View All Data (Bypass Sharing)'),
  
  /** 
   * Modify All Records: Super-user write access. 
   * Bypasses Sharing Rules and Ownership checks.
   * Equivalent to Microsoft Dataverse "Organization" level write access.
   */
  modifyAllRecords: z.boolean().default(false).describe('Modify All Data (Bypass Sharing)'),

  /**
   * [ADR-0057 D1] Read access DEPTH (Dataverse-style access level), layered on
   * top of OWD. For owner-scoped (`private`) objects it widens the owner-match:
   * `own` (owner only) | `own_and_reports` (me + my sys_user.manager_id
   * report chain) | `unit` (my business unit) | `unit_and_below` (my BU +
   * descendants) | `org` (whole tenant). Unset = `own` baseline. Resolved into
   * an `owner_id IN (…)` set at request time; sharing rules still widen on top.
   */
  readScope: ObjectAccessScopeSchema.optional().describe('[ADR-0057 D1] Read depth: own|unit|unit_and_below|org'),
  /** [ADR-0057 D1] Write (edit/delete) access DEPTH — same enum as readScope. */
  writeScope: ObjectAccessScopeSchema.optional().describe('[ADR-0057 D1] Write depth: own|unit|unit_and_below|org'),
}));

/**
 * RESPONSE-side extension of {@link ObjectPermissionSchema} carrying the
 * server-resolved effective API operation set for one object (#3391).
 *
 * This lives on the *response* surface only (e.g. `/me/permissions`,
 * `GetEffectivePermissionsResponse`) — the authoring `ObjectPermissionSchema`
 * is deliberately NOT extended, so a permission-set author can never declare a
 * meaningless `apiOperations` key (the server is the only adjudicator; the
 * frontend consumes the effective set it hands down, never a raw whitelist).
 *
 * The field is named `apiOperations` (not `operations`) to avoid colliding with
 * the view schema's `operations`. It is the enum-ordered closure produced by
 * `@objectstack/spec/data` `effectiveOperationsArray`, present only for objects
 * whose `apiMethods` whitelist actually tightens exposure; absent = the client
 * falls back to its default-allow behavior (old backend / unrestricted object).
 */
export const EffectiveObjectPermissionSchema = lazySchema(() =>
  (ObjectPermissionSchema as unknown as z.ZodObject<z.ZodRawShape>).extend({
    apiOperations: z.array(ApiOperationSchema).optional().describe(
      'Server-resolved effective API operations for this object (#3391). Present only when the object tightens exposure via apiMethods; absent = default-allow. The frontend renders this effective set, never the raw whitelist. Vocabulary is the EFFECTIVE ApiOperation set (six primitives + eight derived verbs, #3543), not the authored six-value ApiMethod enum.',
    ),
  }),
);
export type EffectiveObjectPermission = z.infer<typeof EffectiveObjectPermissionSchema>;

/**
 * [ADR-0090 D12] Delegated-administration scope.
 *
 * Attaches to a permission set (and is therefore distributed via positions,
 * audited in the same tables, and explained by the same engine as every other
 * grant). Declares WHERE a delegate may administer (a business-unit subtree),
 * WHAT they may do there (manage user↔position assignments, position↔set
 * bindings, author environment-owned sets), and WHICH permission sets they may
 * hand out (the anti-self-escalation allowlist — a delegate can never assign,
 * to others or themselves, a set outside it).
 *
 * Runtime enforcement lives in `@objectstack/plugin-security`'s delegated-admin
 * write gate on `sys_user_position` / `sys_position_permission_set` /
 * `sys_user_permission_set` / `sys_permission_set`. Tenant-level admins
 * (ADR-0066 superuser wildcard) are exempt; the `everyone`/`guest` audience
 * anchors stay tenant-level only — no delegated scope can touch them.
 */
export const AdminScopeSchema = lazySchema(() => z.object({
  /** Root of the delegated subtree — `sys_business_unit.name` (machine name, portable across environments). */
  businessUnit: z.string().describe('[ADR-0090 D12] Delegation boundary: sys_business_unit.name of the subtree root'),
  /** Whether the scope covers the whole subtree under `businessUnit` (default) or that single unit only. */
  includeSubtree: z.boolean().default(true).describe('Cover descendant business units too (default true)'),
  /** May create/update/delete `sys_user_position` assignments (and direct `sys_user_permission_set` grants) within the boundary. */
  manageAssignments: z.boolean().default(false).describe('Manage user↔position assignments within the subtree'),
  /** May create/delete `sys_position_permission_set` bindings whose blast radius lies within the boundary. */
  manageBindings: z.boolean().default(false).describe('Manage position↔permission-set bindings within the subtree'),
  /** May author environment-owned permission sets (package-managed rows stay publish-only per ADR-0086). */
  authorEnvironmentSets: z.boolean().default(false).describe('Author environment-owned permission sets'),
  /**
   * The anti-self-escalation core: permission-set NAMES the delegate may
   * assign/bind. Every set reached by a delegated write must be in this list;
   * granting a set that itself carries an adminScope additionally requires the
   * grantor's scope to STRICTLY contain the granted one.
   */
  assignablePermissionSets: z.array(z.string()).default([]).describe('Allowlist of permission-set names the delegate may hand out'),
}));

export type AdminScope = z.infer<typeof AdminScopeSchema>;
/** Authoring input for {@link AdminScope} — defaulted fields are optional. */
export type AdminScopeInput = z.input<typeof AdminScopeSchema>;

/**
 * Field Level Security (FLS)
 */
export const FieldPermissionSchema = lazySchema(() => z.object({
  /** Can see this field */
  readable: z.boolean().default(true).describe('Field read access'),
  /** Can edit this field */
  editable: z.boolean().default(false).describe('Field edit access'),
}));

/**
 * Permission Set Schema
 * Defines a collection of permissions that can be assigned to users.
 * 
 * DIFFERENTIATION (ADR-0090):
 * - Permission Set: the ONLY capability container — union-merged, additive.
 * - Position (src/identity/position.zod.ts): flat distribution group that
 *   binds sets to people. There is no Profile concept (ADR-0090 D2).
 * - Business Unit: the visibility hierarchy (ADR-0057).
 * 
 * **NAMING CONVENTION:**
 * Permission set names MUST be lowercase snake_case to prevent security issues.
 * 
 * @example Good permission set names
 * - 'read_only'
 * - 'system_admin'
 * - 'standard_user'
 * - 'api_access'
 * 
 * @example Bad permission set names (will be rejected)
 * - 'ReadOnly' (camelCase)
 * - 'SystemAdmin' (mixed case)
 * - 'Read Only' (spaces)
 */
export const PermissionSetSchema = lazySchema(() => z.object({
  /** Unique permission set name */
  name: SnakeCaseIdentifierSchema.describe('Permission set unique name (lowercase snake_case)'),
  
  /** Display label */
  label: z.string().optional().describe('Display label'),

  /**
   * [ADR-0086 D3] Owning package for a package-shipped permission set
   * (absent ⇒ environment-authored). Persisted on `sys_permission_set`
   * records together with the per-record `managedBy` provenance, this is
   * what makes the metadata↔config boundary machine-checkable and package
   * uninstall well-defined (remove the package's own sets).
   */
  packageId: z.string().optional().describe('[ADR-0086 D3] Owning package id for a package-shipped set (absent = env-authored)'),

  /**
   * [ADR-0086 D3] Per-record provenance on the existing
   * metadata-persistence axis (`package | platform | user`):
   * `package` = versioned package metadata (seeded by
   * `bootstrapDeclaredPermissions`, re-seeded on upgrade, read-mostly for
   * admins per ADR-0010); `platform`/`user` = environment config, live-edited
   * and never touched by package seeding. Distinct from the `sys_permission_set`
   * TABLE's object-affordance `managedBy: 'config'`, which stays.
   */
  managedBy: z.enum(['package', 'platform', 'user']).optional()
    .describe('[ADR-0086 D3] Record provenance: package (upgrade-owned metadata) vs platform/user (env config)'),

  /**
   * [ADR-0090 D5] Marks this set as the app's baseline for the built-in
   * `everyone` position (default grants for authenticated users). Two tracks
   * consume it (#2926 ②):
   *
   *  - **App-level** (the set is declared by the served app itself): the CLI
   *    resolves the first `isDefault` set as the SecurityPlugin's
   *    `fallbackPermissionSet`, and the plugin IDEMPOTENTLY AUTO-BINDS it to
   *    `everyone` at boot — after a high-privilege-bits check refuses
   *    dangerous sets. Without this a fresh deploy boots with zero bindings
   *    and every persona silently degrades.
   *  - **Package-level** (the set ships in an installed package with a
   *    `packageId`): never auto-bound — it materializes a pending
   *    `sys_audience_binding_suggestion` row that an admin confirms in Setup.
   *
   * Carries no runtime semantics of its own beyond these boot-time effects.
   * (The former `isProfile` flag was removed by ADR-0090 D2.)
   */
  isDefault: z.boolean().default(false).describe('[ADR-0090 D5] App baseline for the everyone position: app-level sets are auto-bound at boot (guarded, idempotent); package-level sets become install-time suggestions an admin confirms'),
  
  /** Object Permissions Map: <entity_name> -> permissions */
  objects: z.record(z.string(), ObjectPermissionSchema).describe('Entity permissions'),
  
  /** Field Permissions Map: <entity_name>.<field_name> -> permissions */
  fields: z.record(z.string(), FieldPermissionSchema).optional().describe('Field level security'),
  
  /** System permissions (e.g., "manage_users") */
  systemPermissions: z.array(z.string()).optional().describe('System level capabilities'),
  
  /**
   * Tab/App Visibility Permissions (Salesforce Pattern)
   * Controls which app tabs are visible, hidden, or set as default for this permission set.
   * 
   * @example
   * ```typescript
   * tabPermissions: {
   *   'app_crm': 'visible',
   *   'app_admin': 'hidden',
   *   'app_sales': 'default_on'
   * }
   * ```
   */
  tabPermissions: z.record(z.string(), z.enum(['visible', 'hidden', 'default_on', 'default_off'])).optional()
    .describe('App/tab visibility: visible, hidden, default_on (shown by default), default_off (available but hidden initially)'),
  
  /** 
   * Row-Level Security Rules
   * 
   * Row-level security policies that filter records based on user context.
   * These rules are applied in addition to object-level permissions.
   * 
   * Uses the canonical RLS protocol from rls.zod.ts for comprehensive
   * row-level security features including PostgreSQL-style USING and CHECK clauses.
   * 
   * @see {@link RowLevelSecurityPolicySchema} for full RLS specification
   * @see {@link file://./rls.zod.ts} for comprehensive RLS documentation
   * 
   * @example Multi-tenant isolation
   * ```typescript
   * rls: [{
   *   name: 'tenant_filter',
   *   object: 'account',
   *   operation: 'select',
   *   using: 'organization_id == current_user.organization_id'
   * }]
   * ```
   */
  rowLevelSecurity: z.array(RowLevelSecurityPolicySchema).optional()
    .describe('Row-level security policies (see rls.zod.ts for full spec)'),
  
  /**
   * [ADR-0105 D11] `contextVariables` was REMOVED (enforce-or-remove, ADR-0049):
   * it was authorable but had zero runtime consumers — the RLS compiler resolves
   * only the `current_user.*` built-ins plus the runtime-staged
   * `ExecutionContext.rlsMembership` sets, never a value declared here.
   *
   * Migration: a custom set that a policy needs as `field IN (current_user.<key>)`
   * is staged by a registered membership resolver (see
   * {@link ExecutionContextSchema.rlsMembership}); a constant is written as a
   * literal in the policy's `using` (`status = 'published'`).
   */

  /**
   * [ADR-0090 D12] Delegated-administration scope carried by this set.
   * Holding the set makes the user a SCOPED administrator: they may manage
   * assignments/bindings (and optionally author environment sets) within the
   * declared business-unit subtree, handing out ONLY the allowlisted sets.
   * See {@link AdminScopeSchema} for the full contract.
   */
  adminScope: AdminScopeSchema.optional()
    .describe('[ADR-0090 D12] Scoped delegated-administration grant (BU subtree + assignable-set allowlist)'),
}));

export type PermissionSet = z.infer<typeof PermissionSetSchema>;
/** Authoring input for {@link PermissionSet} — defaulted fields are optional. */
export type PermissionSetInput = z.input<typeof PermissionSetSchema>;
export type ObjectPermission = z.infer<typeof ObjectPermissionSchema>;
export type FieldPermission = z.infer<typeof FieldPermissionSchema>;

/**
 * Type-safe factory for a permission set. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: PermissionSet` literal.
 */
export function definePermissionSet(config: z.input<typeof PermissionSetSchema>): PermissionSet {
  return PermissionSetSchema.parse(config);
}
