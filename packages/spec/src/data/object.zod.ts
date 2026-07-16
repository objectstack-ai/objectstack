// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FieldSchema } from './field.zod';
import { ValidationRuleSchema } from './validation.zod';
import { ActionSchema } from '../ui/action.zod';
import { ObjectListViewSchema } from '../ui/view.zod';

/**
 * API Operations Enum
 */
import { ExpressionInputSchema, TemplateExpressionInputSchema, type Expression, type ExpressionInput } from '../shared/expression.zod';
import { lazySchema } from '../shared/lazy-schema';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { ProtectionSchema } from '../shared/protection.zod';
export const ApiMethod = z.enum([
  'get', 'list',          // Read
  'create', 'update', 'delete', // Write
  'upsert',               // Idempotent Write
  'bulk',                 // Batch operations
  'aggregate',            // Analytics (count, sum)
  'history',              // Audit access
  'search',               // Search access
  'restore', 'purge',     // Trash management
  'import', 'export',     // Data portability
]);
export type ApiMethod = z.infer<typeof ApiMethod>;

/**
 * Capability Flags
 * Defines what system features are enabled for this object.
 *
 * Modeled on industry standards (Salesforce "Allow Activities"/"Track Field
 * History"/"Enable Feed Tracking", Dataverse table options). Each flag has a
 * defined enforcement contract (#2707); a flag with no runtime consumer is a
 * bug, not a reservation — see `@objectstack/spec/liveness/object.json`.
 *
 * Opt-out flags (`feeds`, `activities`, `trash`, `mru`, `clone`, `searchable`,
 * `apiEnabled`) default to `true`: absent block/flag = enabled, and consumers
 * gate on explicit `false` only. Opt-in flags (`trackHistory`, `files`)
 * default to `false`.
 *
 * @example
 * {
 *   trackHistory: true,
 *   searchable: true,
 *   apiEnabled: true,
 *   activities: false
 * }
 */
export const ObjectCapabilities = z.object({
  /**
   * History tracking (Audit Trail) master switch — opt-in.
   *
   * Contract: `true` surfaces the record History tab (audit-trail UI) in the
   * console. Pair with per-field `trackHistory: true` to select which field
   * diffs render as human-readable timeline summaries (ADR-0052 §5b). Audit
   * *capture* into `sys_audit_log` is a compliance ledger and stays on
   * regardless of this flag; retention is governed by data lifecycle
   * (ADR-0057), not by hiding the UI.
   */
  trackHistory: z.boolean().default(false).describe('Show the record History tab (audit-trail UI). Pair with per-field trackHistory to pick which field diffs are summarized; audit capture itself is always on for compliance'),

  /** Enable global search indexing */
  searchable: z.boolean().default(true).describe('Index records for global search'),

  /** Enable REST/GraphQL API access */
  apiEnabled: z.boolean().default(true).describe('Expose object via automatic APIs'),

  /**
   * API Supported Operations
   * Granular control over API exposure.
   */
  apiMethods: z.array(ApiMethod).optional().describe('Whitelist of allowed API operations'),

  /**
   * Generic Attachments panel (Salesforce "Notes & Attachments" parity) —
   * opt-in.
   *
   * Contract (#2727): `true` surfaces the record Attachments panel in the
   * console (upload/list/download/delete over `sys_attachment` join rows)
   * and permits `sys_attachment` rows to target this object; anything else
   * rejects new attachments server-side (403 FILES_DISABLED, enforced at
   * the engine hook seam by plugin-audit — opt-in means explicit).
   * `Field.file` / `Field.image` column attachments are independent of
   * this flag.
   */
  files: z.boolean().default(false).describe('Generic record Attachments panel (sys_attachment). Opt-in: true surfaces the panel and permits attachments targeting this object; otherwise creation is rejected. Field.file/Field.image are independent'),

  /**
   * Social collaboration (Comments, Mentions, Feeds) — opt-out.
   *
   * Contract: default on. An explicit `false` hides the record feed UI and
   * rejects new `sys_comment` rows targeting this object (403
   * FEEDS_DISABLED, enforced at the engine hook seam by plugin-audit).
   */
  feeds: z.boolean().default(true).describe('Record comments/collaboration feed. Default on; explicit false hides the feed UI and rejects new comments for this object'),

  /**
   * Activity timeline (sys_activity mirror of create/update/delete) — opt-out.
   *
   * Contract: default on. An explicit `false` stops plugin-audit from
   * mirroring this object's CRUD into `sys_activity` (the record timeline)
   * and hides the timeline merge in the console. The off-switch is also the
   * per-object lever for activity-row growth (ADR-0057).
   */
  activities: z.boolean().default(true).describe('Record activity timeline (sys_activity mirror of CRUD). Default on; explicit false stops mirroring and hides the timeline'),

  /** Enable Recycle Bin / Soft Delete */
  trash: z.boolean().default(true).describe('Enable soft-delete with restore capability'),

  /** Enable "Recently Viewed" tracking */
  mru: z.boolean().default(true).describe('Track Most Recently Used (MRU) list for users'),
  
  /** Allow cloning records */
  clone: z.boolean().default(true).describe('Allow record deep cloning'),
});

/**
 * Schema for database indexes.
 * Enhanced with additional index types and configuration options
 * 
 * @example
 * {
 *   name: "idx_account_name",
 *   fields: ["name"],
 *   type: "btree",
 *   unique: true
 * }
 */
export const IndexSchema = lazySchema(() => z.object({
  name: z.string().optional().describe('Index name (auto-generated if not provided)'),
  fields: z.array(z.string()).describe('Fields included in the index'),
  type: z.enum(['btree', 'hash', 'gin', 'gist', 'fulltext']).optional().default('btree').describe('Index algorithm type'),
  unique: z.boolean().optional().default(false).describe('Whether the index enforces uniqueness'),
  partial: z.string().optional().describe('Partial index condition (SQL WHERE clause for conditional indexes)'),
}));

/**
 * Search Configuration
 * Defines how this object behaves in search results.
 * 
 * @example
 * {
 *   fields: ["name", "email", "phone"],
 *   displayFields: ["name", "title"],
 *   filters: ["status = 'active'"]
 * }
 */
export const SearchConfigSchema = lazySchema(() => z.object({
  fields: z.array(z.string()).describe('Fields to index for full-text search weighting'),
  displayFields: z.array(z.string()).optional().describe('Fields to display in search result cards'),
  filters: z.array(z.string()).optional().describe('Default filters for search results'),
}));

/**
 * Tombstones for RETIRED tenancy keys — same doctrine as the top-level
 * `UNKNOWN_KEY_GUIDANCE` map below: a retired key's rejection must carry the
 * upgrade prescription, because the parse error is the one channel every
 * consumer bumping `@objectstack/spec` is guaranteed to hit. Removed after
 * spec 15.0 by owner decision #2763 (enforce-or-remove, ADR-0049; precedent
 * ADR-0056 D8 — compliance-grade config must never merely look live).
 */
const TENANCY_RETIRED_KEY_GUIDANCE: Record<string, string> = {
  strategy:
    '`tenancy.strategy` was removed from @objectstack/spec after v15.0 (#2763) — it ' +
    'never had a consumer. The platform has exactly two tenancy modes and neither is ' +
    'object-level config: database-per-tenant isolation is an environment/deployment ' +
    'choice (each environment carries its own database URL), and row-level isolation ' +
    'is `tenancy.enabled` + `tenancy.tenantField`. Delete the key.',
  crossTenantAccess:
    '`tenancy.crossTenantAccess` was removed from @objectstack/spec after v15.0 (#2763) — it ' +
    'never had a consumer; setting it granted nothing. Cross-tenant visibility is ' +
    'governed by sharing rules / OWD (ADR-0056), `externalSharingModel` (ADR-0090 ' +
    'D11), and the object access posture. Delete the key.',
};

/**
 * Custom zod `error` for the `.strict()` tenancy block (#2763, pattern of
 * `strictVisibilityError` / ADR-0089 D3a): an unknown key — a retired
 * `strategy`/`crossTenantAccess` or a typo — is a loud, *fixable* parse error
 * instead of a silent strip (#1535), and a retired key's error carries its
 * upgrade prescription. Every other issue code defers to zod's default.
 */
