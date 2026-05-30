// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DatasetSchema, DatasetMode } from './dataset.zod';

/**
 * # Seed Loader Protocol
 *
 * Defines the schemas for metadata-driven seed data loading with automatic
 * relationship resolution, dependency ordering, and multi-pass insertion.
 *
 * ## Architecture Alignment
 * - **Salesforce Data Loader**: External ID-based upsert with relationship resolution
 * - **ServiceNow**: Sys ID and display value mapping during import
 * - **Airtable**: Linked record resolution via display names
 *
 * ## Loading Flow
 * ```
 * 1. Build object dependency graph from field metadata (lookup/master_detail)
 * 2. Topological sort → determine insert order (parents before children)
 * 3. Pass 1: Insert/upsert records, resolve references via externalId
 * 4. Pass 2: Fill deferred references (circular/delayed dependencies)
 * 5. Validate & report unresolved references
 * 6. Return structured result with per-object stats
 * ```
 */

// ==========================================================================
// 1. Reference Resolution
// ==========================================================================

/**
 * Describes how a single field reference should be resolved during seed loading.
 *
 * When a lookup/master_detail field value is not an internal ID, the loader
 * attempts to match it against the target object's externalId field.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ReferenceResolutionSchema = lazySchema(() => z.object({
  /** The field name on the source object (e.g., 'account_id') */
  field: z.string().describe('Source field name containing the reference value'),

  /** The target object being referenced (e.g., 'account') */
  targetObject: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Target object name (snake_case)'),

  /**
   * The field on the target object used to match the reference value.
   * Defaults to the target object's externalId (usually 'name').
   */
  targetField: z.string().default('name').describe('Field on target object used for matching'),

  /** The field type that triggered this resolution (lookup or master_detail) */
  fieldType: z.enum(['lookup', 'master_detail']).describe('Relationship field type'),
}).describe('Describes how a field reference is resolved during seed loading'));

export type ReferenceResolution = z.infer<typeof ReferenceResolutionSchema>;

// ==========================================================================
// 2. Object Dependency Node
// ==========================================================================

/**
 * Represents a single object in the dependency graph.
 * Built from object metadata by inspecting lookup/master_detail fields.
 */
export const ObjectDependencyNodeSchema = lazySchema(() => z.object({
  /** Object machine name */
  object: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Object name (snake_case)'),

  /**
   * Objects that this object depends on (via lookup/master_detail fields).
   * These must be loaded before this object.
   */
  dependsOn: z.array(z.string()).describe('Objects this object depends on'),

  /**
   * Field-level reference details for each dependency.
   * Maps field name → reference resolution info.
   */
  references: z.array(ReferenceResolutionSchema).describe('Field-level reference details'),
}).describe('Object node in the seed data dependency graph'));

export type ObjectDependencyNode = z.infer<typeof ObjectDependencyNodeSchema>;

// ==========================================================================
// 3. Object Dependency Graph
// ==========================================================================

/**
 * The complete object dependency graph for seed data loading.
 * Used to determine topological insert order and detect circular dependencies.
 */
export const ObjectDependencyGraphSchema = lazySchema(() => z.object({
  /** All object nodes in the graph */
  nodes: z.array(ObjectDependencyNodeSchema).describe('All objects in the dependency graph'),

  /**
   * Topologically sorted object names for insertion order.
   * Parent objects appear before child objects.
   */
  insertOrder: z.array(z.string()).describe('Topologically sorted insert order'),

  /**
   * Circular dependency chains detected in the graph.
   * Each chain is an array of object names forming a cycle.
   * When present, the loader must use a multi-pass strategy.
   *
   * @example [['project', 'task', 'project']]
   */
  circularDependencies: z.array(z.array(z.string())).default([])
    .describe('Circular dependency chains (e.g., [["a", "b", "a"]])'),
}).describe('Complete object dependency graph for seed data loading'));

export type ObjectDependencyGraph = z.infer<typeof ObjectDependencyGraphSchema>;

// ==========================================================================
// 4. Reference Resolution Error
// ==========================================================================

/**
 * Actionable error for a failed reference resolution.
 * Provides all context needed to diagnose and fix the broken reference.
 *
 * Aligns with Salesforce Data Loader error reporting patterns:
 * field name, target object, attempted value, and reason.
 */
export const ReferenceResolutionErrorSchema = lazySchema(() => z.object({
  /** The source object containing the broken reference */
  sourceObject: z.string().describe('Object with the broken reference'),

  /** The field containing the unresolved value */
  field: z.string().describe('Field name with unresolved reference'),

  /** The target object that was searched */
  targetObject: z.string().describe('Target object searched for the reference'),

  /** The externalId field used for matching on the target object */
  targetField: z.string().describe('ExternalId field used for matching'),

  /** The value that could not be resolved */
  attemptedValue: z.unknown().describe('Value that failed to resolve'),

  /** The index of the record in the dataset's records array */
  recordIndex: z.number().int().min(0).describe('Index of the record in the dataset'),

  /** Human-readable error message */
  message: z.string().describe('Human-readable error description'),
}).describe('Actionable error for a failed reference resolution'));

