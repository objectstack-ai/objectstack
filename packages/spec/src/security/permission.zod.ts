// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { RowLevelSecurityPolicySchema } from './rls.zod';
import { ApiOperationSchema } from '../data/object.zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

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
import { strictObject } from '../shared/strict-object';
/**
 * [ADR-0057 D1] Object access DEPTH — the Dataverse "access level" axis,
 * layered on top of OWD. Widens the owner-match for owner-scoped objects.
 */
export const ObjectAccessScopeSchema = z.enum(['own', 'own_and_reports', 'unit', 'unit_and_below', 'org']);
export type ObjectAccessScope = z.input<typeof ObjectAccessScopeSchema>;

/*
 * ── Unknown-key strictness (#4001, ADR-0078) ────────────────────────────────
 *
 * Every AUTHORING schema in this module is `.strict()`: a key it does not
 * declare is a loud, fixable parse error, not a silent strip. A permission
 * set is the worst possible place for zod's default `.strip` — a mis-spelled
 * or wrong-layer key here means the author believes a grant or restriction is
 * in place that the runtime never saw (the ADR-0049 asymmetry, at the
 * capability container itself). The RESPONSE-side extension
 * (`EffectiveObjectPermissionSchema`) deliberately stays tolerant — see below.
 *
 * Key lists are kept beside the schemas rather than derived from `.shape`
 * (the bodies are allocated lazily; `permission.test.ts` drift-guards every
 * entry), and each error map names the canonical key when the authored one is
 * a recognisable spelling of it.
 */

/**
 * Semantic near-misses for object-permission bits — mostly the bare CRUD verbs
 * (Salesforce object-permission vocabulary) an author reaches for before
 * learning the `allow*` prefix. Edit distance cannot bridge `read` →
 * `allowRead`, so they are named explicitly.
 */
const OBJECT_PERMISSION_KEY_ALIASES: Readonly<Record<string, string>> = {
  read: 'allowRead',
  create: 'allowCreate',
  edit: 'allowEdit',
  update: 'allowEdit',
  write: 'allowEdit',
  delete: 'allowDelete',
  remove: 'allowDelete',
  export: 'allowExport',
  transfer: 'allowTransfer',
  restore: 'allowRestore',
  purge: 'allowPurge',
  canread: 'allowRead',
  cancreate: 'allowCreate',
  canedit: 'allowEdit',
  candelete: 'allowDelete',
  viewall: 'viewAllRecords',
  viewalldata: 'viewAllRecords',
  modifyall: 'modifyAllRecords',
  modifyalldata: 'modifyAllRecords',
};