const strictTenancyError: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== 'unrecognized_keys') return undefined;
  const keys = (issue as { keys?: readonly string[] }).keys ?? [];
  const lines = keys.map((key) =>
    TENANCY_RETIRED_KEY_GUIDANCE[key] ?? `\`${key}\` is not a \`tenancy\` key.`,
  );
  return (
    `Unrecognized key(s) on \`tenancy\`: ${keys.map((k) => `\`${k}\``).join(', ')}. ` +
    'The two supported tenancy modes are: database-per-tenant = environment-level ' +
    'deployment (no object config); row-level isolation = `tenancy.enabled` + ' +
    '`tenancy.tenantField`.\n' +
    lines.map((l) => `  • ${l}`).join('\n')
  );
};

/**
 * Multi-Tenancy Configuration Schema
 * Row-level tenant isolation for shared-database SaaS applications: the
 * tenant field is injected on write and enforced on read (RLS predicate).
 * Platform objects declare `enabled: false` to opt out of org row-scoping
 * (environment-level objects). Database-per-tenant isolation is NOT object
 * metadata — it is an environment/deployment choice.
 *
 * `.strict()`: unknown keys (incl. the retired `strategy` /
 * `crossTenantAccess`, #2763) are rejected with guidance, not stripped (#1535).
 *
 * @example Shared database with tenant_id row isolation
 * {
 *   enabled: true,
 *   tenantField: 'tenant_id'
 * }
 */
export const TenancyConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable multi-tenancy for this object'),
  tenantField: z.string().default('tenant_id').describe('Field name for tenant identifier'),
}, { error: strictTenancyError }).strict());

/**
 * [ADR-0066 D2] Secure-by-default object posture.
 *
 * Declares whether the object participates in blanket wildcard permission
 * grants — a data-model posture like {@link TenancyConfigSchema}, NOT an
 * assignment (it names no principal).
 *
 * - `public` (default) — covered by a permission set's `'*'` wildcard object
 *   grant; today's allow-by-default behaviour.
 * - `private` — NOT covered by the `'*'` wildcard grant; access requires an
 *   EXPLICIT per-object grant (Salesforce "new object = no access until
 *   granted"). A `private` object is ALSO exempt from wildcard RLS
 *   (`tenant_isolation`, owner scoping): the posture-gated superuser bypass
 *   (`viewAllRecords`/`modifyAllRecords`) short-circuits RLS, so a platform
 *   admin — incl. one who is also an org admin whose `tenant_isolation` would
 *   otherwise narrow the result — sees all rows, while non-admins without an
 *   explicit grant see none.
 *
 * Pair with the object's `requiredPermissions` (D3) to additionally gate access
 * on holding a capability.
 */
export const ObjectAccessConfigSchema = lazySchema(() => z.object({
  default: z.enum(['public', 'private']).default('public')
    .describe('Default exposure posture: public (covered by wildcard grants) | private (needs explicit grant; exempt from wildcard RLS).'),
}));

/**
 * [ADR-0066 ⑤] Per-operation capability requirements for an object. Each key
 * lists the capabilities a caller must hold for that operation CLASS; an absent
 * key means that operation carries no capability gate. Lets an object be
 * "read-open / write-gated" (Salesforce & Dataverse separate capability by
 * operation) instead of the flat all-CRUD gate the `string[]` form applies.
 * Operation→class mapping mirrors the CRUD permission bits: `transfer`/`restore`
 * fold into `update`, `purge` into `delete`. `.strict()` so a mistyped key
 * (e.g. `reads`) is rejected at author time rather than silently ignored.
 */
export const PerOperationRequiredPermissionsSchema = z.object({
  read: z.array(z.string()).optional().describe('Capabilities required to read (find/findOne/count/aggregate).'),
  create: z.array(z.string()).optional().describe('Capabilities required to create (insert).'),
  update: z.array(z.string()).optional().describe('Capabilities required to update (update/transfer/restore).'),
  delete: z.array(z.string()).optional().describe('Capabilities required to delete (delete/purge).'),
}).strict();

/**
 * [ADR-0066 D3/⑤] Object capability contract — either capabilities required for
 * ALL operations (`string[]`, the original shape) or a per-operation map
 * (narrows the gate by operation). See the field doc on `Object.requiredPermissions`.
 */
export const ObjectRequiredPermissionsSchema = z.union([
  z.array(z.string()),
  PerOperationRequiredPermissionsSchema,
]);
export type PerOperationRequiredPermissions = z.infer<typeof PerOperationRequiredPermissionsSchema>;
export type ObjectRequiredPermissions = z.infer<typeof ObjectRequiredPermissionsSchema>;

/**
 * Soft Delete Configuration Schema
 * Implements recycle bin / trash functionality
 * 
 * @example Standard soft delete with cascade
 * {
 *   enabled: true,
 *   field: 'deleted_at',
 *   cascadeDelete: true
 * }
 */
export const SoftDeleteConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable soft delete (trash/recycle bin)'),
  field: z.string().default('deleted_at').describe('Field name for soft delete timestamp'),
  cascadeDelete: z.boolean().default(false).describe('Cascade soft delete to related records'),
}));

/**
 * Versioning Configuration Schema
 * Implements record versioning and history tracking
 * 
 * @example Snapshot versioning with 90-day retention
 * {
 *   enabled: true,
 *   strategy: 'snapshot',
 *   retentionDays: 90,
 *   versionField: 'version'
 * }
 */
export const VersioningConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().describe('Enable record versioning'),
  strategy: z.enum(['snapshot', 'delta', 'event-sourcing']).describe('Versioning strategy: snapshot (full copy), delta (changes only), event-sourcing (event log)'),
  retentionDays: z.number().min(1).optional().describe('Number of days to retain old versions (undefined = infinite)'),
  versionField: z.string().default('version').describe('Field name for version number/timestamp'),
}));

/**
 * Data Lifecycle (ADR-0057)
 *
 * Declares how long an object's data lives and how its space is reclaimed —
 * the axis validation/permissions never covered. Enforced at runtime by the
 * platform-owned LifecycleService (`@objectstack/objectql`): Reaper (TTL/age
 * batch delete), Rotator (time-shard + DROP oldest), Archiver (cold-store
 * copy then delete). A declared policy with no runtime consumer is a spec
 * defect (ADR-0049 enforce-or-remove); the liveness gate requires every
 * non-`record` class to declare `retention`, `ttl`, or rotation `storage`.
 */

/**
 * Lifecycle class — what persistence contract the object's data carries.
 *
 * | class       | contract                                        |
 * |-------------|-------------------------------------------------|
 * | `record`    | business truth — permanent, recoverable          |
 * | `audit`     | compliance ledger — retain → archive → delete    |
 * | `telemetry` | high-frequency log — rotation, short retention   |
 * | `transient` | ephemeral state — TTL auto-expire                |
 * | `event`     | event-bus messages — very short TTL              |
 *
 * `record` is the back-compat default: an object with no `lifecycle` block
 * behaves exactly as today (immortal data).
 */
export const LifecycleClassSchema = z.enum(['record', 'audit', 'telemetry', 'transient', 'event']);

/**
 * Duration literal: `<n><unit>` where unit is h(ours), d(ays), w(eeks) or
 * y(ears) — e.g. `'6h'`, `'14d'`, `'12w'`, `'7y'`. Parsed by
 * `@objectstack/objectql` `parseLifecycleDuration`.
 */
export const LIFECYCLE_DURATION_REGEX = /^\d+(h|d|w|y)$/;
const lifecycleDuration = (what: string) =>
  z.string().regex(LIFECYCLE_DURATION_REGEX, `${what} must be a duration literal like '6h', '14d', '12w' or '7y'`);

export const LifecycleSchema = lazySchema(() => z.object({
  class: LifecycleClassSchema.describe(
    'Persistence contract: record (business truth, permanent) | audit (compliance ledger) | telemetry (high-freq log) | transient (ephemeral state) | event (bus messages).',
  ),
  retention: z.object({
    maxAge: lifecycleDuration('retention.maxAge').describe('Rows older than this (by created_at) are deleted by the Reaper — or archived first when `archive` is set.'),
    onlyWhen: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.object({ $in: z.array(z.union([z.string(), z.number()])).min(1) }).strict(),
      ]),
    ).optional().describe(
      'Row filter the retention applies to — per-field equality or {$in: [...]} (e.g. { status: { $in: ["completed", "failed"] } }). Rows OUTSIDE the filter are retained regardless of age: for tables that interleave live workflow state with terminal history (sys_automation_run). Incompatible with rotation storage and archive, which act on whole shards / age alone.',
    ),
  }).optional().describe('Age-based retention window enforced by the LifecycleService Reaper.'),
  ttl: z.object({
    field: z.string().describe('Timestamp field the TTL is measured from (e.g. created_at, expires_at).'),
    expireAfter: lifecycleDuration('ttl.expireAfter').describe('Rows expire this long after `field` and are deleted by the Reaper.'),
  }).optional().describe('Per-row TTL auto-expiry (transient/event classes).'),
  storage: z.object({
    strategy: z.literal('rotation').describe('Time-shard the table; rotate by DROPping the oldest shard (O(1) reclaim).'),
    shards: z.number().int().min(2).describe('Number of shards retained; total window = shards × unit.'),
    unit: z.enum(['day', 'week', 'month']).describe('Time width of one shard.'),
  }).optional().describe('Physical storage strategy for high-frequency telemetry (LifecycleService Rotator).'),
  archive: z.object({
    after: lifecycleDuration('archive.after').describe('Rows older than this are copied to the archive datasource before hot deletion.'),
    to: z.string().describe('Target datasource name for cold storage. When it is not registered, the Archiver skips (audit rows are then retained, never dropped unarchived).'),
    keep: lifecycleDuration('archive.keep').optional().describe('How long archived rows are kept in cold storage (undefined = forever).'),
  }).optional().describe('Cold-store archival (LifecycleService Archiver) — audit-class hot→cold hand-off.'),
  reclaim: z.boolean().optional().describe('Run driver space reclamation (SQLite incremental_vacuum) after sweeping this object. Default true for non-record classes.'),
}).superRefine((lc, ctx) => {
  // ADR-0057 §3.5: a non-`record` lifecycle class with no bounding policy is a
  // false surface — the object would still grow forever. Enforce-or-remove.
  if (lc.class !== 'record' && !lc.retention && !lc.ttl && !lc.storage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `lifecycle.class '${lc.class}' requires at least one bounding policy: retention, ttl, or storage (rotation) — ADR-0057 §3.5`,
    });
  }
  if (lc.class === 'record' && (lc.retention || lc.ttl || lc.storage || lc.archive)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `lifecycle.class 'record' is permanent business truth — retention/ttl/storage/archive policies are not allowed on it (ADR-0057 §3.1)`,
    });
  }
  if (lc.archive && lc.retention && lc.archive.after !== lc.retention.maxAge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `lifecycle.archive.after ('${lc.archive.after}') must equal retention.maxAge ('${lc.retention.maxAge}') — the hot window ends where the archive begins`,
    });
  }
  if (lc.retention?.onlyWhen && lc.storage?.strategy === 'rotation') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lifecycle.retention.onlyWhen cannot be combined with rotation storage — the Rotator DROPs whole shards and would destroy rows the filter protects',
    });
  }
  if (lc.retention?.onlyWhen && lc.archive) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lifecycle.retention.onlyWhen cannot be combined with archive — the Archiver moves rows by age alone and would archive rows the filter protects',
    });
  }
}));


/**
 * Object Field Group Schema — MVP (data-layer protocol)
 * 
 * Declares the set of logical field groups for an object. A group bundles
 * related fields together for presentation in forms, detail pages, and
 * editors (e.g., "Contact Info", "Billing", "System").
 * 
 * Design rules (MVP):
 * - Group **order** is the declaration order of this array — no `order` property.
 * - Field → group mapping is derived automatically from `Field.group`
 *   matching `ObjectFieldGroup.key`; the **in-group display order** equals
 *   the traversal order of `ObjectSchema.fields`.
 * - Fields whose `group` is unset (or references an undeclared key) are
 *   considered ungrouped and must be rendered by consumers in a default
 *   bucket after the declared groups, preserving their field declaration order.
 * - Extension packages and runtime code use `Field.group` to assign fields
 *   to an existing group — no per-field order property is introduced at this
 *   layer.
 * 
 * Migration operations supported by this MVP:
 *   - add / rename / delete / reorder groups (via the array)
 *   - assign an existing field to a group (via `Field.group`)
 * 
 * Deferred (not part of MVP):
 *   - explicit per-field in-group ordering
 *   - nested groups / sub-groups
 *   - group-level visibility predicates (a `visibleOn` key existed here
 *     briefly with no consumer anywhere; removed per ADR-0085 / ADR-0049
 *     enforce-or-remove — re-add together with its enforcement when a
 *     surface actually evaluates it)
 *
 * Derivation semantics (declared order, empty groups dropped, ungrouped
 * trailing bucket, collapse passthrough) are single-sourced in
 * `deriveFieldGroupLayout` (field-group-layout.ts, ADR-0085 §5) — UI
 * renderers consume that helper instead of re-implementing the rules.
 *
 * @example
 * ```ts
 * fieldGroups: [
 *   { key: 'contact_info', label: 'Contact Information', icon: 'user' },
 *   { key: 'billing',      label: 'Billing',             collapse: 'collapsed' },
 *   { key: 'system',       label: 'System' },
 * ]
 * ```
 */
export const ObjectFieldGroupSchema = lazySchema(() => z.object({
  /** Group key — referenced by `Field.group` to assign a field to this group. Must be snake_case. */
  key: z.string().regex(/^[a-z_][a-z0-9_]*$/, {
    message: 'Field group key must be lowercase snake_case (e.g., "contact_info", "billing", "system")',
  }).describe('Group machine key (snake_case). Referenced by Field.group.'),

  /** Human-readable label displayed as the group header. */
  label: z.string().describe('Group display label'),

  /** Optional Lucide/Material icon name for the group header. */
  icon: z.string().optional().describe('Icon name (Lucide/Material) for the group header'),

  /** Optional description / help text shown under the group header. */
  description: z.string().optional().describe('Optional description shown under the group header'),

  /**
   * [ADR-0085] Collapse behaviour of the group's rendered section, on every
   * surface (form, detail, drawer). One enum, three valid states — replaces
   * the old `defaultExpanded` flag AND the UI-dialect `collapsible`/`collapsed`
   * boolean pair, which could express contradictions and had drifted between
   * spec and renderer (spec declared a key no renderer read; renderers read
   * keys the spec rejected).
   */
  collapse: z.enum(['none', 'expanded', 'collapsed']).optional().default('none')
    .describe("[ADR-0085] Section collapse behaviour: 'none' (always open, no toggle), 'expanded' (collapsible, starts open), 'collapsed' (collapsible, starts closed)."),

  /**
   * @deprecated [ADR-0085 → `collapse`] Accepted as a parse-time alias:
   * `defaultExpanded: false` maps to `collapse: 'collapsed'`, `true` to
   * `'expanded'`, when `collapse` is absent. New metadata sets `collapse`.
   */
  defaultExpanded: z.boolean().optional().describe("[DEPRECATED → collapse] true → 'expanded', false → 'collapsed'."),
  /** @deprecated [ADR-0085 → `collapse`] UI-dialect alias (pair with `collapsed`); mapped onto `collapse` at parse. */
  collapsible: z.boolean().optional().describe("[DEPRECATED → collapse] Boolean pair with `collapsed`; use the `collapse` enum."),
  /** @deprecated [ADR-0085 → `collapse`] UI-dialect alias (pair with `collapsible`); mapped onto `collapse` at parse. */
  collapsed: z.boolean().optional().describe("[DEPRECATED → collapse] Boolean pair with `collapsible`; use the `collapse` enum."),
}));

export type ObjectFieldGroup = z.infer<typeof ObjectFieldGroupSchema>;
export type ObjectFieldGroupInput = z.input<typeof ObjectFieldGroupSchema>;

/**
 * Base Object Schema Definition
 * 
 * The Blueprint of a Business Object.
 * Represents a table, a collection, or a virtual entity.
 * 
 * @example
 * ```yaml
 * name: project_task
 * label: Project Task
 * icon: task
 * fields:
 *   project:
 *     type: lookup
 *     reference: project
 *   status:
 *     type: select
 *     options: [todo, in_progress, done]
 * enable:
 *   trackHistory: true
 *   files: true
 * ```
 */

/**
 * External Binding (ADR-0015)
 *
 * Optional per-object descriptor that binds this object to a remote table
 * on a federated datasource (one whose `schemaMode !== 'managed'`). When
 * present, the object is "external": DDL is forbidden, the table is
 * validated against the remote schema at boot, and writes require a double
 * opt-in (`datasource.external.allowWrites` **and** this `writable`).
 *
 * The cross-field invariant ("`external` only when the object's datasource
 * has `schemaMode !== 'managed'`") is enforced at metadata-load time, not
 * in this schema, because the datasource may live in another artefact.
 */
export const ObjectExternalBindingSchema = z.object({
  remoteName: z.string().optional()
    .describe('Remote table/view name. Defaults to object.name.'),
  remoteSchema: z.string().optional()
    .describe('Remote schema/database qualifier.'),
  writable: z.boolean().default(false)
    .describe('Per-object write opt-in (also requires datasource.external.allowWrites).'),
  columnMap: z.record(z.string(), z.string()).optional()
    .describe('Remote column name → local field name.'),
  introspectedAt: z.string().datetime().optional()
    .describe('Set by `os datasource introspect`; informational.'),
  ignoreColumns: z.array(z.string()).optional()
    .describe('Remote columns to skip during validation (dev convenience).'),
}).describe('External datasource binding (ADR-0015)');

export type ObjectExternalBinding = z.infer<typeof ObjectExternalBindingSchema>;

/**
 * Object form of a `userActions.edit` / `userActions.delete` override —
 * extends the plain boolean with **per-record** CEL predicates so the
 * built-in row Edit/Delete affordances can be hidden or disabled for a
 * subset of rows (objectstack-ai/objectui#2614).
 *
 * Semantics (mirrors custom row actions' `visible` / `disabled`):
 * - `enabled`      — object-level on/off, same meaning as the bare boolean.
 *                    Omitted → the `managedBy` bucket default.
 * - `visibleWhen`  — CEL over `record.*`; evaluates **false** → the row's
 *                    button is not rendered. Fail-closed (a faulting
 *                    predicate hides, and warns once).
 * - `disabledWhen` — CEL over `record.*`; evaluates **true** → the row's
 *                    button renders greyed / non-clickable. Fail-soft (a
 *                    faulting predicate leaves the button enabled).
 *
 * The predicates are advisory UI gating only — server-side enforcement
 * stays with permissions / hooks (e.g. `beforeUpdate` rejecting frozen
 * rows). Evaluation happens on the canonical CEL engine, per row, with the
 * record bound as `record.*` (and bare fields) — the same machinery custom
 * actions already use, so authoring is identical.
 */
export const RowCrudActionOverrideSchema = z.object({
  enabled: z.boolean().optional().describe(
    'Object-level on/off for the generic affordance; same meaning as the bare boolean form. Omitted → managedBy bucket default.',
  ),
  visibleWhen: ExpressionInputSchema.optional().describe(
    'Per-record CEL predicate; false → hide the row button for that record. Fail-closed.',
  ),
  disabledWhen: ExpressionInputSchema.optional().describe(
    'Per-record CEL predicate; true → render the row button disabled for that record. Fail-soft.',
  ),
}).strict().describe('Boolean-or-predicates override for a built-in row CRUD affordance.');
export type RowCrudActionOverride = z.infer<typeof RowCrudActionOverrideSchema>;
export type RowCrudActionOverrideInput = z.input<typeof RowCrudActionOverrideSchema>;

const ObjectSchemaBase = z.object({
  /** 
   * Identity & Metadata 
   */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine unique key (snake_case). Immutable.'),
  label: z.string().optional().describe('Human readable singular label (e.g. "Account")'),
  pluralLabel: z.string().optional().describe('Human readable plural label (e.g. "Accounts")'),
  description: z.string().optional().describe('Developer documentation / description'),
  icon: z.string().optional().describe('Icon name (Lucide/Material) for UI representation'),

  /**
   * Taxonomy & Organization
   */
  tags: z.array(z.string()).optional().describe('Categorization tags (e.g. "sales", "system", "reference")'),
  active: z.boolean().optional().default(true).describe('Is the object active and usable'),
  isSystem: z.boolean().optional().default(false).describe('Is system object (protected from deletion)'),
  abstract: z.boolean().optional().default(false).describe('Is abstract base object (cannot be instantiated)'),

  /**
   * Managed-by hint — declares which lifecycle bucket the object belongs
   * to so UI clients render the appropriate set of CRUD affordances and
   * the security layer can enforce matching defaults. Modelled after the
   * way Salesforce / ServiceNow / Workday segregate user-owned business
   * data from admin-authored configuration, system-driven runtime rows,
   * and append-only audit trails.
   *
   * - `platform`     — **Default.** User-owned business data. Generic
   *   New / Import / Edit / Delete affordances are all shown. Example:
   *   the user's own `sys_attachment`, `sys_comment`, `sys_saved_report`.
   * - `config`       — Admin-authored metadata / configuration. Generic
   *   New / Edit / Delete shown (admins author via wizard or form), but
   *   CSV Import is suppressed (config rows have nested JSON envelopes
   *   that don't round-trip through a flat sheet; clients should offer a
   *   purpose-built "Import definition (JSON)" action instead). Example:
   *   `sys_sharing_rule`, `sys_position`, `sys_permission_set`, `sys_view`,
   *   `sys_app`.
   * - `system`       — Runtime rows whose lifecycle is owned by a
   *   platform service (the approval engine, the sharing engine, the
   *   invitation service, …). Generic CRUD is hidden — users interact
   *   with these via *domain actions* invoked from the source record
   *   (e.g. "Submit for Approval" on an Opportunity creates an
   *   `sys_approval_request`; "Recall" on the request changes its
   *   state). Example: `sys_approval_request`, `sys_record_share`,
   *   `sys_notification`, `sys_invitation`,
   *   `sys_user_permission_set` / `sys_position_permission_set`.
   * - `append-only`  — Immutable audit log. No New / Import / Edit /
   *   Delete; only View and Export. Example: `sys_approval_action`,
   *   `sys_audit_log`, `sys_activity`, `sys_email`, `sys_presence`.
   * - `better-auth`  — Identity tables owned by the better-auth driver
   *   (sys_user, sys_session, sys_account, sys_member, sys_organization,
   *   sys_api_key, sys_jwks, sys_verification, sys_two_factor,
   *   sys_oauth_*, sys_device_code). Mutations must flow through the
   *   better-auth API so password hashing, token signing, email
   *   verification, and invitation flows fire correctly. Generic CRUD
   *   suppressed; replaced by purpose-built actions
   *   (Invite User, Reset Password, Revoke Session, Rotate Key, …).
   *
   * The flag is purely declarative on the schema. Enforcement happens in
   * two places:
   *   1. Default permission sets ({@link packages/platform-objects/src/security/default-permission-sets.ts})
   *      deny direct CRUD for `system` / `append-only` / `better-auth`.
   *   2. UI clients honour {@link resolveCrudAffordances} to gate the
   *      New / Import / Edit / Delete / Export buttons accordingly.
   *
   * Use {@link userActions} to override the default matrix for a single
   * field (e.g. an "append-only" table that should still allow Export).
   */
  managedBy: z.enum(['platform', 'config', 'system', 'append-only', 'better-auth']).optional().describe(
    'Lifecycle bucket — platform (user CRUD) | config (admin authored) | system (engine-managed) | append-only (audit) | better-auth (identity). UI clients honour the resolved affordance matrix.',
  ),

  /**
   * Per-object override of the generic CRUD affordances that the UI
   * surfaces. Each flag overrides the default derived from
   * {@link managedBy} via {@link resolveCrudAffordances}. Useful for the
   * handful of objects whose lifecycle doesn't cleanly fit a single
   * bucket — e.g. an `append-only` table that should still expose CSV
   * Export, or a `config` table that admins legitimately want to bulk
   * import via CSV.
   *
   * Omitting the block (or leaving individual flags `undefined`) keeps
   * the {@link managedBy}-derived default.
   */
  userActions: z.object({
    create: z.boolean().optional().describe('Show generic "New" button.'),
    import: z.boolean().optional().describe('Show CSV import wizard entry.'),
    edit: z.union([z.boolean(), RowCrudActionOverrideSchema]).optional().describe(
      'Allow inline / form edit of existing rows. Boolean, or an object adding per-record visibleWhen/disabledWhen CEL predicates.',
    ),
    delete: z.union([z.boolean(), RowCrudActionOverrideSchema]).optional().describe(
      'Show row-level delete + bulk delete. Boolean, or an object adding per-record visibleWhen/disabledWhen CEL predicates.',
    ),
    exportCsv: z.boolean().optional().describe('Show CSV export entry.'),
  }).optional().describe('Per-object override of the resolved CRUD affordance matrix.'),

  /**
   * System-field auto-injection control.
   *
   * The `SchemaRegistry` augments every user object with a small set of
   * implicit system fields at registration time so authors don't have to
   * declare them per-object (Salesforce-style). Currently injected:
   *
   *   - `organization_id` — `lookup → sys_organization`. Injected only when
   *     the kernel runs in multi-tenant mode (`OS_MULTI_ORG_ENABLED === 'true'`;
   *     default is off — single-tenant).
   *     Required for the default `tenant_isolation` RLS policy and the
   *     SecurityPlugin's auto-fill on insert to take effect.
   *
   * Author-declared fields with the same name always win over injection
   * (no overwrite). Objects with `managedBy` set are skipped entirely —
   * better-auth/system/platform tables already declare what they need.
   *
   * Set `systemFields: false` to opt the object out completely. Pass an
   * options object to selectively disable individual injections (currently
   * only `tenant`, but reserved keys `owner`/`audit` are pre-defined for
   * future expansion).
   *
   * @default undefined (= injection enabled, gated by kernel mode)
   */
  systemFields: z
    .union([
      z.literal(false),
      z.object({
        tenant: z.boolean().optional().describe('Inject organization_id (multi-tenant only). Default true.'),
        owner: z.boolean().optional().describe('Reserved for future owner_id auto-injection.'),
        audit: z.boolean().optional().describe('Reserved for future created_by/updated_by auto-injection.'),
      }),
    ])
    .optional()
    .describe('Opt out of, or selectively disable, registry-level system-field auto-injection.'),

  /** 
   * Storage & Virtualization 
   */
  datasource: z.string().optional().default('default').describe('Target Datasource ID. "default" is the primary DB.'),

  /**
   * External Binding (ADR-0015)
   * Present only for federated objects routed to a datasource whose
   * `schemaMode !== 'managed'`. Describes the remote table binding and
   * per-object writability. See {@link ObjectExternalBindingSchema}.
   */
  external: ObjectExternalBindingSchema.optional()
    .describe('Remote table binding for federated (external) objects.'),


  /**
   * Data Model
   */
  fields: z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/, {
    message: 'Field names must be lowercase snake_case (e.g., "first_name", "company", "annual_revenue")',
  }), FieldSchema).describe('Field definitions map. Keys must be snake_case identifiers.'),
  indexes: z.array(IndexSchema).optional().describe('Database performance indexes'),

  /**
   * Field Groups (MVP)
   * 
   * Declares logical groups for presenting fields in forms and detail
   * pages. The **array order is the group display order**. Each field's
   * `Field.group` references an entry's `key` to assign it to a group;
   * within a group, fields are displayed in their `ObjectSchema.fields`
   * declaration order.
   * 
   * See {@link ObjectFieldGroupSchema} for the full MVP contract and
   * deferred features.
   */
  fieldGroups: z.array(ObjectFieldGroupSchema).refine(
    (groups) => new Set(groups.map(g => g.key)).size === groups.length,
    { message: 'fieldGroups[].key must be unique within an object' },
  ).optional().describe('Ordered list of field groups (array order = display order). See ObjectFieldGroupSchema.'),
  
  /**
   * Advanced Data Management
   */
  
  // Multi-tenancy configuration
  tenancy: TenancyConfigSchema.optional().describe('Multi-tenancy configuration for SaaS applications'),

  /**
   * [ADR-0066 D2] Secure-by-default object posture. `access.default: 'private'`
   * opts the object OUT of blanket wildcard (`'*'`) permission grants (access
   * then needs an explicit per-object grant) and exempts it from wildcard RLS
   * via the posture-gated superuser bypass. Absent ⇒ `public` (today's
   * allow-by-default behaviour; no migration for existing objects).
   */
  access: ObjectAccessConfigSchema.optional().describe('[ADR-0066 D2] Object exposure posture (public-by-default vs private secure-by-default).'),

  /**
   * [ADR-0066 D3/⑤] Capability contract — capability name(s) (permission-set
   * `systemPermissions`; D1 records) a caller MUST hold to access this object.
   * Mirrors `App.requiredPermissions`. Enforced by plugin-security as an
   * AND-gate: checked IN ADDITION to permission-set CRUD grants — a caller
   * missing any required capability is denied regardless of grants.
   *
   * Two shapes:
   *  - `string[]` — required for ALL operations (read/create/update/delete).
   *  - `{ read?, create?, update?, delete? }` (⑤) — required only for the listed
   *    operation class, so an object can be read-open but write-gated.
   * Absent/empty ⇒ no capability gate.
   */
  requiredPermissions: ObjectRequiredPermissionsSchema.optional().describe('[ADR-0066 D3/⑤] Capabilities required to access this object (AND-gate) — `string[]` gates all CRUD, or a `{read,create,update,delete}` map gates per operation.'),
  
  // Soft delete configuration
  softDelete: SoftDeleteConfigSchema.optional().describe('Soft delete (trash/recycle bin) configuration'),
  
  // Versioning configuration
  versioning: VersioningConfigSchema.optional().describe('Record versioning and history tracking configuration'),

  // Data lifecycle (ADR-0057) — retention / rotation / archival contract,
  // enforced by the LifecycleService. Absent = `record` (today's behavior).
  lifecycle: LifecycleSchema.optional().describe('Data lifecycle contract (ADR-0057): class + retention/ttl/rotation/archive policies enforced by the platform LifecycleService.'),

  // Partitioning strategy
  
  /**
   * Logic & Validation (Co-located)
   * Best Practice: Define rules close to data.
   */
  validations: z.array(ValidationRuleSchema).optional().describe('Object-level validation rules'),

  /**
   * Declarative semantic activity milestones (ADR-0052 §5b.2). When a watched
   * field transitions INTO `value`, the platform emits a templated activity-row
   * on the record timeline — no `*.hook.ts` / `*.flow.ts`. Complements field-level
   * `trackHistory` (which renders raw "Field: old → new"): use milestones for
   * business-meaningful events ("Deal won", "Task completed"). `summary` supports
   * `{field}` tokens interpolated from the record; the milestone summary takes
   * precedence over the field-change summary for the same update. Consumed by
   * `@objectstack/plugin-audit` audit-writers (enforce-or-remove, ADR-0049).
   */
  activityMilestones: z.array(z.object({
    field: z.string().describe('Field to watch (typically a status/stage select).'),
    value: z.string().describe('The value the field must transition INTO to fire the milestone.'),
    summary: z.string().describe('Activity summary template; {field} tokens interpolate the record value. e.g. "Deal won: {name}".'),
    type: z.string().optional().describe('Activity type for the emitted row (default "completed").'),
  })).optional().describe('Declarative semantic activity milestones — emit a templated timeline row when a field transitions into a value, no hook code (ADR-0052 §5b.2).'),

  // ADR-0020: record state machines are not a separate `stateMachines` map —
  // each lifecycle is a `state_machine` rule in `validations` above (one rule
  // per state field). Parallel lifecycles = multiple rules. The write path
  // enforces the transition table; UIs read the legal next states via the
  // `/meta/objects/:name/state/:field?from=` introspection endpoint.

  /**
   * Display & UI Hints (Data-Layer)
   */
  /**
   * [ADR-0079] Canonical pointer to the object's PRIMARY title field — the one
   * real stored field (text / autonumber / formula→text) that is a record's
   * human name. Pairs with `recordName` (the Salesforce Name / Record-Name
   * model). Optional at the schema level for now (a hard required-refine is
   * staged so existing title-less metadata still parses). Resolve / derive via
   * `resolveDisplayField` from `@objectstack/spec/data` (display-name.ts), which
   * falls back to the deprecated `displayNameField` alias and then a derivation.
   */
  nameField: z.string().optional().describe('[ADR-0079] Canonical primary title field — the stored field used as the record display name (e.g. "name", "title"). Pairs with recordName.'),
  /**
   * @deprecated [ADR-0079] Renamed to `nameField`. Still ACCEPTED as an alias:
   * the schema copies `displayNameField` onto `nameField` on parse when
   * `nameField` is absent (both are preserved on the parsed output for
   * cross-repo back-compat). New metadata should set `nameField`.
   */
  displayNameField: z.string().optional().describe('[DEPRECATED → nameField] Field to use as the record display name (e.g., "name", "title"). Accepted as an alias for nameField.'),
  recordName: z.object({
    type: z.enum(['text', 'autonumber']).describe('Record name type: text (user-entered) or autonumber (system-generated)'),
    displayFormat: z.string().optional().describe('Auto-number format pattern (e.g., "CASE-{0000}", "INV-{YYYY}-{0000}")'),
    startNumber: z.number().int().min(0).optional().describe('Starting number for autonumber (default: 1)'),
  }).optional().describe('Record name generation configuration (Salesforce pattern)'),
  titleFormat: TemplateExpressionInputSchema.optional().describe('[DEPRECATED → nameField (ADR-0079)] Render-only title template; the server cannot return or query it, and an explicit nameField now takes precedence. Migrate a single-field title to nameField, a composite to a formula field designated as nameField.'),
  /**
   * [ADR-0085] Semantic role: the object's most important fields, in priority
   * order (the first entry wins wherever only one field fits, e.g. child-record
   * previews). Cross-surface by definition — drives default list/grid columns,
   * cards, hover/lookup previews, and the record-detail highlight strip (first
   * 4). Renamed from `compactLayout` (the value is an ordered field list, not
   * a layout); Salesforce compact-layout semantics.
   */
  highlightFields: z.array(z.string()).optional().describe('[ADR-0085] Ordered most-important fields; first entry wins where only one fits. Drives default columns, cards, previews, detail highlight strip. Renamed from compactLayout.'),
  // `compactLayout` (the pre-ADR-0085 spelling of `highlightFields`) was an
  // accepted parse-time alias for one deprecation window and is now RETIRED
  // (framework#2536): authoring it is rejected by `create()` like any unknown
  // key. All first-party consumers read `highlightFields` since objectui#2168.
  /**
   * [ADR-0085] Semantic role: the field that represents the record's LINEAR
   * lifecycle (an ordered pipeline / stage progression). A string names the
   * field; `false` declares the object's status-like field NON-linear (an
   * unordered state set such as active/suspended/void) and suppresses every
   * consumer's stage heuristics. Absent = consumers may heuristically detect
   * a stage field (status/stage/state/phase). Consumed by the record-detail
   * path/stepper today; kanban default grouping, list badges and report
   * bucketing are natural future consumers.
   */
  stageField: z.union([z.string(), z.literal(false)]).optional().describe('[ADR-0085] Lifecycle stage field (linear/ordered), or false to declare the status field non-linear and suppress stage heuristics. Absent = heuristic detection allowed.'),

  /**
   * Built-in List Views
   *
   * Curated, platform-shipped list views (grid / kanban / calendar / …)
   * keyed by view name. Rendered as segmented tabs in the console list page
   * **before** any user-saved `sys_view` rows. Use this for system objects
   * (audit, runtime, config) where the default "All records" grid lacks
   * business context — e.g. an approval-request list should ship with
   * "My pending", "I submitted", "Completed" tabs out of the box.
   *
   * Each value is an `ObjectListViewSchema` (a `ListViewSchema` whose `userFilters`
   * is narrowed to dropdown value chips — ADR-0047 "views" mode, where the
   * `ViewTabBar` owns the tab-bar role so `tabs` presets stay page-only) so authors
   * get the full filter/sort/grouping vocabulary plus quick-filter dropdowns.
   *
   * @example
   * ```ts
   * listViews: {
   *   my_pending: {
   *     type: 'grid',
   *     label: 'My Pending',
   *     filter: [{ field: 'pending_approvers', operator: 'contains', value: '{current_user_id}' }],
   *     sort: [{ field: 'updated_at', order: 'desc' }],
   *   },
   * }
   * ```
   */
  listViews: z.record(z.string(), ObjectListViewSchema).optional().describe('Built-in named list views (segmented tabs) shipped with the object schema — "views" mode, dropdown userFilters allowed, no page-only tabs (ADR-0047)'),

  /**
   * Search Engine Config 
   */
  searchableFields: z.array(z.string()).optional().describe('Fields the `$search` query matches against (ADR-0061). Canonical default for the record picker, list quick-search and global search; views may narrow it. When unset, search auto-defaults to the name/title field plus short-text fields.'),
  search: SearchConfigSchema.optional().describe('Search engine configuration'),
  
  /** 
   * System Capabilities 
   */
  enable: ObjectCapabilities.optional().describe('Enabled system features modules'),

  /**
   * Sharing Model (org-wide default).
   *
   * `controlled_by_parent` (ADR-0055) makes this a DETAIL object in a
   * master-detail relationship: its access is *derived* from the master record
   * — a user sees/edits a detail only if they can see/edit its master. The
   * object must declare exactly one required `master_detail` field identifying
   * the master; the security layer auto-injects `masterFK IN (accessible master
   * ids)` on reads and requires master edit-access on by-id writes. No RLS policy
   * is authored — the inheritance is derived from the relationship.
   */
  sharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).optional().describe('Org-Wide Default record visibility (OWD) for INTERNAL users. Canonical four only (legacy aliases removed, ADR-0090 D4): private (owner-only) | public_read (everyone reads, owner writes) | public_read_write (everyone reads+writes) | controlled_by_parent (derived from the master record). A CUSTOM object that omits this resolves to private at runtime (ADR-0090 D1).'),

  /**
   * [ADR-0090 D11] Org-Wide Default for EXTERNAL principals
   * (`principal.audience: 'external'` — portal / partner users). A second,
   * stricter dial: defaults to `private` when omitted and may NEVER be wider
   * than the internal `sharingModel` (validated at authoring). The BU depth
   * axis does not apply to externals; their visibility = own records +
   * explicit shares + this baseline.
   */
  externalSharingModel: z.enum(['private', 'public_read', 'public_read_write', 'controlled_by_parent']).optional().describe('[ADR-0090 D11] OWD for external (portal/partner) principals. Defaults to private; must be <= sharingModel in openness.'),

  /**
   * Public Share-Link Policy
   *
   * Opt-in declaration that records of this object MAY be published via
   * an opaque capability token (Notion / Google Docs / Figma "anyone with
   * the link" style). When omitted or `enabled:false`, the platform
   * refuses to create share-link rows for this object — independent of
   * any permission the caller holds.
   *
   * Distinct from {@link sharingModel}, which governs *principal-based*
   * sharing (share with specific users / teams / roles). A single object
   * can opt into both: principals get full edit, link recipients get
   * read-only with redaction.
   *
   * Defaults are conservative: when `enabled:true` and no other field is
   * provided, the plugin allows `link_only` audience + `view` permission
   * (the safest combination — caller still needs the URL to access).
   *
   * @see packages/plugins/plugin-sharing/src/share-link-service.ts
   */
  publicSharing: z.object({
    /** Master switch. When false (default), no share links can be issued for this object. */
    enabled: z.boolean().default(false).describe('Allow records of this object to be published via share link'),
    /**
     * Audiences the platform will accept when issuing a link.
     * - `public`       — search engines may index; no token check (rare)
     * - `link_only`    — anyone holding the token (default)
     * - `signed_in`    — token + an authenticated session of any tenant user
     * - `email`        — token + recipient's email matches an allowlist
     */
    allowedAudiences: z.array(z.enum(['public', 'link_only', 'signed_in', 'email'])).optional().describe('Audiences callers may select when creating a link'),
    /** Permission levels callers may grant via a link. Defaults to `['view']`. */
    allowedPermissions: z.array(z.enum(['view', 'comment', 'edit'])).optional().describe('Permission levels selectable on the share dialog'),
    /** Hard cap on requested expiry, in days. Links with `expires_at` further out are rejected. */
    maxExpiryDays: z.number().int().positive().optional().describe('Reject links with expiry beyond this many days'),
    /**
     * Fields stripped from every response served via a share token,
     * regardless of audience. Use for prompts, raw model output,
     * internal metadata, PII, etc. The owner's normal API access is
     * unaffected — redaction is applied only when the request principal
     * is `kind:'share-link'`.
     */
    redactFields: z.array(z.string()).optional().describe('Field names removed from records served via a share token'),
    /**
     * Optional CEL/JSONLogic predicate evaluated against the candidate
     * record when a link is created. When the predicate returns false,
     * the create call fails with 422 (e.g. "draft records cannot be
     * shared"). Evaluator is the same one used by sharing rules.
     */
    eligibility: z.string().optional().describe('CEL expression that must evaluate to true on the target record'),
  }).optional().describe('Public share-link policy (Notion/Figma-style link sharing)'),

  /** Key Prefix */
  keyPrefix: z.string().max(5).optional().describe('Short prefix for record IDs (e.g., "001" for Account)'),

  // [ADR-0085] The former `detail: { … }.passthrough()` UI-hints block is
  // REMOVED. Presentation intent lives in the cross-surface semantic roles
  // above (nameField / highlightFields / stageField / fieldGroups); per-page
  // control is an assigned Page. The passthrough block bred silently-inert
  // keys (9 read by renderers vs 3 typed; the typed `hideReferenceRail` was
  // itself a no-op for spec authors) — see the ADR for the full inventory.
  // `renderViaSchema` — the block's last-surviving key, kept only as the
  // legacy monolith detail renderer's kill-switch — retired with that
  // renderer in objectui#2546 (ADR-0085 PR4).

  /**
   * Object Actions
   * 
   * Actions associated with this object. Populated automatically by `defineStack()`
   * when top-level actions specify `objectName` matching this object.
   * Can also be defined directly on the object.
   * 
   * Aligns with Salesforce/ServiceNow patterns where actions are part of the
   * object schema, so API responses (e.g., `/api/v1/meta/objects/:name`)
   * include the action list without requiring downstream merge.
   */
  actions: z.array(ActionSchema).optional().describe('Actions associated with this object (auto-populated from top-level actions via objectName)'),

  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this object.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,
});

/**
 * Converts a snake_case name to a human-readable Title Case label.
 * @example snakeCaseToLabel('project_task') → 'Project Task'
 */
function snakeCaseToLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Known-confusable schema keys → precise authoring guidance.
 *
 * ADR-0032's "no silent failure" principle applied to metadata *shape*: an
 * unknown top-level key on `ObjectSchema.create()` used to be discarded by
 * Zod's default `.strip()`, so a misauthored schema key vanished with no
 * error, no warning, and a green `tsc` — shipping dead metadata the author
 * believed they had wired up (issue #1535, object-level `workflows: [...]`).
 *
 * These entries turn the most likely mistakes into a fixable error that points
 * at the *supported* mechanism rather than a generic "unknown key".
 */
const UNKNOWN_KEY_GUIDANCE: Record<string, string> = {
  workflows:
    '`workflows` is not an ObjectSchema field. Object-level, record-triggered ' +
    'automation is authored as a lifecycle hook (`src/objects/<name>.hook.ts`, ' +
    'registered via `defineHook()`) or as a top-level `record_change` flow — ' +
    'not as `workflows[]` on the object schema.',
  workflow:
    '`workflow` is not an ObjectSchema field. Record-triggered automation is ' +
    'authored as a lifecycle hook (`src/objects/<name>.hook.ts`) or a top-level ' +
    '`record_change` flow.',
  hooks:
    '`hooks` is not an ObjectSchema field. Lifecycle hooks live in their own ' +
    '`src/objects/<name>.hook.ts` module, registered via `defineHook()`.',
  triggers:
    '`triggers` is not an ObjectSchema field. Use a lifecycle hook ' +
    '(`src/objects/<name>.hook.ts`) or a top-level `record_change` flow.',

  // ── Tombstones for RETIRED keys (upgrade prescriptions) ────────────────
  // A retired key's error must carry the fix: the compile/validation error is
  // the one upgrade channel every consumer is guaranteed to hit — an agent
  // bumping @objectstack/spec sees THIS message, not our docs site. Each entry
  // names what replaced the key and the version/decision that removed it.
  // Tombstones age out too: drop an entry ~two majors after the removal
  // (by then it's archaeology, not an upgrade; see CHANGELOG.md for history).
  compactLayout:
    '`compactLayout` was renamed to `highlightFields` in @objectstack/spec 11.7.0 ' +
    '(ADR-0085 semantic roles) and the alias was retired in 11.9.1 (#2536). ' +
    'Rename the key — the value shape (ordered field-name list) is unchanged.',
  detail:
    'The `detail` UI-hints block was removed by ADR-0085 (spec 11.7.0). Its ' +
    'jobs moved to top-level semantic roles: `detail.stageField` → `stageField` ' +
    '(string | false), `detail.highlightFields` → `highlightFields`, section ' +
    'layout → `fieldGroups` + `Field.group`. Whole-page customization is done ' +
    'by assigning a custom Page schema instead of per-page hint keys.',
  views:
    '`views` is not an ObjectSchema field: the object-level `views.form/*` and ' +
    '`views.detail/*` UI-hint dialect was never part of the spec and its ' +
    'renderer support was removed (ADR-0085). Use the semantic roles ' +
    '(`highlightFields`, `stageField`, `fieldGroups`) for hints and `listViews` ' +
    'for named list views.',
  defaultDetailForm:
    '`defaultDetailForm` was never implemented and was removed from the spec ' +
    '(#2402). Curate the record page by assigning a custom Page schema; form ' +
    'layout derives from `fieldGroups` + `Field.group`.',
};

/** Levenshtein edit distance — backs the "did you mean" hint for typo'd keys. */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Closest known key within a small edit distance, for typo hints (`indexs` → `indexes`). */
function suggestKey(unknown: string, knownKeys: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const key of knownKeys) {
    const d = editDistance(unknown.toLowerCase(), key.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  // Only suggest when the keys are genuinely close (guards against noise).
  return best !== undefined && bestDist <= Math.max(2, Math.floor(unknown.length / 3))
    ? best
    : undefined;
}

/**
 * Builds a precise, fixable error for unknown top-level keys on
 * `ObjectSchema.create()` — the metadata-shape analogue of ADR-0032's "no
 * silent failure" (issue #1535). Because authored `*.object.ts` modules call
 * `create()`, this surfaces as a located build error instead of a silently
 * stripped field.
 */
function unknownKeyError(objectName: unknown, unknownKeys: string[], knownKeys: string[]): Error {
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : '<unnamed>';
  const lines = unknownKeys.map((key) => {
    const guidance = UNKNOWN_KEY_GUIDANCE[key];
    if (guidance) return `  • ${guidance}`;
    const suggestion = suggestKey(key, knownKeys);
    return suggestion
      ? `  • \`${key}\` is not an ObjectSchema field — did you mean \`${suggestion}\`?`
      : `  • \`${key}\` is not an ObjectSchema field.`;
  });
  return new Error(
    `ObjectSchema.create('${name}'): unknown key(s) — ${unknownKeys.join(', ')}.\n` +
    'These keys would previously have been stripped silently at build, shipping ' +
    'dead metadata with no diagnostic (ADR-0032 "no silent failure", issue #1535).\n\n' +
    `${lines.join('\n')}\n\n` +
    'Remove the unknown key(s), fix the typo, or move the logic to a supported mechanism.',
  );
}

/**
 * Rejects excess top-level keys at compile time: any key of `T` that is not a
 * key of the ObjectSchema input shape is constrained to `never`, turning the
 * silent strip into a `tsc` error at the authoring site as well as at build.
 */
type NoExcessObjectKeys<T> = T &
  Record<Exclude<keyof T, keyof z.input<typeof ObjectSchemaBase>>, never>;

/**
 * [ADR-0079] Back-compat alias normalization: an object authored with the
 * deprecated `displayNameField` key still parses by mapping it onto the
 * canonical `nameField` when `nameField` is absent. `displayNameField` is
 * PRESERVED on the output (cross-repo consumers / older tests still read it).
 * Non-object inputs pass through untouched (Zod raises the real type error).
 */
function normalizeNameFieldAlias(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if (obj.nameField == null && typeof obj.displayNameField === 'string') {
    return { ...obj, nameField: obj.displayNameField };
  }
  return input;
}

/**
 * [ADR-0085] Parse-time alias normalization for the semantic-role renames
 * (same pattern as `normalizeNameFieldAlias`; deprecated keys are PRESERVED
 * on output for cross-repo back-compat):
 *
 * - (`compactLayout` ⇄ `highlightFields` mirrored here during the ADR-0085
 *   deprecation window; RETIRED by framework#2536 once objectui#2168 shipped.)
 * - `fieldGroups[].collapse` derived from the deprecated flags when absent:
 *   the UI-dialect `collapsible`/`collapsed` pair wins over the old
 *   `defaultExpanded` (it is what designer-authored metadata actually
 *   carries); mapping: collapsed:true → 'collapsed'; collapsible:true →
 *   'expanded'; collapsible:false → 'none'; defaultExpanded:false →
 *   'collapsed'; defaultExpanded:true → 'expanded'.
 */
function normalizeSemanticRoleAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  let out = obj;

  if (Array.isArray(obj.fieldGroups)) {
    let changed = false;
    const groups = (obj.fieldGroups as unknown[]).map((g) => {
      if (!g || typeof g !== 'object' || Array.isArray(g)) return g;
      const grp = g as Record<string, unknown>;
      if (grp.collapse != null) return g;
      let collapse: string | undefined;
      if (typeof grp.collapsible === 'boolean' || typeof grp.collapsed === 'boolean') {
        collapse = grp.collapsed === true ? 'collapsed' : grp.collapsible === true ? 'expanded' : 'none';
      } else if (typeof grp.defaultExpanded === 'boolean') {
        collapse = grp.defaultExpanded ? 'expanded' : 'collapsed';
      }
      if (collapse === undefined) return g;
      changed = true;
      return { ...grp, collapse };
    });
    if (changed) out = { ...out, fieldGroups: groups };
  }

  return out;
}

