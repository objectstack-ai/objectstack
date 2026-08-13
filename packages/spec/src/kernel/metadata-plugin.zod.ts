// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { MetadataManagerConfigSchema } from './metadata-loader.zod';
import { MergeStrategyConfigSchema, CustomizationPolicySchema } from './metadata-customization.zod';
import { ActionSchema } from '../ui/action.zod';

/**
 * # Metadata Plugin Protocol
 *
 * Defines the specification for the **Metadata Plugin** — the central authority
 * responsible for managing ALL metadata across the ObjectStack platform.
 *
 * ## Architecture
 * The Metadata Plugin consolidates all scattered metadata operations into a single,
 * cohesive plugin that "takes over" the entire platform's metadata management:
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                     Metadata Plugin                             │
 * │                                                                  │
 * │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
 * │  │ Type Registry │  │  Loader      │  │ Customization Layer  │  │
 * │  │ (all types)   │  │  (file/db/s3)│  │ (overlay / merge)    │  │
 * │  └──────────────┘  └──────────────┘  └──────────────────────┘  │
 * │                                                                  │
 * │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
 * │  │ Persistence  │  │  Query       │  │ Lifecycle            │  │
 * │  │ (db records) │  │  (search)    │  │ (validate/deploy)    │  │
 * │  └──────────────┘  └──────────────┘  └──────────────────────┘  │
 * └──────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Alignment
 * - **Salesforce**: Metadata API (deploy, retrieve, describe)
 * - **ServiceNow**: System Dictionary + Metadata API
 * - **Kubernetes**: API Server + CRD Registry
 *
 * ## References
 * - kernel/metadata-loader.zod.ts — MetadataManager wiring (datasource, cache, write gates)
 * - kernel/metadata-customization.zod.ts — Overlay/merge protocol
 * - system/metadata-persistence.zod.ts — Database record format + loader/watch envelope types
 * - contracts/metadata-service.ts — Service interface
 */

// ==========================================
// Metadata Type Registry
// ==========================================

/**
 * Platform Metadata Type Enum
 *
 * The canonical list of all metadata types managed by the platform.
 * Each type maps to a specific Zod schema (e.g., ObjectSchema, ViewSchema).
 * Plugins can extend this registry via `contributes.kinds` in the manifest.
 *
 * ## Naming Convention
 * **IMPORTANT:** All metadata type names are in **SINGULAR** form:
 * - ✅ Use: `'agent'`, `'tool'`, `'skill'`, `'view'`, `'flow'`, `'action'`
 * - ❌ NOT: `'agents'`, `'tools'`, `'skills'`, `'views'`, `'flows'`, `'actions'`
 *
 * This convention applies to:
 * - Protocol definitions (this enum)
 * - UI plugin registrations (`metadataTypes`, `metadataIcons`)
 * - Metadata service operations
 * - File patterns (`*.agent.ts`, `*.tool.ts`)
 *
 * REST API endpoints continue to use plural forms per REST conventions:
 * - `/api/v1/ai/agents`, `/api/v1/ai/conversations`
 */
import { lazySchema } from '../shared/lazy-schema';
export const MetadataTypeSchema = lazySchema(() => z.enum([
  // Data Protocol
  'object',      // Business entity definition (ObjectSchema)
  'field',       // Standalone field definition (FieldSchema)
  // ADR-0088: there is no `trigger` metadata type — sync data-layer logic is a
  // `hook` (24 lifecycle events); async automation is a `record_change` flow.
  // (The `triggers` capability token in `requires:` is a different namespace.)
  // ADR-0088 (#4509): there is no `validation` metadata type — validation rules
  // are authored INLINE as `object.validations[]`, which is the only shape the
  // engine evaluates. A standalone rule had no way to say what it validated
  // (`ValidationRuleSchema` carries no object-binding key and every variant is
  // strict), so an item authored here bound to nothing and intercepted no write
  // — including `state_machine` rules, which ADR-0020 routes through this same
  // inline shape. `ValidationRuleSchema` itself is unchanged and fully live.
  'hook',        // Data hooks (HookSchema)
  'seed',        // Seed/fixture data — runtime-draftable; publishing applies it (SeedSchema)
  'mapping',     // Import/export field mappings (MappingSchema) — consumed by POST /data/:object/import via mappingName (#2611); promoted to a kind per the ADR-0088 admission test once the consumer landed

  // UI Protocol
  'view',        // List/form views (ViewSchema)
  'page',        // Standalone pages (PageSchema)
  'dashboard',   // Dashboard layouts (DashboardSchema)
  'app',         // Application shell (AppSchema)
  'action',      // UI/Server actions (ActionSchema)
  'report',      // Report definitions (ReportSchema)
  'dataset',     // Analytics semantic layer — dimensions/measures (DatasetSchema, ADR-0021)

  // Automation Protocol
  'flow',        // Visual logic flows (FlowSchema)
  // ADR-0020: there is no `workflow` metadata type — record state machines are
  // authored inline as a `state_machine` validation rule on the object (the
  // `validations` discriminated union), enforced on the write path.
  // ADR-0019: `approval` is no longer a metadata type — approvals are authored
  // as Approval nodes inside a `flow`.
  'job',         // Background / scheduled jobs (JobSchema)

  // System Protocol
  'datasource',  // Data connections (DatasourceSchema)
  'external_catalog', // Cached remote schema snapshot for federated datasources (ADR-0015) — RUNTIME-CREATED by the Sync wizard (ADR-0062/0088); packages never ship one
  'translation', // i18n resources (TranslationSchema)
  // ADR-0088: `router`/`function`/`service` are NOT metadata kinds — they are
  // code contributions: plugin `contributes.routes` + declarative `apis:`
  // (router), `defineStack({ functions })` + `contributes.functions`
  // (function), and the plugin/service registry itself (service).
  //
  // [#5271, part of #5206] `api` is the ONE declarative endpoint ITEM kind, and
  // it is NOT a reversal of the `router` retirement above: `router` was retired
  // as a KIND because its delivered forms (`contributes.routes`, imperative
  // `http.server` mounts) are code contributions. A single `ApiEndpoint` — a
  // stable URL plus a policy layer over an existing pipeline — is a declarative
  // artifact, and it passes all three clauses of ADR-0088's admission test:
  //   1. INDEPENDENT LIFECYCLE — the endpoint matcher indexes, invalidates and
  //      re-judges one stored `api` item at a time (`buildEndpointIndex`,
  //      `MetadataManager.ENDPOINT_METADATA_TYPE`).
  //   2. DECLARATIVE GOVERNABILITY — file patterns plus a resolved declaration
  //      schema (`ApiEndpointSchema`), see the registry entry below. ⚠️ This
  //      clause originally read "`allowRuntimeCreate: true` plus file
  //      patterns"; #5488 flipped that flag to `false` (maintainer ruling
  //      2026-08-07), so governability now rests on the artifact route alone —
  //      which is the route that was ever governed. The admission test is
  //      unaffected: ADR-0088 asks whether the kind is DECLARATIVELY governed,
  //      not whether it is runtime-writable.
  //   3. A REAL CONSUMER — #5040's E-series executor serves them and
  //      `/openapi.json` describes them; #5040 E8 proves it on a real boot.
  // ADR-0088's own `router` row already anticipated this: "the endpoint
  // executor is being built under #5040, after which declarative `apis:`
  // becomes a third, real delivered form".
  //
  // The kind was live long before it was declared — artifact ingest has mapped
  // `defineStack({ apis })` → `api` items (`ARTIFACT_FIELD_TO_TYPE`) all along,
  // so this entry closes the MIRROR of `declared ≠ enforced`: enforced but
  // undeclared. Until #5271 the type resolved no schema, so `saveMetaItem`
  // stored ANY JSON under it unvalidated (#5206).
  'api',         // Declarative HTTP endpoints (ApiEndpointSchema, ADR-0121)
  // #4616: the canonical schema is `EmailTemplateDefinitionSchema`
  // (`system/email-template.zod.ts`), which is what `BUILTIN_METADATA_TYPE_SCHEMAS`
  // resolves this kind to. This comment used to name `EmailTemplateSchema` — the
  // legacy sub-shape spec 7.1.0 demoted when it fixed that Prime Directive #8
  // double-declaration, and removed outright in #4616 — which is exactly how
  // consumers kept wiring the wrong one.
  'email_template', // Outbound email templates (EmailTemplateDefinitionSchema)
  'doc',         // Package documentation — flat Markdown items (DocSchema, ADR-0046)
  'book',        // Documentation navigation spine (BookSchema, ADR-0046 §6)

  // Security Protocol
  'permission',  // Permission sets (PermissionSetSchema)
  'position',    // Positions — flat capability-distribution groups (ADR-0090 D3)
  // [#5961] `capability` was ENFORCED BUT UNDECLARED — the same mirror of
  // `declared ≠ enforced` that #5271 closed for `api`. `PLURAL_TO_SINGULAR`
  // has mapped `capabilities` → `capability` since #5870, `AppPlugin`
  // registers stack-declared capabilities under that exact name, and
  // `bootstrapDeclaredCapabilities` reads them back — but the kind was absent
  // from this enum, from `BUILTIN_METADATA_TYPE_SCHEMAS` and from
  // `DEFAULT_METADATA_TYPE_REGISTRY`, so it resolved no schema and
  // `PUT /api/v1/meta/capability/:name` stored ANY JSON on an authorization
  // surface. ⚠️ `role` / `profile` / `policy` are a DIFFERENT question and are
  // deliberately NOT admitted here: they have no `PLURAL_TO_SINGULAR` mapping,
  // no declaration schema and no read-back seam — see #5961's ruling.
  'capability',  // Package-declared authorization capabilities (CapabilityDeclarationSchema, ADR-0066 D1)

  // AI Protocol
  'agent',       // AI agent definitions (AgentSchema)
  'tool',        // AI tool definitions (ToolSchema)
  'skill',       // AI skill definitions (SkillSchema)
]));