export type ReferenceResolutionError = z.infer<typeof ReferenceResolutionErrorSchema>;

// ==========================================================================
// 4b. Seed Identity (os.user / os.org binding)
// ==========================================================================

/**
 * Identity bound to `os.user` / `os.org` when the loader evaluates CEL
 * expressions embedded in seed records (e.g. `owner_id: cel\`os.user.id\``).
 *
 * The seed loader populates the formula evaluation context from this, so
 * identity-derived seed values resolve to the installer/system identity
 * instead of failing. The canonical producer is the runtime's deterministic
 * system user (`usr_system`), ensured before seeding so this always resolves
 * — even on a fresh boot before the first human sign-up.
 *
 * Defined eagerly (only primitive fields, no circular refs) so it can be
 * referenced from the lazily-built config schema below.
 */
export const SeedIdentitySchema = z.object({
  /**
   * Subject bound to `os.user` in seed CEL. Typically the deterministic
   * system user (`usr_system`) or the promoted platform admin.
   */
  user: z.object({
    id: z.string().min(1),
    role: z.string().optional(),
    email: z.string().optional(),
  }).optional().describe('Subject bound to os.user in seed CEL expressions'),

  /**
   * Organization bound to `os.org` in seed CEL. During per-tenant replay
   * the loader defaults this to `organizationId` when omitted.
   */
  org: z.object({
    id: z.string().min(1),
    tier: z.string().optional(),
  }).optional().describe('Organization bound to os.org in seed CEL expressions'),
}).describe('Identity context for resolving os.user / os.org in seed CEL values');

export type SeedIdentity = z.infer<typeof SeedIdentitySchema>;

// ==========================================================================
// 5. Seed Loader Configuration
// ==========================================================================

/**
 * Configuration for the seed data loader.
 * Controls behavior for reference resolution, error handling, and validation.
 */
export const SeedLoaderConfigSchema = lazySchema(() => z.object({
  /**
   * Dry-run mode: validate all references without writing data.
   * Surfaces broken references before any mutations occur.
   * @default false
   */
  dryRun: z.boolean().default(false)
    .describe('Validate references without writing data'),

  /**
   * Whether to halt on the first reference resolution error.
   * When false, collects all errors and continues loading.
   * @default false
   */
  haltOnError: z.boolean().default(false)
    .describe('Stop on first reference resolution error'),

  /**
   * Enable multi-pass loading for circular dependencies.
   * Pass 1: Insert records with null for circular references.
   * Pass 2: Update records to fill deferred references.
   * @default true
   */
  multiPass: z.boolean().default(true)
    .describe('Enable multi-pass loading for circular dependencies'),

  /**
   * Default dataset mode when not specified per-dataset.
   * @default 'upsert'
   */
  defaultMode: DatasetMode.default('upsert')
    .describe('Default conflict resolution strategy'),

  /**
   * Maximum number of records to process in a single batch.
   * Controls memory usage for large datasets.
   * @default 1000
   */
  batchSize: z.number().int().min(1).default(1000)
    .describe('Maximum records per batch insert/upsert'),

  /**
   * Whether to wrap the entire load operation in a transaction.
   * When true, all-or-nothing semantics apply.
   * @default false
   */
  transaction: z.boolean().default(false)
    .describe('Wrap entire load in a transaction (all-or-nothing)'),

  /**
   * Environment filter. Only datasets matching this environment are loaded.
   * When not specified, all datasets are loaded regardless of env scope.
   */
  env: z.enum(['prod', 'dev', 'test']).optional()
    .describe('Only load datasets matching this environment'),

  /**
   * Target organization for per-tenant seed loading.
   *
   * When set, the loader:
   *   - Injects `organization_id: <id>` into every record before write
   *     (unless the record already supplies one).
   *   - Scopes existing-record lookups (`loadExistingRecords`,
   *     `resolveFromDatabase`) to `organization_id = <id>`, so `upsert`
   *     mode finds the per-org copy rather than another tenant's row.
   *
   * Use this from a `sys_organization` insert hook to give every new
   * tenant a private copy of the artifact-shipped demo data (Salesforce
   * sandbox style). Omit for cross-tenant / platform-wide seeds (e.g.
   * `sys_permission_set`) — those rows should have `organization_id`
   * NULL and are not filtered by the default tenant RLS.
   */
  organizationId: z.string().min(1).optional()
    .describe('Target organization id for per-tenant seed replay'),

  /**
   * Identity bound to `os.user` / `os.org` when evaluating CEL expressions
   * embedded in seed records (e.g. `owner_id: cel\`os.user.id\``,
   * `organization_id: cel\`os.org.id\``).
   *
   * When omitted, `os.user` / `os.org` are simply unbound — and any record
   * that references them fails loudly (the record is dropped with an
   * actionable error rather than persisting the raw Expression envelope into
   * the column). The runtime supplies a deterministic system user here so
   * identity-derived seeds resolve even before the first human sign-up.
   */
  identity: SeedIdentitySchema.optional()
    .describe('Identity bound to os.user / os.org when resolving CEL seed values'),
}).describe('Seed data loader configuration'));