/**
 * Enhanced ObjectSchema with Factory
 */
export const ObjectSchema = lazySchema(() => {
  // Capture the ORIGINAL ZodObject parse/safeParse before `Object.assign`
  // mutates `ObjectSchemaBase` in place (assign returns the same object, so
  // overriding `.parse` on the result would otherwise recurse into itself).
  const baseParse = ObjectSchemaBase.parse.bind(ObjectSchemaBase);
  const baseSafeParse = ObjectSchemaBase.safeParse.bind(ObjectSchemaBase);
  return Object.assign(ObjectSchemaBase, {
  /**
   * [ADR-0079] Parse with deprecated-`displayNameField`→`nameField` alias
   * normalization applied first. Wraps the captured original ZodObject parse,
   * so `.shape` / `.create()`'s internal `ObjectSchemaBase.parse` keep working.
   */
  parse(data: unknown, params?: Parameters<typeof ObjectSchemaBase.parse>[1]) {
    return baseParse(normalizeSemanticRoleAliases(normalizeNameFieldAlias(data)), params);
  },
  safeParse(data: unknown, params?: Parameters<typeof ObjectSchemaBase.safeParse>[1]) {
    return baseSafeParse(normalizeSemanticRoleAliases(normalizeNameFieldAlias(data)), params);
  },
  /**
   * Type-safe factory for creating business object definitions.
   * 
   * Enhancements over raw schema:
   * - **Auto-label**: Generates `label` from `name` if not provided (snake_case → Title Case).
   * - **Validation**: Runs Zod `.parse()` to validate the config at creation time.
   * - **No silent strip** (ADR-0032 / #1535): unknown top-level keys (e.g. a
   *   typo'd `validation`, or an object-level `workflows[]`) are rejected with a
   *   precise, fixable error instead of being discarded by Zod's `.strip()`.
   *
   * @example
   * ```ts
   * const Task = ObjectSchema.create({
   *   name: 'project_task',
   *   // label auto-generated as 'Project Task'
   *   fields: {
   *     subject: { type: 'text', label: 'Subject', required: true },
   *   },
   * });
   * ```
   */
  create: <const T extends z.input<typeof ObjectSchemaBase>>(config: NoExcessObjectKeys<T>): Omit<ServiceObject, 'fields'> & Pick<T, 'fields'> => {
    // ADR-0032 "no silent failure" for schema shape (issue #1535): an unknown
    // top-level key here used to be discarded silently by Zod's `.strip()`. We
    // reject it with a located, fixable message *before* parsing so authors get
    // a build error instead of vanished metadata.
    const cfg = config as T & Record<string, unknown>;
    const knownKeys = Object.keys(ObjectSchemaBase.shape);
    const unknownKeys = Object.keys(cfg).filter((k) => !knownKeys.includes(k));
    if (unknownKeys.length > 0) {
      throw unknownKeyError(cfg.name, unknownKeys, knownKeys);
    }
    const withDefaults = {
      ...cfg,
      label: cfg.label ?? snakeCaseToLabel(cfg.name as string),
    };
    // [ADR-0079] `ObjectSchemaBase.parse` here is the alias-normalizing override
    // assigned just below (Object.assign mutates the base in place), so the
    // deprecated `displayNameField`→`nameField` mapping is applied for create()
    // too — no need to normalize again at this call site.
    return ObjectSchemaBase.parse(withDefaults) as Omit<ServiceObject, 'fields'> & Pick<T, 'fields'>;
  },
  });
});

