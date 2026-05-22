// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Metadata Scope Enum
 * Defines the lifecycle and mutability of a metadata item.
 */
import { lazySchema } from '../shared/lazy-schema';
export const MetadataScopeSchema = lazySchema(() => z.enum([
  'system',   // Defined in Code (Files). Read-only at runtime. Upgraded via deployment.
  'platform', // Defined in DB (Global). admin-configured. Overrides system.
  'user',     // Defined in DB (Personal). User-configured. Overrides platform/system.
]));

/**
 * Metadata Lifecycle State
 */
export const MetadataStateSchema = lazySchema(() => z.enum([
  'draft',    // Work in progress, not active
  'active',   // Live and running
  'archived', // Soft deleted
  'deprecated' // Running but flagged for removal
]));

/**
 * Unified Metadata Persistence Protocol
 * 
 * Defines the standardized envelope for storing ANY metadata item (Object, View, Flow)
 * in the database (e.g. `_framework_metadata` or generic `metadata` table).
 * 
 * This treats "Metadata as Data".
 */
export const MetadataRecordSchema = lazySchema(() => z.object({
  /** Primary Key (UUID) */
  id: z.string(),
  
  /** 
   * Machine Name 
   * The unique identifier used in code references (e.g. "account_list_view").
   */
  name: z.string(),
  
  /**
   * Metadata Type
   * e.g. "object", "view", "permission_set", "flow"
   */
  type: z.string(),
  
  /**
   * Namespace / Module
   * Groups metadata into packages (e.g. "crm", "finance", "core").
   */
  namespace: z.string().default('default'),

  /**
   * Package Ownership Reference
   * Links this metadata record to the package that delivered it.
   * When set, the record is "managed" by the package and should not be
   * directly edited — customizations go through the overlay system.
   * Null/undefined means the record was created independently (not from a package).
   */
  packageId: z.string().optional().describe('Package ID that owns/delivered this metadata'),

  /**
   * Managed By Indicator
   * Determines who controls this metadata record's lifecycle.
   * - "package": Delivered and upgraded by a plugin package (read-only base)
   * - "platform": Created by platform admin via UI
   * - "user": Created by end user
   */
  managedBy: z.enum(['package', 'platform', 'user']).optional()
    .describe('Who manages this metadata record lifecycle'),
  
  /**
   * Ownership differentiation
   */
  scope: MetadataScopeSchema.default('platform'),
  
  /**
   * The Payload
   * Stores the actual configuration JSON.
   * This field holds the value of `ViewSchema`, `ObjectSchema`, etc.
   */
  metadata: z.record(z.string(), z.unknown()),

  /**
   * Extension / Merge Strategy
   * If this record overrides a system record, how should it be applied?
   */
  extends: z.string().optional().describe('Name of the parent metadata to extend/override'),
  strategy: z.enum(['merge', 'replace']).default('merge'),

  /** Owner (for user-scope items) */
  owner: z.string().optional(),
  
  /** State */
  state: MetadataStateSchema.default('active'),

  /** Organization ID for multi-tenant isolation */
  organizationId: z.string().optional().describe('Organization identifier for multi-tenant isolation'),

  /** Tenant ID for multi-tenant isolation (alias of organizationId in some contexts) */
  tenantId: z.string().optional().describe('Tenant identifier for multi-tenant isolation'),

  /**
   * @deprecated Since ADR-0006 v4 / ADR-0005 amendment (2026-05-22).
   * `sys_project` no longer exists; the overlay scope is
   * `organization_id` only (and, in ADR-0008 M1, `branch`).
   * Retained as a nullable legacy column for backwards-compat reads;
   * new writes must leave it unset. Will be dropped in ADR-0008 PR-10.
   */
  projectId: z.string().optional().describe('Deprecated (ADR-0006 v4): legacy project_id column. New code must use organization_id only.'),

  /** Version number for optimistic concurrency */
  version: z.number().default(1).describe('Record version for optimistic concurrency control'),

  /** Checksum for change detection */
  checksum: z.string().optional().describe('Content checksum for change detection'),

  /** Source origin marker */
  source: z.enum(['filesystem', 'database', 'api', 'migration']).optional().describe('Origin of this metadata record'),

  /** Classification tags */
  tags: z.array(z.string()).optional().describe('Classification tags for filtering and grouping'),

  /** Package Publishing */
  publishedDefinition: z.unknown().optional()
    .describe('Snapshot of the last published definition'),
  publishedAt: z.string().datetime().optional()
    .describe('When this metadata was last published'),
  publishedBy: z.string().optional()
    .describe('Who published this version'),

  /** Audit */
  createdBy: z.string().optional(),
  createdAt: z.string().datetime().optional().describe('Creation timestamp'),
  updatedBy: z.string().optional(),
  updatedAt: z.string().datetime().optional().describe('Last update timestamp'),
}));