export type MetadataType = z.input<typeof MetadataTypeSchema>;

// ==========================================
// Type Registry Entry
// ==========================================

/**
 * Metadata Type Registry Entry
 *
 * Describes a registered metadata type, including its validation schema,
 * file patterns, and capabilities. Used by the metadata plugin to:
 * 1. Discover metadata files on disk
 * 2. Validate metadata payloads
 * 3. Determine storage behavior
 */
/**
 * Base shape of a metadata type registry entry, without invariants.
 * Used internally where Zod operations (`.omit`, `.extend`) that don't
 * compose with refinements are required.
 */
const MetadataTypeRegistryEntryBaseSchema = z.object({
  /** Metadata type identifier (e.g., 'object', 'view') */
  type: MetadataTypeSchema.describe('Metadata type identifier'),

  /** Human-readable label */
  label: z.string().describe('Display label for the metadata type'),

  /** Brief description */
  description: z.string().optional().describe('Description of the metadata type'),

  /**
   * File glob patterns for this type.
   * Used to discover metadata files on disk.
   * @example ["**\/*.object.ts", "**\/*.object.yml"]
   */
  filePatterns: z.array(z.string()).describe('Glob patterns to discover files of this type'),

  /**
   * Whether this type supports the customization overlay system.
   * When true, platform/user overlays can be applied on top of package-delivered metadata.
   */
  supportsOverlay: z.boolean().default(true).describe('Whether overlay customization is supported'),

  /**
   * Whether end-user organizations may write per-org overlay rows for this
   * type via the runtime metadata API (`PUT /api/v1/meta/:type/:name`).
   *
   * This is the **runtime opt-in gate** for ADR-0005 metadata customization.
   * `supportsOverlay` describes the *capability* (the loader can merge overlays);
   * `allowOrgOverride` is the explicit *permission* to actually accept writes
   * from a tenant. Defaults to `false` for safety — plugin authors must
   * deliberately opt in. The runtime returns HTTP 403 `not_overridable` when
   * a write targets a type with this flag unset.
   *
   * As of ADR-0005 Phase 1, only `view` and `dashboard` opt in.
   */
  allowOrgOverride: z.boolean().default(false).describe('Allow per-org overlay writes via runtime metadata API'),

  /**
   * Whether metadata of this type can be created at runtime via API.
   * Some types (e.g., 'object') may be restricted to deployment-only.
   */
  allowRuntimeCreate: z.boolean().default(true).describe('Allow runtime creation via API'),

  /**
   * Whether this type supports versioning.
   * When true, changes are tracked with version history.
   */
  supportsVersioning: z.boolean().default(false).describe('Whether version history is tracked'),

  /**
   * Whether runtime transaction rows pin a specific historical version of
   * this metadata by content hash (ADR-0009).
   *
   * Types with `executionPinned: true` give the strongest persistence
   * guarantee in the system:
   *
   * 1. History rows for this type are **never** garbage-collected,
   *    regardless of `MetadataHistoryRetentionPolicy`.
   * 2. `MetadataRepository.getByHash(ref, hash)` MUST return the
   *    pinned body for any hash that was ever HEAD.
   * 3. Implies `supportsVersioning: true` (enforced via superRefine on
   *    the wrapping `MetadataTypeRegistryEntrySchema`).
   *
   * Use this flag for metadata describing executable business processes
   * whose runtime invocations can pause across redeploys
   * (`flow`, `workflow`, `approval`). Do **not** set it for types whose
   * runtime state captures outputs rather than the source body
   * (`agent`, `tool`).
   */
  executionPinned: z.boolean().default(false).describe(
    'Transaction rows reference a specific version_hash; history GC is disabled and getByHash() MUST resolve old hashes (ADR-0009)'
  ),

  /**
   * Priority order for loading (lower = earlier).
   * Objects load before views, views before dashboards.
   */
  loadOrder: z.number().int().min(0).default(100).describe('Loading priority (lower = earlier)'),

  /** The domain this type belongs to */
  domain: z.enum(['data', 'ui', 'automation', 'system', 'security', 'ai'])
    .describe('Protocol domain'),

  /**
   * Declarative **type-level** actions for this metadata type.
   *
   * These are buttons the Studio metadata-admin engine renders for the type
   * as a whole (or for a single item of the type) — the same `ActionSchema`
   * business objects already use for row/header actions, reused verbatim so
   * there is no third button mechanism to learn.
   *
   * The canonical example is the `datasource` **Test connection** button: an
   * `ActionType: 'api'` action whose `url` calls the connection-probe
   * endpoint. Built-in types declare actions here; plugins layer additional
   * actions onto any type at runtime via `registerMetadataTypeActions()`
   * (the engine merges declarative + registered when emitting
   * `/api/v1/meta/types/:type`).
   *
   * Note: this is distinct from the per-record `actions` a business *object*
   * carries (`ObjectSchema.actions`) — those act on rows of a user object,
   * these act on definitions of a metadata type.
   */
  actions: z.array(ActionSchema).optional().describe(
    'Declarative type-level actions (e.g. datasource "Test connection"), reusing ActionSchema; merged with plugin-registered actions when emitted'
  ),
});

export const MetadataTypeRegistryEntrySchema = lazySchema(() =>
  MetadataTypeRegistryEntryBaseSchema.superRefine((entry, ctx) => {
    // ADR-0009 invariant: executionPinned ⇒ supportsVersioning.
    // A type whose transaction rows pin a historical body MUST also be
    // tracked in the history log, otherwise getByHash() has nothing to
    // resolve against.
    if (entry.executionPinned && !entry.supportsVersioning) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionPinned'],
        message: `executionPinned requires supportsVersioning: true (type '${entry.type}')`,
      });
    }
  })
);