export type ServiceObject = z.infer<typeof ObjectSchemaBase>;
export type ServiceObjectInput = z.input<typeof ObjectSchemaBase>;
export type ObjectCapabilities = z.infer<typeof ObjectCapabilities>;
export type ObjectIndex = z.infer<typeof IndexSchema>;
export type TenancyConfig = z.infer<typeof TenancyConfigSchema>;
export type ObjectAccessConfig = z.infer<typeof ObjectAccessConfigSchema>;
export type SoftDeleteConfig = z.infer<typeof SoftDeleteConfigSchema>;
export type VersioningConfig = z.infer<typeof VersioningConfigSchema>;
export type LifecycleClass = z.infer<typeof LifecycleClassSchema>;
export type Lifecycle = z.infer<typeof LifecycleSchema>;

/**
 * Resolved CRUD affordance matrix for an object — what generic
 * lifecycle actions UI clients should expose in their toolbars.
 *
 * Use {@link resolveCrudAffordances} to compute this from a schema; the
 * `managedBy` flag drives the defaults, and the optional `userActions`
 * block per-flag-overrides them. UI clients (`ObjectView`,
 * `RecordDetailView`, `RecordFormPage`, …) gate their buttons on this
 * matrix in combination with the user's permissions.
 *
 * The presence of an affordance here means "the *object* permits this
 * action conceptually"; the user still needs the matching permission
 * grant to execute it.
 */