export type MetadataRecord = z.infer<typeof MetadataRecordSchema>;
export type MetadataScope = z.infer<typeof MetadataScopeSchema>;

/**
 * Package Publish Result
 * Returned by `publishPackage()` after a package-level metadata publish operation.
 */
export const PackagePublishResultSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the publish succeeded'),
  packageId: z.string().describe('The package ID that was published'),
  version: z.number().int().describe('New version number after publish'),
  publishedAt: z.string().datetime().describe('Publish timestamp'),
  itemsPublished: z.number().int().describe('Total metadata items published'),
  validationErrors: z.array(z.object({
    type: z.string().describe('Metadata type that failed validation'),
    name: z.string().describe('Item name that failed validation'),
    message: z.string().describe('Validation error message'),
  })).optional().describe('Validation errors if publish failed'),
}));

export type PackagePublishResult = z.infer<typeof PackagePublishResultSchema>;

/**
 * Metadata Format
 * Supported file formats for metadata serialization.
 */
export const MetadataFormatSchema = lazySchema(() => z.enum([
  'json', 'yaml', 'yml', 'ts', 'js',
  'typescript', 'javascript' // Aliases
]));

/**
 * Metadata Stats
 * Statistics about a metadata item.
 */
export const MetadataStatsSchema = lazySchema(() => z.object({
  path: z.string().optional(),
  size: z.number().optional(),
  mtime: z.string().datetime().optional(),
  hash: z.string().optional(),
  etag: z.string().optional(), // Required by local cache
  modifiedAt: z.string().datetime().optional(), // Alias for mtime
  format: MetadataFormatSchema.optional(), // Required for serialization
}));

/**
 * Metadata Loader Contract
 * Describes the capabilities and identity of a metadata loader.
 */
export const MetadataLoaderContractSchema = lazySchema(() => z.object({
  name: z.string(),
  protocol: z.enum(['file:', 'http:', 's3:', 'datasource:', 'memory:']).describe('Loader protocol identifier'),
  description: z.string().optional(),
  supportedFormats: z.array(z.string()).optional(),
  supportsWatch: z.boolean().optional(),
  supportsWrite: z.boolean().optional(),
  supportsCache: z.boolean().optional(),
  capabilities: z.object({
    read: z.boolean().default(true),
    write: z.boolean().default(false),
    watch: z.boolean().default(false),
    list: z.boolean().default(true),
  }),
}));

/**
 * Metadata Load Options
 */
export const MetadataLoadOptionsSchema = lazySchema(() => z.object({
  scope: MetadataScopeSchema.optional(),
  namespace: z.string().optional(),
  raw: z.boolean().optional().describe('Return raw file content instead of parsed JSON'),
  cache: z.boolean().optional(),
  useCache: z.boolean().optional(), // Alias for cache
  validate: z.boolean().optional(),
  ifNoneMatch: z.string().optional(), // For caching
  recursive: z.boolean().optional(),
  limit: z.number().optional(),
  patterns: z.array(z.string()).optional(),
  loader: z.string().optional().describe('Specific loader to use (e.g. filesystem, database)'),
}));

/**
 * Metadata Load Result
 */
export const MetadataLoadResultSchema = lazySchema(() => z.object({
  data: z.unknown(),
  stats: MetadataStatsSchema.optional(),
  format: MetadataFormatSchema.optional(),
  source: z.string().optional(), // File path or URL
  fromCache: z.boolean().optional(),
  etag: z.string().optional(),
  notModified: z.boolean().optional(),
  loadTime: z.number().optional(),
}));

/**
 * Metadata Save Options
 */
export const MetadataSaveOptionsSchema = lazySchema(() => z.object({
  format: MetadataFormatSchema.optional(),
  create: z.boolean().default(true),
  overwrite: z.boolean().default(true),
  path: z.string().optional(),
  prettify: z.boolean().optional(),
  indent: z.number().optional(),
  sortKeys: z.boolean().optional(),
  backup: z.boolean().optional(),
  atomic: z.boolean().optional(),
  loader: z.string().optional().describe('Specific loader to use (e.g. filesystem, database)'),
}));

/**
 * Metadata Save Result
 */
export const MetadataSaveResultSchema = lazySchema(() => z.object({
  success: z.boolean(),
  path: z.string().optional(),
  stats: MetadataStatsSchema.optional(),
  etag: z.string().optional(),
  size: z.number().optional(),
  saveTime: z.number().optional(),
  backupPath: z.string().optional(),
}));