export const ObjectPermissionSchema = lazySchema(() => strictObject(
  {
    surface: 'this object permission',
    aliases: OBJECT_PERMISSION_KEY_ALIASES,
    guidance: {
      apiOperations:
        '`apiOperations` is the server-resolved effective operation set (#3391) — it exists ' +
        'only on the RESPONSE surface (`/me/permissions`) and is never authored. Grant ' +
        'capability with the `allow*` bits here; tighten an object\'s exposure with ' +
        '`apiMethods` on the object schema.',
    },
    history:
      'Until #4001 these were dropped silently — the permission set still parsed, so the ' +
      'author believed a grant or restriction was in place that the runtime never saw.',
  },
  {
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
   * `ResolveApiOptions.userExportAllowed`). It is an **OPT-IN GRANT**, like
   * every other `allow*` bit:
   *   - `true` → export granted (still bounded by read: `export ⊆ list`).
   *   - UNSET or `false` → NO export. Reading a record on screen and pulling
   *     the whole table down as a CSV are different privileges (Salesforce
   *     "Export Reports", Dynamics "Export to Excel", NetSuite "Export Lists",
   *     SAP S_GUI 61 all separate them), so read alone never implies export.
   *
   * Merged most-permissively across a caller's permission sets, exactly like
   * the CRUD bits: ANY set granting `true` grants export. `false` is therefore
   * documentation of intent rather than a veto — permission sets are additive
   * capability containers (ADR-0090), and no bit in them is a deny.
   *
   * NOT implied by the `viewAllRecords` / `modifyAllRecords` super-user bits.
   * That is deliberate: separating "may see all data" from "may take a bulk
   * copy of it" is the segregation-of-duties case the axis exists for. The
   * built-in admin sets carry the grant explicitly instead.
   *
   * Deliberately OPTIONAL (no Zod default) so the resolved value stays
   * three-valued at the AUTHORING layer — a set that says nothing about export
   * is distinguishable from one that says `false`, which is what lets Setup
   * render "inherited / explicitly off" instead of collapsing both to a blank
   * checkbox. Enforcement collapses them: only `true` grants.
   *
   * The server resolves this into the per-object effective operation set
   * (`apiOperations` on `/me/permissions`) and enforces it at the export door
   * (`GET /data/:object/export` → 403 `EXPORT_NOT_PERMITTED`); the frontend
   * renders that set and never reads this bit directly.
   */
  allowExport: z.boolean().optional().describe('[#3544] User-level export axis over read (opt-in grant). true = export granted (still bounded by read); unset/false = no export. Merged most-permissively like the CRUD bits; NOT implied by viewAllRecords/modifyAllRecords.'),

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
   * Bypasses Sharing Rules and Ownership checks — as RECORD SHARING computes
   * them, i.e. on every object `ISharingService` enforces on, which is any
   * object carrying an owner field (the common case, and the one this bit is
   * granted for).
   * Equivalent to Microsoft Dataverse "Organization" level write access.
   *
   * [#6698] It is NOT a bypass of every ownership check the platform runs. On
   * an object with NO owner field record sharing does not enforce at all —
   * `checkEdit` / `checkDelete` answer `abstain` before the bypass is ever
   * probed (#6428's tri-state) — so the platform's own row-level WRITE floor
   * (`created_by == current_user.id`, shipped as the wildcard
   * `owner_only_writes` / `owner_only_deletes` policies that answer #1985)
   * stays in force, and a by-id write to another user's row is still refused.
   * Measured and pinned in plugin-security's
   * `row-write-widener-composition.test.ts`. Widening that cell would be a
   * RUNTIME change in `plugin-sharing` (option B on #6698) and is deliberately
   * not taken — what moved here is only the declaration, so that it stops
   * over-claiming (ADR-0049 `declared ≠ enforced`).
   */
  modifyAllRecords: z.boolean().default(false).describe('Modify All Data (Bypass Sharing) — bypasses sharing rules and ownership on the objects record sharing enforces on; on an object with NO owner field sharing abstains, so the platform created_by write floor still applies (#6698).'),

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
    // WIRE shape: `.extend()` inherits the authoring schema's `.strict()`, and a
    // strict response parser is forward-incompatible — a newer server adding a
    // response key would crash an older client. `.strip()` restores zod-default
    // tolerance here; strictness is an AUTHORING-side contract only (#4001's
    // authorable/wire split).
  }).strip(),
);
export type EffectiveObjectPermission = z.input<typeof EffectiveObjectPermissionSchema>;

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
export const AdminScopeSchema = lazySchema(() => strictObject(
  {
    surface: 'this admin scope',
    history:
      'Until #4001 these were dropped silently — the scope still parsed, so a delegation ' +
      'boundary the author intended was never enforced.',
  },
  {
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

export type AdminScope = z.input<typeof AdminScopeSchema>;
/** Post-parse shape of {@link AdminScope} — defaults applied, transforms run (ADR-0122). */
export type AdminScopeParsed = z.infer<typeof AdminScopeSchema>;

/**
 * Field Level Security (FLS)
 */
export const FieldPermissionSchema = lazySchema(() => strictObject(
  {
    surface: 'this field permission',
    aliases: {
      read: 'readable',
      visible: 'readable',
      write: 'editable',
      edit: 'editable',
      update: 'editable',
    },
    guidance: {
      hidden:
        '`hidden` is not a FieldPermission key — FLS is declared positively: set ' +
        '`readable: false` to hide the field.',
    },
    history:
      'Until #4001 these were dropped silently — the entry still parsed, so field-level ' +
      'security the author intended was never applied.',
  },
  {
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
/** Semantic near-misses borrowed from neighbouring schemas / products. */
const PERMISSION_SET_KEY_ALIASES: Readonly<Record<string, string>> = {
  objectpermissions: 'objects',
  entities: 'objects',
  entitypermissions: 'objects',
  fieldpermissions: 'fields',
  fls: 'fields',
  fieldlevelsecurity: 'fields',
  tabs: 'tabPermissions',
  tabvisibility: 'tabPermissions',
  rls: 'rowLevelSecurity',
  rowlevelsecurityrules: 'rowLevelSecurity',
  policies: 'rowLevelSecurity',
};

export const PermissionSetSchema = lazySchema(() => strictObject(
  {
    surface: 'this permission set',
    aliases: PERMISSION_SET_KEY_ALIASES,
    guidance: {
      // ── Tombstones for RETIRED keys (upgrade prescriptions; they age out ~two
      //    majors after removal — pattern of data/object.zod.ts UNKNOWN_KEY_GUIDANCE).
      contextVariables:
        '`contextVariables` was removed by ADR-0105 D11 (enforce-or-remove, ADR-0049): it ' +
        'was authorable but had zero runtime consumers. A custom membership set a policy ' +
        'needs as `field IN (current_user.<key>)` is staged by a registered rlsMembership ' +
        'resolver; a constant belongs inline in the policy\'s `using` expression.',
      isProfile:
        '`isProfile` was removed by ADR-0090 D2 — there is no Profile concept. Permission ' +
        'sets are the only capability container; use `isDefault` to mark the app baseline ' +
        'bound to the built-in `everyone` position.',
      // ── Wrong-layer pointers for keys that are never authored on a set.
      profiles:
        '`profiles` is not a PermissionSet field (ADR-0090 D2: no Profile concept). ' +
        'Distribution is a runtime binding — positions bind sets to people ' +
        '(`sys_position_permission_set`), never the set itself.',
      roles:
        '`roles` is not a PermissionSet field — ObjectStack has no role hierarchy: ' +
        'capability = permission sets (union-merged), distribution = positions, ' +
        'visibility depth = business units (ADR-0057 / ADR-0090).',
      users:
        '`users` is not a PermissionSet field — assignment is a runtime binding ' +
        '(`sys_user_permission_set` / positions), never authored on the set (ADR-0090).',
    },
    history:
      'Until #4001 these were dropped silently — the set still parsed, so the author ' +
      'believed a capability boundary was declared that the runtime never saw.',
  },
  {
  // [#8554] "unique per organization", not bare "unique". This `describe()` is
  // the SOURCE of the generated reference page
  // (`content/docs/references/security/permission.mdx`), so the bare wording had
  // already reached authors as published contract — the same route the
  // `sys_position` accident took (#8468). `sys_permission_set` is tenant-scoped
  // and the declared index is now `unique: 'organization'`.
  /** Permission set name, unique per organization */
  name: SnakeCaseIdentifierSchema.describe('Permission set name, unique per organization (lowercase snake_case)'),
  
  /** Display label */
  label: z.string().optional().describe('Display label'),

  /**
   * Human-readable description, surfaced on `sys_permission_set` (list columns
   * + form) and the Setup projection (`permission-set-projection.ts` reads it
   * from the authored set). The built-in default sets have always authored it —
   * but until #4001 the schema could not represent it, so it was silently
   * stripped at parse (the ADR-0078 §3 inverse-drift class); the `.strict()`
   * gate surfaced the gap and it is now declared.
   */
  description: z.string().optional().describe('Human-readable description shown in Setup (persisted as sys_permission_set.description)'),

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

  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package authors declare
   * lock policy here; the loader translates it into the private `_lock`
   * envelope at registration time and strips this block before persistence.
   * See `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this permission set.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  //
  // Declared in #4001 alongside every sibling registered metadata type
  // (object / view / app / dashboard / report / dataset / flow / agent / tool /
  // skill / email_template). `MetadataPlugin`'s artifact loader calls
  // `applyProtection` on EVERY type, so a permission set has always carried
  // these keys at runtime — and `getMetaItemLayered` → `saveMetaItem`
  // round-trips a body that includes them. The schema simply could not
  // represent them, so they were silently stripped at every parse (the same
  // ADR-0078 §3 inverse-drift class as `description`); the `.strict()` gate
  // turned that into a visible 422 and surfaced the gap.
  ...MetadataProtectionFields,
}));

export type PermissionSet = z.input<typeof PermissionSetSchema>;
/** Post-parse shape of {@link PermissionSet} — defaults applied, transforms run (ADR-0122). */
export type PermissionSetParsed = z.infer<typeof PermissionSetSchema>;
export type ObjectPermission = z.input<typeof ObjectPermissionSchema>;
/** Post-parse shape of {@link ObjectPermission} — defaults applied, transforms run (ADR-0122). */
export type ObjectPermissionParsed = z.infer<typeof ObjectPermissionSchema>;
export type FieldPermission = z.input<typeof FieldPermissionSchema>;
/** Post-parse shape of {@link FieldPermission} — defaults applied, transforms run (ADR-0122). */
export type FieldPermissionParsed = z.infer<typeof FieldPermissionSchema>;

/**
 * Type-safe factory for a permission set. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: PermissionSet` literal.
 */
export function definePermissionSet(config: z.input<typeof PermissionSetSchema>): PermissionSetParsed {
  return PermissionSetSchema.parse(config);
}