export interface CrudAffordances {
  /** Generic "New" button (single record creation form). */
  create: boolean;
  /** CSV bulk-import wizard. Disabled for config / system / append-only / better-auth by default. */
  import: boolean;
  /** Inline + form editing of existing rows. */
  edit: boolean;
  /** Row-level + bulk delete. */
  delete: boolean;
  /** CSV / clipboard export. Allowed even on append-only audit tables by default. */
  exportCsv: boolean;
  /**
   * Per-record CEL predicates for the built-in row Edit action, present only
   * when `userActions.edit` used the object form (objectui#2614). Evaluate
   * per row against `record.*`; see {@link RowCrudActionOverrideSchema}.
   */
  editPredicates?: RowCrudPredicates;
  /** Per-record CEL predicates for the built-in row Delete action. */
  deletePredicates?: RowCrudPredicates;
}

/**
 * Per-record gating predicates carried through {@link resolveCrudAffordances}.
 * Kept as authored (`string` shorthand or `{ dialect, source }` envelope) —
 * consumers hand them to the canonical CEL row-predicate evaluator untouched.
 */
export interface RowCrudPredicates {
  visibleWhen?: Expression | ExpressionInput;
  disabledWhen?: Expression | ExpressionInput;
}

/**
 * Default affordance matrix per {@link ObjectSchemaBase.managedBy} bucket.
 * Mirrors how Salesforce / ServiceNow / Workday / Notion expose CRUD on
 * different categories of system tables.
 *
 *   platform     — full CRUD (user-owned business data)
 *   config       — admin authored: New/Edit/Delete OK, no CSV import
 *                  (definitions have nested envelopes; admins should use
 *                  a purpose-built "Import definition" action instead)
 *   system       — engine-managed runtime rows: no generic CRUD; users
 *                  interact via domain actions on the source record
 *   append-only  — audit log: View + Export only
 *   better-auth  — identity tables owned by better-auth driver; CRUD
 *                  routed through purpose-built actions (Invite, Reset
 *                  PW, Revoke, …)
 */