export type SeedLoaderConfig = z.infer<typeof SeedLoaderConfigSchema>;

/** Input type — all fields with defaults are optional */
export type SeedLoaderConfigInput = z.input<typeof SeedLoaderConfigSchema>;

// ==========================================================================
// 6. Per-Object Load Result
// ==========================================================================

/**
 * Result of loading a single object's dataset.
 */
export const DatasetLoadResultSchema = lazySchema(() => z.object({
  /** Target object name */
  object: z.string().describe('Object that was loaded'),

  /** Import mode used */
  mode: DatasetMode.describe('Import mode used'),

  /** Number of records successfully inserted */
  inserted: z.number().int().min(0).describe('Records inserted'),

  /** Number of records successfully updated (upsert matched existing) */
  updated: z.number().int().min(0).describe('Records updated'),

  /** Number of records skipped (mode: ignore, or already exists) */
  skipped: z.number().int().min(0).describe('Records skipped'),

  /** Number of records with errors */
  errored: z.number().int().min(0).describe('Records with errors'),

  /** Total records in the dataset */
  total: z.number().int().min(0).describe('Total records in dataset'),

  /** Number of references resolved via externalId */
  referencesResolved: z.number().int().min(0).describe('References resolved via externalId'),

  /** Number of references deferred to pass 2 (circular dependencies) */
  referencesDeferred: z.number().int().min(0).describe('References deferred to second pass'),

  /** Reference resolution errors for this object */
  errors: z.array(ReferenceResolutionErrorSchema).default([])
    .describe('Reference resolution errors'),
}).describe('Result of loading a single dataset'));

export type DatasetLoadResult = z.infer<typeof DatasetLoadResultSchema>;

// ==========================================================================
// 7. Seed Loader Result
// ==========================================================================

/**
 * Complete result of a seed loading operation.
 * Aggregates all per-object results and provides summary statistics.
 */
export const SeedLoaderResultSchema = lazySchema(() => z.object({
  /** Whether the overall load operation succeeded */
  success: z.boolean().describe('Overall success status'),

  /** Was this a dry-run (validation only, no writes)? */
  dryRun: z.boolean().describe('Whether this was a dry-run'),

  /** The dependency graph used for ordering */
  dependencyGraph: ObjectDependencyGraphSchema.describe('Object dependency graph'),

  /** Per-object load results, in the order they were processed */
  results: z.array(DatasetLoadResultSchema).describe('Per-object load results'),

  /** All reference resolution errors across all objects */
  errors: z.array(ReferenceResolutionErrorSchema).describe('All reference resolution errors'),

  /** Summary statistics */
  summary: z.object({
    /** Total objects processed */
    objectsProcessed: z.number().int().min(0).describe('Total objects processed'),

    /** Total records across all objects */
    totalRecords: z.number().int().min(0).describe('Total records across all objects'),

    /** Total records inserted */
    totalInserted: z.number().int().min(0).describe('Total records inserted'),

    /** Total records updated */
    totalUpdated: z.number().int().min(0).describe('Total records updated'),

    /** Total records skipped */
    totalSkipped: z.number().int().min(0).describe('Total records skipped'),

    /** Total records with errors */
    totalErrored: z.number().int().min(0).describe('Total records with errors'),

    /** Total references resolved via externalId */
    totalReferencesResolved: z.number().int().min(0).describe('Total references resolved'),

    /** Total references deferred to second pass */
    totalReferencesDeferred: z.number().int().min(0).describe('Total references deferred'),

    /** Number of circular dependency chains detected */
    circularDependencyCount: z.number().int().min(0).describe('Circular dependency chains detected'),

    /** Duration of the load operation in milliseconds */
    durationMs: z.number().min(0).describe('Load duration in milliseconds'),
  }).describe('Summary statistics'),
}).describe('Complete seed loader result'));

export type SeedLoaderResult = z.infer<typeof SeedLoaderResultSchema>;

// ==========================================================================
// 8. Seed Loader Request
// ==========================================================================

/**
 * Input request for the seed loader.
 * Combines datasets with loader configuration.
 */
export const SeedLoaderRequestSchema = lazySchema(() => z.object({
  /** Datasets to load */
  datasets: z.array(DatasetSchema).min(1).describe('Datasets to load'),

  /** Loader configuration */
  config: SeedLoaderConfigSchema.default(() => SeedLoaderConfigSchema.parse({})).describe('Loader configuration'),
}).describe('Seed loader request with datasets and configuration'));

export type SeedLoaderRequest = z.infer<typeof SeedLoaderRequestSchema>;

/** Input type — config defaults are optional */
export type SeedLoaderRequestInput = z.input<typeof SeedLoaderRequestSchema>;