/**
 * Metadata Watch Event
 */
export const MetadataWatchEventSchema = lazySchema(() => z.object({
  type: z.enum(['add', 'change', 'unlink', 'added', 'changed', 'deleted']),
  path: z.string(),
  name: z.string().optional(),
  stats: MetadataStatsSchema.optional(),
  metadataType: z.string().optional(),
  data: z.unknown().optional(),
  timestamp: z.string().datetime().optional(),
}));

/**
 * Metadata Collection Info
 */
export const MetadataCollectionInfoSchema = lazySchema(() => z.object({
  type: z.string(),
  count: z.number(),
  namespaces: z.array(z.string()),
}));

/**
 * Metadata Export/Import Options
 */
export const MetadataExportOptionsSchema = lazySchema(() => z.object({
  types: z.array(z.string()).optional(),
  namespaces: z.array(z.string()).optional(),
  output: z.string().describe('Output directory or file'),
  format: MetadataFormatSchema.default('json'),
}));

export const MetadataImportOptionsSchema = lazySchema(() => z.object({
  source: z.string().describe('Input directory or file'),
  strategy: z.enum(['merge', 'replace', 'skip']).default('merge'),
  validate: z.boolean().default(true),
}));

/**
 * Metadata Source Origin
 * Indicates where a metadata record was loaded from.
 */
export const MetadataSourceSchema = lazySchema(() => z.enum([
  'filesystem', // Loaded from local files
  'database',   // Loaded from database via datasource
  'api',        // Loaded from remote API
  'migration',  // Created during a migration process
]));

/**
 * Metadata Fallback Strategy & Manager Config
 *
 * The canonical schemas live in `../kernel/metadata-loader.zod` — that file
 * carries the richer shape (nested `cache.databaseLoader`, `persistence` write
 * gates, `validation` flags) used by the runtime MetadataManager. This file
 * historically declared a narrower duplicate; we re-export the kernel version
 * here so a single TypeScript type is observed everywhere `@objectstack/spec`
 * consumers reach for it.
 */
export {
  MetadataFallbackStrategySchema,
  MetadataManagerConfigSchema,
} from '../kernel/metadata-loader.zod';

export type MetadataFormat = z.infer<typeof MetadataFormatSchema>;
export type MetadataStats = z.infer<typeof MetadataStatsSchema>;
export type MetadataLoaderContract = z.input<typeof MetadataLoaderContractSchema>;
export type MetadataLoadOptions = z.infer<typeof MetadataLoadOptionsSchema>;
export type MetadataLoadResult = z.infer<typeof MetadataLoadResultSchema>;
export type MetadataSaveOptions = z.infer<typeof MetadataSaveOptionsSchema>;
export type MetadataSaveResult = z.infer<typeof MetadataSaveResultSchema>;
export type MetadataWatchEvent = z.infer<typeof MetadataWatchEventSchema>;
export type MetadataCollectionInfo = z.infer<typeof MetadataCollectionInfoSchema>;
export type MetadataExportOptions = z.infer<typeof MetadataExportOptionsSchema>;
export type MetadataImportOptions = z.infer<typeof MetadataImportOptionsSchema>;
export type { MetadataManagerConfig, MetadataFallbackStrategy } from '../kernel/metadata-loader.zod';
export type MetadataSource = z.infer<typeof MetadataSourceSchema>;

/**
 * Metadata History Record
 *
 * Represents a single version snapshot in the metadata change history.
 * Stored in the sys_metadata_history table for version tracking and rollback.
 */