const CRUD_AFFORDANCE_DEFAULTS: Record<NonNullable<ServiceObject['managedBy']> | 'platform', CrudAffordances> = {
  platform:      { create: true,  import: true,  edit: true,  delete: true,  exportCsv: true },
  config:        { create: true,  import: false, edit: true,  delete: true,  exportCsv: true },
  system:        { create: false, import: false, edit: false, delete: false, exportCsv: true },
  'append-only': { create: false, import: false, edit: false, delete: false, exportCsv: true },
  'better-auth': { create: false, import: false, edit: false, delete: false, exportCsv: true },
};

/**
 * Resolve the effective CRUD affordance matrix for an object schema.
 *
 * Starts from the bucket default keyed off `managedBy` (defaulting to
 * `'platform'` if unset) and applies the per-flag overrides in
 * `userActions`. Returns a fresh object so callers can mutate safely.
 *
 * @example
 * ```ts
 * const aff = resolveCrudAffordances(sysApprovalRequestSchema);
 * // → { create:false, import:false, edit:false, delete:false, exportCsv:true }
 * ```
 */
export function resolveCrudAffordances(
  obj: Pick<ServiceObject, 'managedBy' | 'userActions'> | { managedBy?: string; userActions?: ServiceObject['userActions'] },
): CrudAffordances {
  const bucket = (obj?.managedBy ?? 'platform') as keyof typeof CRUD_AFFORDANCE_DEFAULTS;
  const base = CRUD_AFFORDANCE_DEFAULTS[bucket] ?? CRUD_AFFORDANCE_DEFAULTS.platform;
  const overrides = obj?.userActions ?? {};
  const edit = normalizeRowCrudOverride(overrides.edit, base.edit);
  const del = normalizeRowCrudOverride(overrides.delete, base.delete);
  const out: CrudAffordances = {
    create:    overrides.create    ?? base.create,
    import:    overrides.import    ?? base.import,
    edit:      edit.enabled,
    delete:    del.enabled,
    exportCsv: overrides.exportCsv ?? base.exportCsv,
  };
  if (edit.predicates) out.editPredicates = edit.predicates;
  if (del.predicates) out.deletePredicates = del.predicates;
  return out;
}