export type MetadataTypeRegistryEntry = z.input<typeof MetadataTypeRegistryEntrySchema>;
/** Post-parse shape of {@link MetadataTypeRegistryEntry} — defaults applied, transforms run (ADR-0122). */
export type MetadataTypeRegistryEntryParsed = z.infer<typeof MetadataTypeRegistryEntrySchema>;

// ==========================================
// Metadata Query Protocol
// ==========================================

/**
 * Metadata Query Schema
 *
 * Standard protocol for searching and filtering metadata items.
 * Used by the metadata service to support advanced metadata discovery.
 */
export const MetadataQuerySchema = lazySchema(() => z.object({
  /** Filter by metadata type(s) */
  types: z.array(MetadataTypeSchema).optional().describe('Filter by metadata types'),

  /** Filter by namespace(s) */
  namespaces: z.array(z.string()).optional().describe('Filter by namespaces'),

  /** Filter by package ID */
  packageId: z.string().optional().describe('Filter by owning package'),

  /** Full-text search across name, label, description */
  search: z.string().optional().describe('Full-text search query'),

  /** Filter by scope */
  scope: z.enum(['system', 'platform', 'user']).optional().describe('Filter by scope'),

  /** Filter by state */
  state: z.enum(['draft', 'active', 'archived', 'deprecated']).optional().describe('Filter by lifecycle state'),

  /** Filter by tags */
  tags: z.array(z.string()).optional().describe('Filter by tags'),

  /** Sort field */
  sortBy: z.enum(['name', 'type', 'updatedAt', 'createdAt']).default('name').describe('Sort field'),

  /** Sort direction */
  sortOrder: z.enum(['asc', 'desc']).default('asc').describe('Sort direction'),

  /** Pagination: page number (1-based) */
  page: z.number().int().min(1).default(1).describe('Page number'),

  /** Pagination: items per page */
  pageSize: z.number().int().min(1).max(500).default(50).describe('Items per page'),
}));

export type MetadataQuery = z.input<typeof MetadataQuerySchema>;
/** Post-parse shape of {@link MetadataQuery} — defaults applied, transforms run (ADR-0122). */
export type MetadataQueryParsed = z.infer<typeof MetadataQuerySchema>;

/**
 * Metadata Query Result
 */
export const MetadataQueryResultSchema = lazySchema(() => z.object({
  /** Matched items */
  items: z.array(z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Item name'),
    namespace: z.string().optional().describe('Namespace'),
    label: z.string().optional().describe('Display label'),
    scope: z.enum(['system', 'platform', 'user']).optional(),
    state: z.enum(['draft', 'active', 'archived', 'deprecated']).optional(),
    packageId: z.string().optional(),
    updatedAt: z.string().datetime().optional(),
  })).describe('Matched metadata items'),

  /** Total count (for pagination) */
  total: z.number().int().min(0).describe('Total matching items'),

  /** Current page */
  page: z.number().int().min(1).describe('Current page'),

  /** Page size */
  pageSize: z.number().int().min(1).describe('Page size'),
}));

export type MetadataQueryResult = z.input<typeof MetadataQueryResultSchema>;

// ==========================================
// Metadata Lifecycle Events
// ==========================================
// v17 dual-source cleanup (#4587): the `MetadataEvent(Schema)` pair that
// lived here (a `metadata.registered/…/exported` lifecycle-event envelope)
// was removed. It was the #4411-family dead copy: zero importers outside its
// own unit test across framework/cloud/objectui, and NOTHING ever emitted
// its event vocabulary. The bare names now belong to `@objectstack/spec/api`
// alone (`src/api/events.zod.ts`) — the realtime metadata change feed
// (`metadata.{type}.{created|updated|deleted}`) that `MetadataManager`
// publishes and the client SDK (`@objectstack/client`) subscribes to.
// Runtime *watch* events remain `MetadataWatchEvent` in
// `@objectstack/spec/system`; repository change-log events are
// `@objectstack/metadata-core`'s own `MetadataEvent` (ADR-0008).

// ==========================================
// Metadata Validation
// ==========================================

/**
 * Metadata Validation Result
 */
export const MetadataValidationResultSchema = lazySchema(() => z.object({
  /** Whether validation passed */
  valid: z.boolean().describe('Whether the metadata is valid'),

  /** Validation errors */
  errors: z.array(z.object({
    path: z.string().describe('JSON path to the invalid field'),
    message: z.string().describe('Error description'),
    code: z.string().optional().describe('Error code'),
  })).optional().describe('Validation errors'),

  /** Validation warnings (non-blocking) */
  warnings: z.array(z.object({
    path: z.string().describe('JSON path to the field'),
    message: z.string().describe('Warning description'),
  })).optional().describe('Validation warnings'),
}));

export type MetadataValidationResult = z.input<typeof MetadataValidationResultSchema>;

// ==========================================
// Metadata Plugin Configuration
// ==========================================

/**
 * Metadata Plugin Configuration
 *
 * The unified configuration for the metadata plugin, combining
 * storage, caching, customization, and type registry settings.
 */
export const MetadataPluginConfigSchema = lazySchema(() => z.object({
  /**
   * Storage configuration.
   * References MetadataManagerConfigSchema for the underlying storage backend.
   */
  storage: MetadataManagerConfigSchema.describe('Storage backend configuration'),

  /**
   * Default customization policies per metadata type.
   * Controls what parts of metadata can be customized by admins/users.
   */
  customizationPolicies: z.array(CustomizationPolicySchema).optional()
    .describe('Default customization policies per type'),

  /**
   * Merge strategy for package upgrades.
   */
  mergeStrategy: MergeStrategyConfigSchema.optional()
    .describe('Merge strategy for package upgrades'),

  /**
   * Additional metadata type registrations.
   * Used by plugins to register custom metadata types beyond the built-in set.
   */
  additionalTypes: z.array(MetadataTypeRegistryEntryBaseSchema.omit({ type: true }).extend({
    type: z.string().describe('Custom metadata type identifier'),
  })).optional().describe('Additional custom metadata types'),

  /**
   * Enable metadata change events.
   * When true, the plugin emits events on every metadata change.
   */
  enableEvents: z.boolean().default(true).describe('Emit metadata change events'),

  /**
   * Enable metadata validation on write operations.
   * When true, all metadata is validated against its type schema before saving.
   */
  validateOnWrite: z.boolean().default(true).describe('Validate metadata on write'),

  /**
   * Enable metadata versioning.
   * When true, changes to metadata are tracked with version history.
   */
  enableVersioning: z.boolean().default(false).describe('Track metadata version history'),

  /**
   * Maximum number of metadata items to keep in memory cache.
   */
  cacheMaxItems: z.number().int().min(0).default(10000).describe('Max items in memory cache'),

  /**
   * Bootstrap Mode
   *
   * Controls how the MetadataPlugin populates the in-memory registry at
   * `start()` time. Tuning this is the single most effective lever for
   * cold-start latency in production.
   *
   * - `eager` (default) — Scan filesystem and prime every type listed in
   *   `DEFAULT_METADATA_TYPE_REGISTRY` via `loadMany()` for each type.
   *   Best DX (everything is queryable immediately) at the cost of cold-start
   *   I/O proportional to the number of metadata files. Recommended for dev,
   *   Studio sessions, and small/medium production deployments.
   *
   * - `lazy` — Skip the filesystem priming pass entirely. Metadata is loaded
   *   on first access through `MetadataManager.load()` / `loadMany()` and
   *   cached thereafter via the loader read-through cache. Best for
   *   long-running servers with thousands of items where only a hot subset
   *   is queried per request.
   *
   * - `artifact-only` — Load exclusively from the artifact source configured
   *   on the plugin (`artifactSource: { mode: 'local-file' }`; the `path` may
   *   be a filesystem path or an `http(s)` artifact URL).
   *   The filesystem is not scanned, and the database loader is not consulted
   *   during bootstrap. Required for Edge / serverless / immutable-image
   *   deployments where the running process must not perform write-back or
   *   open watch handles.
   */
  bootstrap: z.enum(['eager', 'lazy', 'artifact-only']).default('eager')
    .describe('How metadata is primed at plugin start (eager / lazy / artifact-only)'),
}));