export const MetadataHistoryRecordSchema = lazySchema(() => z.object({
  /** Primary Key (UUID) */
  id: z.string(),

  /**
   * Machine Name
   * Denormalized from parent for easier querying.
   */
  name: z.string(),

  /**
   * Metadata Type
   * Denormalized from parent for easier querying.
   */
  type: z.string(),

  /**
   * Version Number
   * Snapshot of the metadata version at this point in history.
   */
  version: z.number().describe('Version number at this snapshot'),

  /**
   * Operation Type
   * Indicates what kind of change triggered this history record.
   */
  operationType: z.enum(['create', 'update', 'publish', 'revert', 'delete']).describe('Type of operation that created this history entry'),

  /**
   * Historical Metadata Snapshot
   * Full JSON payload of the metadata definition at this version.
   * May be stored as a raw JSON string in the history table, or as a parsed object
   * in higher-level APIs. When `includeMetadata` is false, this field is null.
   */
  metadata: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .nullable()
    .optional()
    .describe('Snapshot of metadata definition at this version (raw JSON string or parsed object)'),

  /**
   * Content Checksum
   * SHA-256 checksum of the normalized metadata JSON for change detection.
   */
  checksum: z.string().describe('SHA-256 checksum of metadata content'),

  /**
   * Previous Checksum
   * Checksum of the previous version for diff optimization.
   */
  previousChecksum: z.string().optional().describe('Checksum of the previous version'),

  /**
   * Change Note
   * Human-readable description of what changed in this version.
   */
  changeNote: z.string().optional().describe('Description of changes made in this version'),

  /** Organization ID for multi-tenant isolation */
  organizationId: z.string().optional().describe('Organization identifier for multi-tenant isolation'),

  /**
   * @deprecated Since ADR-0006 v4 (2026-05-22). `sys_project` is gone;
   * history rows are scoped by `organization_id` (and `branch` once
   * ADR-0008 M1 lands). Kept nullable for legacy rows.
   */
  projectId: z.string().optional().describe('Deprecated (ADR-0006 v4): legacy project_id column. New writes leave unset.'),

  /** Audit: who made this change */
  recordedBy: z.string().optional().describe('User who made this change'),

  /** Audit: when was this version recorded */
  recordedAt: z.string().datetime().describe('Timestamp when this version was recorded'),
}));

export type MetadataHistoryRecord = z.infer<typeof MetadataHistoryRecordSchema>;

/**
 * Metadata History Query Options
 * Options for retrieving metadata version history.
 */
export const MetadataHistoryQueryOptionsSchema = lazySchema(() => z.object({
  /** Limit number of history records returned */
  limit: z.number().int().positive().optional().describe('Maximum number of history records to return'),

  /** Offset for pagination */
  offset: z.number().int().nonnegative().optional().describe('Number of records to skip'),

  /** Only return versions after this timestamp */
  since: z.string().datetime().optional().describe('Only return history after this timestamp'),

  /** Only return versions before this timestamp */
  until: z.string().datetime().optional().describe('Only return history before this timestamp'),

  /** Filter by operation type */
  operationType: z.enum(['create', 'update', 'publish', 'revert', 'delete']).optional().describe('Filter by operation type'),

  /** Include full metadata payload in results (default: true) */
  includeMetadata: z.boolean().optional().default(true).describe('Include full metadata payload'),
}));

export type MetadataHistoryQueryOptions = z.infer<typeof MetadataHistoryQueryOptionsSchema>;

/**
 * Metadata History Query Result
 * Result of querying metadata version history.
 */
export const MetadataHistoryQueryResultSchema = lazySchema(() => z.object({
  /** Array of history records */
  records: z.array(MetadataHistoryRecordSchema),

  /** Total number of history records (for pagination) */
  total: z.number().int().nonnegative(),

  /** Whether there are more records available */
  hasMore: z.boolean(),
}));

export type MetadataHistoryQueryResult = z.infer<typeof MetadataHistoryQueryResultSchema>;

/**
 * Metadata Diff Result
 * Result of comparing two versions of metadata.
 */
export const MetadataDiffResultSchema = lazySchema(() => z.object({
  /** Metadata type */
  type: z.string(),

  /** Metadata name */
  name: z.string(),

  /** Version 1 (older) */
  version1: z.number(),

  /** Version 2 (newer) */
  version2: z.number(),

  /** Checksum of version 1 */
  checksum1: z.string(),

  /** Checksum of version 2 */
  checksum2: z.string(),

  /** Whether the versions are identical */
  identical: z.boolean(),

  /** JSON patch operations to transform v1 into v2 */
  patch: z.array(z.unknown()).optional().describe('JSON patch operations'),

  /** Human-readable diff summary */
  summary: z.string().optional().describe('Human-readable summary of changes'),
}));

export type MetadataDiffResult = z.infer<typeof MetadataDiffResultSchema>;

/**
 * Metadata History Retention Policy
 * Configuration for automatic cleanup of old history records.
 */
export const MetadataHistoryRetentionPolicySchema = lazySchema(() => z.object({
  /** Maximum number of versions to keep per metadata item */
  maxVersions: z.number().int().positive().optional().describe('Maximum number of versions to retain'),

  /** Maximum age of history records in days */
  maxAgeDays: z.number().int().positive().optional().describe('Maximum age of history records in days'),

  /** Whether to enable automatic cleanup */
  autoCleanup: z.boolean().default(false).describe('Enable automatic cleanup of old history'),

  /** Cleanup interval in hours */
  cleanupIntervalHours: z.number().int().positive().default(24).describe('How often to run cleanup (in hours)'),
}));

export type MetadataHistoryRetentionPolicy = z.infer<typeof MetadataHistoryRetentionPolicySchema>;