/**
 * Collapse a `userActions.edit` / `userActions.delete` override — bare
 * boolean or `{ enabled, visibleWhen, disabledWhen }` object — onto the
 * bucket default. The predicates pass through as authored; `predicates` is
 * only set when at least one predicate is present, so the boolean-only path
 * stays byte-identical to the pre-#2614 result.
 */
function normalizeRowCrudOverride(
  override: boolean | { enabled?: boolean; visibleWhen?: unknown; disabledWhen?: unknown } | null | undefined,
  base: boolean,
): { enabled: boolean; predicates?: RowCrudPredicates } {
  if (override == null) return { enabled: base };
  if (typeof override === 'boolean') return { enabled: override };
  const enabled = override.enabled ?? base;
  const visibleWhen = override.visibleWhen as RowCrudPredicates['visibleWhen'];
  const disabledWhen = override.disabledWhen as RowCrudPredicates['disabledWhen'];
  if (visibleWhen == null && disabledWhen == null) return { enabled };
  const predicates: RowCrudPredicates = {};
  if (visibleWhen != null) predicates.visibleWhen = visibleWhen;
  if (disabledWhen != null) predicates.disabledWhen = disabledWhen;
  return { enabled, predicates };
}

// =================================================================
// Object Ownership Model
// =================================================================