export type MetadataPluginConfig = z.input<typeof MetadataPluginConfigSchema>;
/** Post-parse shape of {@link MetadataPluginConfig} — defaults applied, transforms run (ADR-0122). */
export type MetadataPluginConfigParsed = z.infer<typeof MetadataPluginConfigSchema>;

// ==========================================
// Metadata Plugin Manifest
// ==========================================

/**
 * Metadata Plugin Manifest
 *
 * The complete manifest for the Metadata Plugin, declaring its identity,
 * capabilities, and configuration. This is the "contract" between the
 * metadata plugin and the kernel.
 */
export const MetadataPluginManifestSchema = lazySchema(() => z.object({
  /** Plugin identifier */
  id: z.literal('com.objectstack.metadata').describe('Metadata plugin ID'),

  /** Plugin name */
  name: z.literal('ObjectStack Metadata Service').describe('Plugin name'),

  /** Plugin version */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).describe('Plugin version'),

  /** Plugin type */
  type: z.literal('standard').describe('Plugin type'),

  /** Plugin description */
  description: z.string().default('Core metadata management service for ObjectStack platform')
    .describe('Plugin description'),

  /**
   * Capabilities this plugin provides.
   * The kernel uses this to route metadata requests to this plugin.
   */
  capabilities: z.object({
    /** Supports CRUD operations on metadata */
    crud: z.boolean().default(true).describe('Supports metadata CRUD'),

    /** Supports metadata query/search */
    query: z.boolean().default(true).describe('Supports metadata query'),

    /** Supports the overlay/customization system */
    overlay: z.boolean().default(true).describe('Supports customization overlays'),

    /** Supports file watching for hot reload */
    watch: z.boolean().default(false).describe('Supports file watching'),

    /** Supports bulk import/export */
    importExport: z.boolean().default(true).describe('Supports import/export'),

    /** Supports metadata validation */
    validation: z.boolean().default(true).describe('Supports schema validation'),

    /** Supports metadata versioning */
    versioning: z.boolean().default(false).describe('Supports version history'),

    /** Supports metadata events */
    events: z.boolean().default(true).describe('Emits metadata events'),
  }).describe('Plugin capabilities'),

  /** Plugin configuration */
  config: MetadataPluginConfigSchema.optional().describe('Plugin configuration'),
}));

export type MetadataPluginManifest = z.input<typeof MetadataPluginManifestSchema>;
/** Post-parse shape of {@link MetadataPluginManifest} — defaults applied, transforms run (ADR-0122). */
export type MetadataPluginManifestParsed = z.infer<typeof MetadataPluginManifestSchema>;

// ==========================================
// Built-in Type Registry Defaults
// ==========================================

/**
 * Default Type Registry
 *
 * The built-in metadata type registry with default configurations.
 * Plugins extend this via `contributes.kinds` in the manifest.
 */
