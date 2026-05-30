// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { MetadataManagerConfigSchema } from './metadata-loader.zod';
import { MergeStrategyConfigSchema, CustomizationPolicySchema } from './metadata-customization.zod';

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
 * - kernel/metadata-loader.zod.ts — Storage backend protocol
 * - kernel/metadata-customization.zod.ts — Overlay/merge protocol
 * - system/metadata-persistence.zod.ts — Database record format
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
  'trigger',     // Data-layer event triggers (TriggerSchema)
  'validation',  // Validation rules (ValidationSchema)
  'hook',        // Data hooks (HookSchema)

  // UI Protocol
  'view',        // List/form views (ViewSchema)
  'page',        // Standalone pages (PageSchema)
  'dashboard',   // Dashboard layouts (DashboardSchema)
  'app',         // Application shell (AppSchema)
  'action',      // UI/Server actions (ActionSchema)
  'report',      // Report definitions (ReportSchema)

  // Automation Protocol
  'flow',        // Visual logic flows (FlowSchema)
  'workflow',    // State machines (WorkflowSchema)
  'approval',    // Approval processes (ApprovalSchema)
  'job',         // Background / scheduled jobs (JobSchema)

  // System Protocol
  'datasource',  // Data connections (DatasourceSchema)
  'external_catalog', // Cached remote schema snapshot for federated datasources (ADR-0015)
  'translation', // i18n resources (TranslationSchema)
  'router',      // API routes
  'function',    // Serverless functions
  'service',     // Service definitions
  'email_template', // Outbound email templates (EmailTemplateSchema)

  // Security Protocol
  'permission',  // Permission sets (PermissionSetSchema)
  'profile',     // User profiles (ProfileSchema)
  'role',        // Security roles

  // AI Protocol
  'agent',       // AI agent definitions (AgentSchema)
  'tool',        // AI tool definitions (ToolSchema)
  'skill',       // AI skill definitions (SkillSchema)
]));

export type MetadataType = z.infer<typeof MetadataTypeSchema>;

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

export type MetadataTypeRegistryEntry = z.infer<typeof MetadataTypeRegistryEntrySchema>;

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

export type MetadataQueryResult = z.infer<typeof MetadataQueryResultSchema>;

// ==========================================
// Metadata Lifecycle Events
// ==========================================

/**
 * Metadata Event Schema
 *
 * Events emitted by the metadata plugin when metadata changes.
 * Enables reactive patterns across the platform (cache invalidation,
 * UI refresh, dependency tracking, etc.).
 */
export const MetadataEventSchema = lazySchema(() => z.object({
  /** Event type */
  event: z.enum([
    'metadata.registered',
    'metadata.updated',
    'metadata.unregistered',
    'metadata.validated',
    'metadata.deployed',
    'metadata.overlay.applied',
    'metadata.overlay.removed',
    'metadata.imported',
    'metadata.exported',
  ]).describe('Event type'),

  /** Metadata type */
  metadataType: MetadataTypeSchema.describe('Metadata type'),

  /** Item name */
  name: z.string().describe('Metadata item name'),

  /** Namespace */
  namespace: z.string().optional().describe('Namespace'),

  /** Package ID (if package-managed) */
  packageId: z.string().optional().describe('Owning package ID'),

  /** Timestamp */
  timestamp: z.string().datetime().describe('Event timestamp'),

  /** Actor who caused the event */
  actor: z.string().optional().describe('User or system that triggered the event'),

  /** Additional event-specific payload */
  payload: z.record(z.string(), z.unknown()).optional().describe('Event-specific payload'),
}));

export type MetadataEvent = z.infer<typeof MetadataEventSchema>;

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