/**
 * How a package relates to an object it references.
 * 
 * - `own`: This package is the original author/owner of the object.
 *   Only one package may own a given object name. The owner defines
 *   the base schema (table name, primary key, core fields).
 * 
 * - `extend`: This package adds fields, views, or actions to an
 *   existing object owned by another package. Multiple packages
 *   may extend the same object. Extensions are merged at boot time.
 * 
 * Follows Salesforce/ServiceNow patterns:
 *   object name = database table name, globally unique, no namespace prefix.
 */
export const ObjectOwnershipEnum = z.enum(['own', 'extend']);
export type ObjectOwnership = z.infer<typeof ObjectOwnershipEnum>;

/**
 * Object Extension Entry — used in `objectExtensions` array.
 * Declares fields/config to merge into an existing object owned by another package.
 * 
 * @example
 * ```ts
 * objectExtensions: [{
 *   extend: 'contact',               // target object FQN
 *   fields: { sales_stage: Field.select([...]) },
 * }]
 * ```
 */
export const ObjectExtensionSchema = lazySchema(() => z.object({
  /** The target object name (FQN) to extend */
  extend: z.string().describe('Target object name (FQN) to extend'),
  
  /** Fields to merge into the target object (additive) */
  fields: z.record(z.string(), FieldSchema).optional().describe('Fields to add/override'),
  
  /** Override label */
  label: z.string().optional().describe('Override label for the extended object'),
  
  /** Override plural label */
  pluralLabel: z.string().optional().describe('Override plural label for the extended object'),
  
  /** Override description */
  description: z.string().optional().describe('Override description for the extended object'),
  
  /** Additional validation rules to add */
  validations: z.array(ValidationRuleSchema).optional().describe('Additional validation rules to merge into the target object'),
  
  /** Additional indexes to add */
  indexes: z.array(IndexSchema).optional().describe('Additional indexes to merge into the target object'),
  
  /** Merge priority. Higher number applied later (wins on conflict). Default: 200 */
  priority: z.number().int().min(0).max(999).default(200).describe('Merge priority (higher = applied later)'),
}));

export type ObjectExtension = z.infer<typeof ObjectExtensionSchema>;
/** Authoring input for {@link ObjectExtension} — defaulted fields are optional. */
export type ObjectExtensionInput = z.input<typeof ObjectExtensionSchema>;

/**
 * Type-safe factory for an extension to an object owned by another package. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: ObjectExtension` literal.
 */
export function defineObjectExtension(config: z.input<typeof ObjectExtensionSchema>): ObjectExtension {
  return ObjectExtensionSchema.parse(config);
}