export const DEFAULT_METADATA_TYPE_REGISTRY: MetadataTypeRegistryEntryParsed[] = [
  // Data Protocol (load first)
  //
  // `object` and `field`: packaged items are LOCKED (`allowOrgOverride: false`).
  // Runtime API rejects overlay writes against artifact-backed objects/fields
  // with `403 not_overridable`. Tenants CAN create brand-new OBJECTS
  // (`allowRuntimeCreate: true`); `field` is the exception and the entry below
  // records why. Rationale: object schema = physical table
  // DDL; per-org overlay of packaged objects creates upgrade conflicts and
  // multi-tenant schema drift. New tenant-owned objects live in their own
  // namespace and are free to evolve. (Mirrors Salesforce: standard objects
  // are not modifiable per-org beyond layout/label; custom objects are full).
  { type: 'object', label: 'Object', filePatterns: ['**/*.object.ts', '**/*.object.yml', '**/*.object.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 10, domain: 'data' },
  // [#7893] `field` — the STANDALONE runtime-create door is RETIRED
  // (`allowRuntimeCreate: false`), maintainer ruling 2026-08-12.
  //
  // WHY THIS FLAG IS `false` (the decision this entry records):
  //
  // `field` is the one declared type with NO STANDALONE EXISTENCE. Fields are
  // authored INSIDE the object (`ObjectSchema.fields`, a `z.record(name,
  // FieldSchema)`), so a `field` write mints a SEPARATE `sys_metadata` row
  // keyed `('field', '<object>.<name>')` — and nothing composes fragment rows
  // into their parent. Measured end-to-end through the real `HttpDispatcher` →
  // `ObjectStackProtocolImplementation` → `SysMetadataRepository` (#7893):
  //
  //   PUT /api/v1/meta/field/showcase_task.zz_probe  -> 200, state=active,
  //       "Saved field 'showcase_task.zz_probe' (env-wide, state=active)"
  //   GET /api/v1/meta/object/showcase_task          -> fields = [title, status]
  //                                                     `zz_probe` ABSENT, forever
  //   GET /api/v1/meta/field/showcase_task.zz_probe  -> 200, _diagnostics.valid=true
  //
  // So the row is self-readable and well-formed, and reaches no object's
  // `fields` — therefore no ObjectQL query, no physical column, no consumer
  // that matters. Self-readable and universally inert. `allowRuntimeCreate:
  // true` declared a capability the platform never built: there is no
  // composition step, `applyRegistryWriteThrough` routes only
  // `type === 'object'`, and `filePatterns` (`**\/*.field.ts`) match nothing in
  // any app. ADR-0049 calls a declared-but-unhonoured capability false
  // compliance and requires enforce-or-remove; this is the remove side.
  //
  // ⚠️ THE READ SKIP IS NOT CAUSED BY `supportsOverlay: false`, and a fix that
  // "corrects" that flag is a REGRESSION. `supportsOverlay` gates no read path
  // at all — only `assertDeleteAllowed` consults it, so flipping it to `true`
  // changes nothing on the read and silently WIDENS the delete authorization
  // gate. The control that settles it is one line up: `object` carries the
  // IDENTICAL pair (`supportsOverlay: false, allowRuntimeCreate: true`) and a
  // runtime-created object is fully readable (measured: `GET
  // /meta/object/runtime_thing` -> `fields: ['note']`). Same flags, opposite
  // outcome, so the flag is not the cause — the missing composition step is.
  //
  // WHAT DOES NOT CHANGE, and why this is not a lost capability: adding a
  // field at runtime is a core Studio/CRM operation and it REMAINS possible —
  // through the object, which is where a field actually lives. `object` keeps
  // `allowRuntimeCreate: true`, so `PUT /api/v1/meta/object/<name>` with the
  // new field in `fields` both persists AND composes. What is withdrawn is a
  // second, broken SPELLING of that operation, not the operation. The refusal
  // says so: `codeOnlySourceHint` gives `field` the object-route prescription
  // rather than reading its `filePatterns` back (see the metadata-protocol
  // call site — the glob would name a file no loader has ever ingested).
  //
  // ⚠️ NOT borrowed from #5488 (`api`), whose mechanism this reuses but whose
  // JUSTIFICATION does not transfer: that ruling rested on "zero business pull
  // for Studio-authored runtime endpoints today", and "add a field" is the
  // opposite of zero-pull. The justification here is this card's own ruling and
  // the object route staying open, not an absence of demand.
  //
  // Options rejected, on the record: (1) BUILD the read path — a feature
  // spanning >= 3 packages (a composition step that does not exist, ~20
  // `gate.fields` call sites, physical schema/migrations, and cold boot via
  // `loadMetaFromDb`); a separate card if ever wanted, implementation first,
  // declaration second. (3) DOCUMENT it as inert — precisely the shape ADR-0049
  // forbids.
  //
  // ⚠️ `allowOrgOverride: false` is UNCHANGED and #7743's overlay refusal
  // STAYS: an artifact-backed field is still refused `403 NOT_OVERRIDABLE` via
  // `isNestedArtifactField`. Making field OVERRIDES legal is a separate
  // decision from making field CREATES work; this entry touches only the
  // create tier. `OS_METADATA_WRITABLE=field` remains the one operator escape
  // hatch, and `deleteMetaItem` is deliberately NOT gated by this refusal, so
  // repair of rows written through the retired channel stays possible.
  { type: 'field', label: 'Field', filePatterns: ['**/*.field.ts', '**/*.field.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 20, domain: 'data' },
  // ADR-0088 (#4509) — the `validation` kind is RETIRED. It failed the
  // admission test on its first clause: no independent lifecycle. A rule only
  // means anything against an object, and the only shape the engine evaluates
  // is `object.validations[]`; the standalone schema had no binding key to
  // name its object with (and, being `.strict()` in all six variants, could not
  // be given one by an author). Its `filePatterns` and `allowRuntimeCreate`
  // retire with it. Author rules as `validations:` on the object.
  { type: 'hook', label: 'Hook', filePatterns: ['**/*.hook.ts', '**/*.hook.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 30, domain: 'data' },
  // `seed`: fixture / initialization data (SeedSchema = object + records + mode +
  // externalId). Runtime-draftable so the AI (and any author) can stage seed
  // rows as a DRAFT (ADR-0033) and PUBLISH them like any other artifact;
  // publishing a seed draft is what actually loads the rows (runtime applies it
  // via SeedLoaderService — see runtime publish-drafts handler). loadOrder is
  // last in the data domain so every referenced object/field already exists.
  // NOTE: distinct from the (analytics-bound) `dataset` name — see ADR.
  { type: 'seed', label: 'Seed Data', description: 'Fixture / initialization data applied on publish', filePatterns: ['**/*.seed.ts', '**/*.seed.yml', '**/*.seed.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 95, domain: 'data' },
  // `mapping` (#2611, admitted per ADR-0088): reusable import/export field
  // mappings, consumed by the import endpoint via `mappingName`.
  // `allowRuntimeCreate: true` so the import wizard can SAVE a hand-built
  // mapping as a named artifact; packaged mappings stay locked
  // (`allowOrgOverride: false`) like every artifact-backed item.
  { type: 'mapping', label: 'Import Mapping', description: 'Reusable import/export field mapping (rename + transforms), referenced by name at import', filePatterns: ['**/*.mapping.ts', '**/*.mapping.yml', '**/*.mapping.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 96, domain: 'data' },

  // UI Protocol
  // `view/page/dashboard/action/report`: UI artifacts benefit from version
  // history (label says it all — admins iterate frequently, want to roll back).
  // `app`: tenants may author custom navigation apps (Salesforce Lightning App
  // parity), so `allowRuntimeCreate: true`.
  //
  // `allowOrgOverride` in this section is governed by ADR-0005's amendment
  // table (`docs/adr/0005-metadata-customization-overlay.md:53-64`), which
  // whitelists exactly `view`/`dashboard`/`report` ("Pure presentation. Safe
  // per-org override.") and says ❌ for `page`/`app`/`action` ("Conservative
  // default — these bind to routes and side-effects. Promote individually if
  // a concrete need appears."). `page`/`app`/`action`/`dataset` were ROLLED
  // BACK from an unratified `true` by the 2026-08-08 maintainer ruling on
  // #6483 (same verdict family as `flow`, #6283): no promotion ADR exists,
  // and no live org-scoped overlay rows were found in-repo. `dataset` is
  // absent from the table, so it takes the amendment's default for new types
  // — `allowOrgOverride: false` until an admission pair (overlay schema + a
  // WRITTEN render-only rationale) is ratified. Promotion of any of these is
  // an ADR-0005 revision, not a registry edit.
  //
  // NOT closed: `allowRuntimeCreate` stays `true` on all four — a tenant may
  // still author a BRAND-NEW page/app/action/dataset (the ADR-0005 two-tier
  // model); what is closed is per-org overlay of a PACKAGED item, now a loud
  // `403 not_overridable` at the write. ADR-0045's publish visibility flip
  // (`runtime/domains/packages.ts`) keeps working: it rewrites apps
  // MATERIALIZED into `sys_metadata` (DB-only provenance), which rides the
  // `allowRuntimeCreate` tier, not this flag.
  { type: 'view', label: 'View', filePatterns: ['**/*.view.ts', '**/*.view.yml', '**/*.view.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 50, domain: 'ui' },
  { type: 'page', label: 'Page', filePatterns: ['**/*.page.ts', '**/*.page.yml'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 50, domain: 'ui' },
  { type: 'dashboard', label: 'Dashboard', filePatterns: ['**/*.dashboard.ts', '**/*.dashboard.yml', '**/*.dashboard.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 60, domain: 'ui' },
  { type: 'app', label: 'Application', filePatterns: ['**/*.app.ts', '**/*.app.yml', '**/*.app.json'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 70, domain: 'ui' },
  // `action` was additionally the #6283 `flow` shape exactly: its own row
  // declares `supportsOverlay: false`, so `allowOrgOverride: true` granted a
  // write nothing could ever read back — the #6190 phantom. (ADR-0005, #6483)
  { type: 'action', label: 'Action', filePatterns: ['**/*.action.ts', '**/*.action.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 50, domain: 'ui' },
  { type: 'report', label: 'Report', filePatterns: ['**/*.report.ts', '**/*.report.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 60, domain: 'ui' },
  // ADR-0021: dataset is the analytics semantic layer that report/dashboard bind to.
  // loadOrder 55 < report/dashboard (60) so datasets register before their consumers.
  { type: 'dataset', label: 'Dataset', description: 'Analytics semantic layer — dimensions & measures', filePatterns: ['**/*.dataset.ts', '**/*.dataset.yml', '**/*.dataset.json'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 55, domain: 'ui' },

  // Automation Protocol — flow is executionPinned (ADR-0009).
  // ADR-0019: there is no `approval` metadata type — approvals are Approval
  // nodes inside a `flow`, so they load and version with their enclosing flow.
  // ADR-0020: there is no `workflow` metadata type — record state machines are
  // a `state_machine` validation rule on the object, not a standalone artifact.
  //
  // `allowOrgOverride: false` — ROLLED BACK from `true` (#6283, settling the
  // contract half of #6155 Q1=B; the unreviewed flip itself is recorded in
  // #6191, commit ba252da0b). ADR-0005's amendment table
  // (`docs/adr/0005-metadata-customization-overlay.md:57`) has never said
  // anything else about this row:
  //
  //   | automation | `flow`, `workflow`, `approval` | ❌ | Carry execution
  //   | side-effects (events, jobs, audit). Per-org variants are a deployment,
  //   | not an overlay. |
  //
  // That ADR is what `OVERLAY_ALLOWED_TYPES` derives from (Prime Directive #8),
  // so `true` here was the registry contradicting the document it is supposed
  // to be the machine-readable form of — and contradicting its OWN row, which
  // declares `supportsOverlay: false`: the loader cannot merge a per-org flow
  // overlay, so the write permission granted a write nothing could ever read
  // back. #6190 measured exactly that phantom: an org-scoped flow overlay wrote
  // successfully and lost its binding on the next cold start. Rolling the flag
  // back turns that silent phantom into a loud `403 not_overridable` at the
  // moment of the write.
  //
  // NOT closed by this flag: `allowRuntimeCreate` stays `true`, so a tenant may
  // still author a BRAND-NEW flow through the runtime API (the two-tier model —
  // that write overlays no code-shipped automation and is what ADR-0005 means by
  // "a deployment"). What is closed is overlaying a PACKAGED flow per org.
  { type: 'flow', label: 'Flow', filePatterns: ['**/*.flow.ts', '**/*.flow.yml', '**/*.flow.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: true, loadOrder: 80, domain: 'automation' },
  // `job`: A JOB IS A CODE ARTIFACT, and the flags now say so (#4509).
  //
  // `JobSchema.handler` is the name of a function in the compiled bundle's
  // function table — the schema says as much ("must match a key in
  // `defineStack({ functions })`"), and the scheduler is built that way:
  // `AppPlugin` sources jobs from `bundle.jobs` alone and resolves each
  // `handler` through `collectBundleFunctions(bundle)`, skipping any job whose
  // handler is not in that table (packages/runtime/src/app-plugin.ts).
  //
  // So a job created at runtime, or overlaid per-org, could never be scheduled
  // — not "is not yet scheduled", but CANNOT BE: its handler names a function
  // that exists only inside a bundle the runtime writer never had. Both doors
  // led to metadata that parses, saves, and never runs. Under ADR-0049
  // enforce-or-remove that is not a state to leave standing, and there is
  // nothing here to enforce: the missing piece is not a bridge but a
  // handler-binding design.
  //
  // Hence allowRuntimeCreate:false (no "create job" in Studio / PUT /meta) and
  // allowOrgOverride:false (no per-org job fork). Unlike `agent`, which is
  // closed to third-party AUTHORING entirely (ADR-0063 §2), `job` stays a
  // first-class authorable type: `*.job.ts` and `defineStack({ jobs })` are the
  // supported doors, and they work — the file loader is genuinely consumed, so
  // the kind still passes the ADR-0088 admission test and stays registered.
  //
  // Consequence that looks like a bug and is not: `migrateStoredMetadata`
  // reports runtime-authored `job` rows `skipped` (no governed write path), the
  // same way it does for `agent`. Rows already in `sys_metadata` are left
  // alone; they were never scheduled, so nothing changes behaviorally.
  //
  // Re-opening this type means designing a handler a runtime writer can
  // actually name — e.g. constraining `handler` to an already-registered flow
  // or a named, separately-governed function — and then building the bridge
  // from job metadata to `IJobService.schedule`. Opening the flag without that
  // work just restores the silent no-op.
  { type: 'job', label: 'Background Job', filePatterns: ['**/*.job.ts', '**/*.job.yml', '**/*.job.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 80, domain: 'automation' },

  // System Protocol
  // `datasource`: runtime-creatable (ADR-0015 Addendum) — the Studio wizard
  // persists `origin: 'runtime'` datasources into the runtime metadata store.
  // Code-defined (`origin: 'code'`) datasources remain read-only and win on
  // name collision; record-level read-only gating is enforced by origin, not
  // by this flag. No per-org overlay (a datasource = one physical connection).
  {
    type: 'datasource',
    label: 'Datasource',
    filePatterns: ['**/*.datasource.ts', '**/*.datasource.yml'],
    supportsOverlay: false,
    allowOrgOverride: false,
    allowRuntimeCreate: true,
    supportsVersioning: false,
    executionPinned: false,
    loadOrder: 5,
    domain: 'system',
    // No declarative type-level action here. The metadata-admin
    // "Test connection" button (GAP 1) is contributed at runtime by the
    // datasource-admin backend plugin via `registerMetadataTypeActions`,
    // co-located with the route handler it calls
    // (`POST /api/v1/datasources/:name/test`). That keeps the open-source
    // framework from advertising a button whose backend it doesn't ship:
    // the button is emitted iff the plugin that serves it is installed.
  },
  // RUNTIME-CREATED (ADR-0062/0088): produced by the datasource Sync wizard —
  // a derived snapshot; packages never ship one (it would be stale on arrival).
  { type: 'external_catalog', label: 'External Catalog', filePatterns: ['**/*.external-catalog.ts', '**/*.external-catalog.yml', '**/*.external-catalog.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 6, domain: 'system' },
  // [#5271, part of #5206] `api` — declarative HTTP endpoints (ADR-0121).
  //
  // WHY THE FLAGS ARE THESE VALUES (the decision this entry records):
  //
  // ⚠️ RECORDED OVERTURN — 2026-08-09 (#5488). The block below used to record a
  // decision for `allowRuntimeCreate: true`, and the three bullets it rested on
  // are reproduced verbatim further down because they were not wrong about the
  // mechanism — they were wrong about the PREMISE they all shared. That premise
  // ("there is a runtime create door here worth validating") was disproven by a
  // real boot: `PUT /api/v1/meta/api/:name` answered 200 "Saved", and the
  // endpoint was then NEVER SERVED — `GET` on its declared path 404s forever,
  // with no `[EndpointMatcher] … EXCLUDED` line, because it was not gated out,
  // it was never in the index at all. The serving criterion is owned by
  // `IMetadataService.matchEndpoint` → `EndpointMatcher` →
  // `MetadataManager.listForIndex('api')`, which reads the manager's `registry`
  // plus its registered loaders (`["filesystem","memory"]`); a runtime write
  // lands in `sys_metadata`, which is in neither. So `allowRuntimeCreate: true`
  // declared a capability the runtime never had.
  //
  // The maintainer ruled on it 2026-08-07T16:59Z, verbatim:
  //
  //   "Decision: Option B — flip the `api` registry entry to
  //    `allowRuntimeCreate: false` and make the write inlet reject loudly
  //    (the existing #5086 mechanism). ADR-0049 remove side, with the
  //    corresponding retirement bookkeeping. […] Re-entry path recorded: if
  //    #2657 Part B ever promotes `apis` to a registered type with a real
  //    consumption path, re-enable then — implementation first, declaration
  //    second."
  //
  // Rationale as ruled: zero business pull for Studio-authored runtime
  // endpoints today (17.x declarative endpoints are served via stack artifacts
  // / `publishPackage`, which is untouched); making the matcher read
  // `sys_metadata` instead would re-open cache, invalidation, tenancy and the
  // ADR-0110 D3 miss-vs-outage semantics on a new read path — not a cost to pay
  // without pull; and a write that answers "Saved" and then 404s forever is the
  // most dangerous silent-lie shape for AI authors (ADR-0049 false compliance).
  //
  // WHAT THE THREE ORIGINAL BULLETS SAID, and what became of each — kept
  // verbatim so the overturn is auditable rather than silently rewritten:
  //   • "it would REMOVE a door rather than validate one, turning today's 200
  //     into a 403 for every runtime author, which is a contract change no
  //     issue in this chain asked for" — TRUE, and now deliberate: #5488 is the
  //     issue that asked for it, and the door being removed opened onto nothing.
  //     A 403 that names the artifact route is strictly better than a 200 whose
  //     route 404s.
  //   • "#5086 (PR #5263) refuses code-only types BEFORE persistence, draft and
  //     active alike — so `api` DRAFTS would become impossible, and #5206's
  //     step 2 (the `publishPackageDrafts` endpoint gate, PR #5279) would have
  //     nothing left to gate" — MECHANICALLY CORRECT, and it is why the flip
  //     could not be split spec-first. `gateApiDraftsForPublish` is therefore
  //     retired in the SAME change (#5488), deliberately and on the record: it
  //     gated a promotion into a state the matcher can never read.
  //   • "ADR-0121's ruling is 'publish REJECTS' with a named-key prescription
  //     (D1/D2/D6), which presupposes an author who could write the draft.
  //     'Rejected at publish' is not 'refused at authoring'." — STILL TRUE of
  //     ADR-0121, and unaffected: the publish gates
  //     (`validateApiEndpointDeclarations`) remain the one judge of servability
  //     on the route that actually serves — the stack artifact / `publishPackage`
  //     path. What is withdrawn is only the runtime-authored draft, which had no
  //     servable destination to be judged toward.
  //
  // `allowRuntimeCreate: false` + `allowOrgOverride: false` therefore makes
  // `api` CODE-ONLY (the `job` / `agent` / `capability` shape): the #5086 inlet
  // refuses `PUT /api/v1/meta/api/:name` before persistence, on every kernel,
  // in draft mode as well as active, with `code: 'NOT_CREATABLE'`, `status: 403`
  // and a prescription naming this entry's own `filePatterns[0]`
  // (`**/*.api.ts`) — i.e. declare the endpoint in the stack artifact and ship
  // it through `publishPackage`. `OS_METADATA_WRITABLE` remains the one
  // operator escape hatch, unchanged.
  //
  // `allowOrgOverride: false` (also unchanged from today's effective value): an
  // endpoint is an OUTWARD URL contract owned by the declaring package. A
  // per-org fork could move `path`, flip `authRequired` or drop `rateLimit` on
  // the publisher's own URL, and ADR-0005 defaults this flag to false precisely
  // so that opt-in is deliberate. Same posture as `datasource`.
  //
  // `supportsOverlay: false` — there is no merge semantic for an endpoint;
  // `executionPinned: false` — an endpoint DELEGATES (ADR-0121 D5), and the
  // pinned artifact is the target `flow`, which carries `executionPinned: true`
  // itself. `loadOrder: 92` is after `flow` (80), so a flow-typed endpoint's
  // target already exists when the endpoint registers.
  //
  // ⚠️ The registry is the authority on WHO MAY WRITE; it is not the endpoint
  // publish gate. `validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure`
  // (`api/endpoint-publish-gate.ts`) remain the ONE judge of what is servable —
  // run at publish (stack schema, `publishPackage`, `publishPackageDrafts`) and
  // again at load (`buildEndpointIndex`). This entry adds a SHAPE check in
  // front of them, never a second opinion about servability.
  { type: 'api', label: 'API Endpoint', description: 'Declarative HTTP endpoint — a stable URL and policy layer over an existing pipeline (ADR-0121)', filePatterns: ['**/*.api.ts', '**/*.api.yml', '**/*.api.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 92, domain: 'system' },
  { type: 'translation', label: 'Translation', filePatterns: ['**/*.translation.ts', '**/*.translation.yml', '**/*.translation.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 90, domain: 'system' },
  { type: 'email_template', label: 'Email Template', filePatterns: ['**/*.email-template.ts', '**/*.email-template.yml', '**/*.email-template.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 85, domain: 'system' },
  // ADR-0046: package documentation. Inert data — no runtime behavior, no
  // overlay (a manual is the publisher's voice; tenants don't patch it).
  // Runtime-creatable so AI/authors can draft docs via saveMetaItem
  // (ADR-0033). Collected from flat `src/docs/*.md` by the CLI; the kernel
  // never parses `content`. loadOrder is last: nothing references docs.
  { type: 'doc', label: 'Documentation', description: 'Package documentation — flat Markdown items (ADR-0046)', filePatterns: ['**/docs/*.md'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 99, domain: 'system' },
  // Navigation spine over docs (ADR-0046 §6): ordered groups, membership derived
  // by rule. Overlay-mergeable at read (`supportsOverlay: true`); runtime-
  // creatable for AI/authors. loadOrder last (references docs).
  //
  // `allowOrgOverride: false` — ROLLED BACK from an unratified `true` (#6483,
  // ADR-0005). The "render-time like view/dashboard" argument that used to
  // sit here is only half of ADR-0005's admission pair; the WRITTEN
  // render-only rationale ratified into the whitelist table was never filed,
  // and `book` appears nowhere in that table, so it takes the amendment's
  // default for absentees: `false` until promoted by an ADR-0005 revision.
  // Zero live org-scoped book overlay rows in-repo at rollback. Studio's
  // drag-edit of a PACKAGED book now answers `403 not_overridable`;
  // authoring a BRAND-NEW book keeps working (`allowRuntimeCreate`).
  { type: 'book', label: 'Documentation Book', description: 'Documentation navigation spine — ordered groups with derived membership (ADR-0046 §6)', filePatterns: ['**/*.book.ts'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 99, domain: 'system' },

  // Security Protocol
  //
  // `permission` / `position`: `allowOrgOverride: false` — ROLLED BACK from
  // an unratified `true` (#6483, 2026-08-08 maintainer ruling; same verdict
  // family as `flow`, #6283). ADR-0005's security row says ❌ outright:
  // "Authorization correctness; overlays would create silent privilege
  // drift" — a per-org overlay of a packaged permission set IS that drift,
  // definitionally. `position` is absent from the ADR's table and takes the
  // amendment's `false` default for new types. Zero live org-scoped overlay
  // rows for either type in-repo at rollback.
  //
  // Blast radius, measured while landing #6483: plugin-security's ADR-0094
  // write-through (`permission-set-projection.ts`) routes data-door edits of
  // permission sets into `saveMetaItem`. Runtime-created sets — including
  // package-bound rows MATERIALIZED through the metadata door, whose
  // provenance is `sys_metadata`, not an artifact — ride `allowRuntimeCreate`
  // (still `true`) and keep working; a data-door edit of a CODE-DECLARED
  // (artifact-backed) set now refuses with 403 — the same refusal that
  // write-through already issues on kernels without an overlay layer
  // (ADR-0086 two-doors: edit the package and re-publish). If
  // ADR-0094's "customize packaged sets via env overlay" direction
  // (2026-07-14) is to be restored, that is an ADR-0005 whitelist revision —
  // file it there; do not flip this flag back ad hoc.
  { type: 'permission', label: 'Permission Set', filePatterns: ['**/*.permission.ts', '**/*.permission.yml'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 15, domain: 'security' },
  { type: 'position', label: 'Position', filePatterns: ['**/*.position.ts', '**/*.position.yml'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 15, domain: 'security' },
  // [#5961] Package-declared authorization capabilities (ADR-0066 D1).
  //
  // ⛔ CODE-ONLY, and that is the whole point of the entry. ADR-0066 D1 says
  // packages DEFINE capabilities — `defineCapability` on a stack's
  // `capabilities[]`, or a `*.capability.ts` file the loader globs — while
  // permission sets GRANT them and resources REQUIRE them. An administrator
  // minting a brand-new capability at runtime has no counterpart in that
  // three-way separation: nothing in code would ever require the name, so the
  // row would be an unreferenced grant target sitting in the SAME namespace
  // `systemPermissions` / `requiredPermissions` resolve by string. Hence
  // `allowRuntimeCreate: false` AND `allowOrgOverride: false`, which together
  // are #5086's code-only declaration — `saveMetaItem` refuses
  // `PUT /api/v1/meta/capability/:name` with 403 `not_creatable` on EVERY
  // kernel, and `codeOnlySourceHint` reads `filePatterns[0]` back to tell the
  // author where to declare it instead. `job` (#4509) and `agent` (ADR-0063 §2)
  // carry the same pair for the same reason.
  //
  // The package-declaration channel is untouched: `AppPlugin` registers stack
  // `capabilities[]` through `registerInMemory`, and the filesystem loader
  // globs `filePatterns` — neither goes through `saveMetaItem`, so
  // `bootstrapDeclaredCapabilities` still seeds `sys_capability` exactly as
  // before. `OS_METADATA_WRITABLE=capability` remains the ONE documented
  // operator escape hatch (ADR-0005), and behind it the write is now judged by
  // `CapabilityDeclarationSchema` (422) instead of being stored unvalidated.
  //
  // `supportsOverlay: false` — a capability is a name, label and scope; there
  // is no merge semantic, and letting a tenant overlay a package-shipped
  // declaration would let it re-scope `org` → `platform`.
  // `loadOrder: 12` — before `permission`/`position` (15), so a set's
  // `systemPermissions` resolves against capabilities that already exist.
  { type: 'capability', label: 'Capability', description: 'Package-declared authorization capability — the DEFINITION side of ADR-0066 D1 (grants live on permission sets; requirements on resources)', filePatterns: ['**/*.capability.ts', '**/*.capability.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 12, domain: 'security' },

  // AI Protocol
  // `agent`: executionPinned — long-running conversations must stick to the
  // agent version (prompt template + tool set) they started under.
  // (Mirrors OpenAI Assistants v2 / Anthropic Messages assistant pinning.)
  //
  // ADR-0063 §2 — `*.agent.ts` is CLOSED to third parties. The kernel ships
  // exactly two platform-owned agents (`ask`/`build`); tenants extend the
  // platform by authoring skills + tools, never agents. Hence
  // allowRuntimeCreate:false (no runtime "create agent") and
  // allowOrgOverride:false (no per-org agent fork). The runtime catalog
  // additionally filters out any non-platform agent record (see service-ai).
  //
  // FOR AGENTS, THE CODE IS THE RECORD — and that is the whole answer to
  // "where is this type's change log?" (#4507). Because the two flags above
  // are false, `agent` is code-only, and `saveMetaItem` REFUSES it outright
  // on every kernel with a 403 (#5086): `NOT_OVERRIDABLE` when the name is
  // already artifact-backed, `NOT_CREATABLE` otherwise. So the type has no
  // governed write path at all — not a dormant one. (Until #5264 the refusal
  // was followed by a legacy raw-engine branch that nothing reached; it has
  // since been deleted, so there is no second door to describe.) The rows,
  // being unwritable through the metadata API, are written by the shipping
  // plugin at boot — `AIStudioPlugin.registerMeta` → `metadataService
  // .register()` → `MetadataManager.register` → `DatabaseLoader.save` —
  // which writes `sys_metadata` directly with a fresh checksum and appends
  // NO `sys_metadata_history` row. So an agent definition that changes
  // between releases leaves no metadata-side change log, and there is no
  // metadata-side rollback.
  //
  // That is accepted, not overlooked. These definitions live in version
  // control (`@objectstack/service-ai-studio`, `cloud` repo:
  // `agents/ask-agent.ts`, `agents/metadata-assistant-agent.ts`), so git
  // already holds the full, reviewable history of every change. A second
  // history in `sys_metadata` would be a WORSE record, not a better one: it
  // would capture only the boots where a given deployment happened to see
  // the checksum move, so two deployments on the same release would carry
  // different "histories" of an identical, code-fixed definition. Do not add
  // one to close a perceived gap.
  //
  // Two consequences that look like bugs and are not:
  //  - `migrateStoredMetadata` reports `agent` rows `skipped` ("no repository
  //    write path"). That is CORRECT AND PERMANENT for this type, not a
  //    to-do — the pass declines rather than performing a historyless
  //    rewrite that could also promote a draft.
  //  - Studio surfaces no History tab for an agent. There is nothing to show;
  //    the answer to "what changed" is the `cloud` commit log.
  //
  // If `agent` is ever OPENED to tenant authoring, this note stops applying:
  // an author-owned definition has no git to fall back on, so opening the
  // type and giving it a real history path are the same piece of work.
  { type: 'agent', label: 'AI Agent', filePatterns: ['**/*.agent.ts', '**/*.agent.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: true, executionPinned: true, loadOrder: 90, domain: 'ai' },
  // `tool` / `skill`: `allowOrgOverride: false` — ROLLED BACK from an
  // unratified `true` (#6483, 2026-08-08 maintainer ruling). ADR-0005's ai
  // row says ❌: "Behavioural contracts with model providers; treat like
  // flows" — and `flow` itself was rolled back by #6283 on that very row.
  // ADR-0063 §2's model (tenants extend the platform by AUTHORING skills +
  // tools) is the `allowRuntimeCreate: true` tier, which stays open; what
  // closes is per-org overlay of a PACKAGE-SHIPPED tool/skill, now a loud
  // `403 not_overridable`. Zero live org-scoped overlay rows for either
  // type in-repo at rollback; zero production write sites found.
  { type: 'tool', label: 'AI Tool', filePatterns: ['**/*.tool.ts', '**/*.tool.yml'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 85, domain: 'ai' },
  { type: 'skill', label: 'AI Skill', filePatterns: ['**/*.skill.ts', '**/*.skill.yml'], supportsOverlay: true, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 88, domain: 'ai' },
];

// ==========================================
// Bulk Operation Types
// ==========================================
// v17 dual-source cleanup (#4587): `MetadataBulkRegisterRequest(Schema)`
// was removed from this module. It was a dead copy of the REST request
// contract — zero importers outside its own unit test across
// framework/cloud/objectui — and it diverged from the enforced write path:
// its per-item `namespace` field exists nowhere in
// `IMetadataService.bulkRegister` (contracts) or
// `MetadataManager.bulkRegister`, and `namespace` is deprecated repo-wide
// (Prime Directive #6). The bare names now belong to
// `@objectstack/spec/api` alone (`src/api/metadata.zod.ts` — the
// POST /api/meta/bulk/register contract, whose item shape
// `{type, name, data}` matches what the runtime actually accepts).
// `MetadataBulkResultSchema` below stays: it is the live result type
// consumed by `@objectstack/metadata` and re-exported by ./api responses.

/**
 * Bulk Operation Result
 */
export const MetadataBulkResultSchema = lazySchema(() => z.object({
  /** Total items processed */
  total: z.number().int().min(0).describe('Total items processed'),

  /** Successfully processed items */
  succeeded: z.number().int().min(0).describe('Successfully processed'),

  /** Failed items */
  failed: z.number().int().min(0).describe('Failed items'),

  /** Per-item error details */
  errors: z.array(z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Item name'),
    error: z.string().describe('Error message'),
  })).optional().describe('Per-item errors'),
}));

export type MetadataBulkResult = z.input<typeof MetadataBulkResultSchema>;

// ==========================================
// Metadata Dependency
// ==========================================

/**
 * Metadata Dependency Schema
 *
 * Tracks dependencies between metadata items.
 * Used for impact analysis and safe deletion checks.
 */
export const MetadataDependencySchema = lazySchema(() => z.object({
  /** Source metadata type */
  sourceType: z.string().describe('Dependent metadata type'),

  /** Source metadata name */
  sourceName: z.string().describe('Dependent metadata name'),

  /** Target metadata type */
  targetType: z.string().describe('Referenced metadata type'),

  /** Target metadata name */
  targetName: z.string().describe('Referenced metadata name'),

  /** Dependency kind */
  kind: z.enum(['reference', 'extends', 'includes', 'triggers'])
    .describe('How the dependency is formed'),
}));

export type MetadataDependency = z.input<typeof MetadataDependencySchema>;