export type MetadataValidationResult = z.infer<typeof MetadataValidationResultSchema>;

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
   *   on the plugin (`artifactSource: { mode: 'local-file' | 'artifact-api' }`).
   *   The filesystem is not scanned, and the database loader is not consulted
   *   during bootstrap. Required for Edge / serverless / immutable-image
   *   deployments where the running process must not perform write-back or
   *   open watch handles.
   */
  bootstrap: z.enum(['eager', 'lazy', 'artifact-only']).default('eager')
    .describe('How metadata is primed at plugin start (eager / lazy / artifact-only)'),
}));

export type MetadataPluginConfig = z.input<typeof MetadataPluginConfigSchema>;

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

// ==========================================
// Built-in Type Registry Defaults
// ==========================================

/**
 * Default Type Registry
 *
 * The built-in metadata type registry with default configurations.
 * Plugins extend this via `contributes.kinds` in the manifest.
 */
export const DEFAULT_METADATA_TYPE_REGISTRY: MetadataTypeRegistryEntry[] = [
  // Data Protocol (load first)
  //
  // `object` and `field`: packaged items are LOCKED (`allowOrgOverride: false`).
  // Runtime API rejects overlay writes against artifact-backed objects/fields
  // with `403 not_overridable`. Tenants CAN create brand-new objects/fields
  // (`allowRuntimeCreate: true`). Rationale: object schema = physical table
  // DDL; per-org overlay of packaged objects creates upgrade conflicts and
  // multi-tenant schema drift. New tenant-owned objects live in their own
  // namespace and are free to evolve. (Mirrors Salesforce: standard objects
  // are not modifiable per-org beyond layout/label; custom objects are full).
  { type: 'object', label: 'Object', filePatterns: ['**/*.object.ts', '**/*.object.yml', '**/*.object.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 10, domain: 'data' },
  { type: 'field', label: 'Field', filePatterns: ['**/*.field.ts', '**/*.field.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 20, domain: 'data' },
  { type: 'trigger', label: 'Trigger', filePatterns: ['**/*.trigger.ts', '**/*.trigger.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 30, domain: 'data' },
  { type: 'validation', label: 'Validation Rule', filePatterns: ['**/*.validation.ts', '**/*.validation.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 30, domain: 'data' },
  { type: 'hook', label: 'Hook', filePatterns: ['**/*.hook.ts', '**/*.hook.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 30, domain: 'data' },

  // UI Protocol
  // `view/page/dashboard/action/report`: UI artifacts benefit from version
  // history (label says it all — admins iterate frequently, want to roll back).
  // `app`: tenants may author custom navigation apps (Salesforce Lightning App
  // parity), so `allowRuntimeCreate: true`.
  { type: 'view', label: 'View', filePatterns: ['**/*.view.ts', '**/*.view.yml', '**/*.view.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 50, domain: 'ui' },
  { type: 'page', label: 'Page', filePatterns: ['**/*.page.ts', '**/*.page.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 50, domain: 'ui' },
  { type: 'dashboard', label: 'Dashboard', filePatterns: ['**/*.dashboard.ts', '**/*.dashboard.yml', '**/*.dashboard.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 60, domain: 'ui' },
  { type: 'app', label: 'Application', filePatterns: ['**/*.app.ts', '**/*.app.yml', '**/*.app.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 70, domain: 'ui' },
  { type: 'action', label: 'Action', filePatterns: ['**/*.action.ts', '**/*.action.yml'], supportsOverlay: false, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 50, domain: 'ui' },
  { type: 'report', label: 'Report', filePatterns: ['**/*.report.ts', '**/*.report.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 60, domain: 'ui' },

  // Automation Protocol — flow/workflow/approval are executionPinned (ADR-0009)
  { type: 'flow', label: 'Flow', filePatterns: ['**/*.flow.ts', '**/*.flow.yml', '**/*.flow.json'], supportsOverlay: false, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: true, loadOrder: 80, domain: 'automation' },
  { type: 'workflow', label: 'Workflow', filePatterns: ['**/*.workflow.ts', '**/*.workflow.yml'], supportsOverlay: false, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: true, loadOrder: 80, domain: 'automation' },
  { type: 'approval', label: 'Approval Process', filePatterns: ['**/*.approval.ts', '**/*.approval.yml'], supportsOverlay: false, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: true, loadOrder: 80, domain: 'automation' },
  { type: 'job', label: 'Background Job', filePatterns: ['**/*.job.ts', '**/*.job.yml', '**/*.job.json'], supportsOverlay: false, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 80, domain: 'automation' },

  // System Protocol
  { type: 'datasource', label: 'Datasource', filePatterns: ['**/*.datasource.ts', '**/*.datasource.yml'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 5, domain: 'system' },
  { type: 'external_catalog', label: 'External Catalog', filePatterns: ['**/*.external-catalog.ts', '**/*.external-catalog.yml', '**/*.external-catalog.json'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 6, domain: 'system' },
  { type: 'translation', label: 'Translation', filePatterns: ['**/*.translation.ts', '**/*.translation.yml', '**/*.translation.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 90, domain: 'system' },
  { type: 'router', label: 'Router', filePatterns: ['**/*.router.ts'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 40, domain: 'system' },
  { type: 'function', label: 'Function', filePatterns: ['**/*.function.ts'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 40, domain: 'system' },
  { type: 'service', label: 'Service', filePatterns: ['**/*.service.ts'], supportsOverlay: false, allowOrgOverride: false, allowRuntimeCreate: false, supportsVersioning: false, executionPinned: false, loadOrder: 40, domain: 'system' },
  { type: 'email_template', label: 'Email Template', filePatterns: ['**/*.email-template.ts', '**/*.email-template.yml', '**/*.email-template.json'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 85, domain: 'system' },

  // Security Protocol
  { type: 'permission', label: 'Permission Set', filePatterns: ['**/*.permission.ts', '**/*.permission.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: false, loadOrder: 15, domain: 'security' },
  { type: 'profile', label: 'Profile', filePatterns: ['**/*.profile.ts', '**/*.profile.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 15, domain: 'security' },
  { type: 'role', label: 'Role', filePatterns: ['**/*.role.ts', '**/*.role.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 15, domain: 'security' },

  // AI Protocol
  // `agent`: executionPinned — long-running conversations must stick to the
  // agent version (prompt template + tool set) they started under.
  // (Mirrors OpenAI Assistants v2 / Anthropic Messages assistant pinning.)
  { type: 'agent', label: 'AI Agent', filePatterns: ['**/*.agent.ts', '**/*.agent.yml'], supportsOverlay: false, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: true, executionPinned: true, loadOrder: 90, domain: 'ai' },
  { type: 'tool', label: 'AI Tool', filePatterns: ['**/*.tool.ts', '**/*.tool.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 85, domain: 'ai' },
  { type: 'skill', label: 'AI Skill', filePatterns: ['**/*.skill.ts', '**/*.skill.yml'], supportsOverlay: true, allowOrgOverride: true, allowRuntimeCreate: true, supportsVersioning: false, executionPinned: false, loadOrder: 88, domain: 'ai' },
];

// ==========================================
// Bulk Operation Types
// ==========================================

/**
 * Bulk Register Request
 */
export const MetadataBulkRegisterRequestSchema = lazySchema(() => z.object({
  /** Items to register */
  items: z.array(z.object({
    type: z.string().describe('Metadata type'),
    name: z.string().describe('Item name'),
    data: z.record(z.string(), z.unknown()).describe('Metadata payload'),
    namespace: z.string().optional().describe('Namespace'),
  })).min(1).describe('Items to register'),

  /** Continue on individual item failure */
  continueOnError: z.boolean().default(false).describe('Continue if individual item fails'),

  /** Validate items before registering */
  validate: z.boolean().default(true).describe('Validate before register'),
}));

export type MetadataBulkRegisterRequest = z.input<typeof MetadataBulkRegisterRequestSchema>;

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

export type MetadataBulkResult = z.infer<typeof MetadataBulkResultSchema>;

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

export type MetadataDependency = z.infer<typeof MetadataDependencySchema>;
