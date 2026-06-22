// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';


/**
 * Driver Identifier
 * Can be a built-in driver or a plugin-contributed driver (e.g., "com.vendor.snowflake").
 */
import { lazySchema } from '../shared/lazy-schema';
export const DriverType = z.string().describe('Underlying driver identifier');

/**
 * Driver Definition Schema
 * Metadata describing a Database Driver.
 * Plugins use this to register new connectivity options.
 */
export const DriverDefinitionSchema = lazySchema(() => z.object({
  id: z.string().describe('Unique driver identifier (e.g. "postgres")'),
  label: z.string().describe('Display label (e.g. "PostgreSQL")'),
  description: z.string().optional(),
  icon: z.string().optional(),
  
  /**
   * Configuration Schema (JSON Schema)
   * Describes the structure of the `config` object needed for this driver.
   * Used by the UI to generate the connection form.
   */
  configSchema: z.record(z.string(), z.unknown()).describe('JSON Schema for connection configuration'),
  
  /**
   * Default Capabilities
   * What this driver supports out-of-the-box.
   */
  capabilities: z.lazy(() => DatasourceCapabilities).optional(),
}));

/**
 * Datasource Capabilities Schema
 * Declares what this datasource naturally supports.
 * The ObjectQL engine uses this to determine what logic to push down
 * and what to compute in memory.
 */
export const DatasourceCapabilities = z.object({
  // ============================================================================
  // Transaction & Connection Management
  // ============================================================================
  
  /** Can handle ACID transactions? */
  transactions: z.boolean().default(false),
  
  // ============================================================================
  // Query Operations
  // ============================================================================
  
  /** Can execute WHERE clause filters natively? */
  queryFilters: z.boolean().default(false),
  
  /** Can perform aggregation (group by, sum, avg)? */
  queryAggregations: z.boolean().default(false),
  
  /** Can perform ORDER BY sorting? */
  querySorting: z.boolean().default(false),
  
  /** Can perform LIMIT/OFFSET pagination? */
  queryPagination: z.boolean().default(false),
  
  /** Can perform window functions? */
  queryWindowFunctions: z.boolean().default(false),
  
  /** Can perform subqueries? */
  querySubqueries: z.boolean().default(false),
  
  /** Can execute SQL-like joins natively? */
  joins: z.boolean().default(false),
  
  // ============================================================================
  // Advanced Features
  // ============================================================================
  
  /** Can perform full-text search? */
  fullTextSearch: z.boolean().default(false),
  
  /** Is read-only? */
  readOnly: z.boolean().default(false),
  
  /** Is scheme-less (needs schema inference)? */
  dynamicSchema: z.boolean().default(false),
});

/**
 * Schema Ownership Mode (ADR-0015)
 *
 * Distinguishes "ObjectStack owns this schema" from "this is somebody
 * else's production database — never touch DDL". Gates migrations,
 * boot-time validation, and writes.
 *
 * - `managed`       — ObjectStack owns the schema: DDL + migrations allowed.
 * - `external`      — Mature external DB: DDL forbidden; mismatch fails boot.
 * - `validate-only` — Like `external`, but mismatches warn instead of fail.
 */
export const SchemaModeSchema = z
  .enum(['managed', 'external', 'validate-only'])
  .describe('Schema ownership mode');

export type SchemaMode = z.infer<typeof SchemaModeSchema>;

/**
 * External Datasource Settings (ADR-0015)
 *
 * Present only when `schemaMode !== 'managed'`. Carries the federation
 * policy for a mature external database: write gating, schema whitelist,
 * boot/drift validation behaviour, credentials reference, and query caps.
 */
export const ExternalDatasourceSettingsSchema = z.object({
  label: z.string().optional()
    .describe('Display label, e.g. "Snowflake — ANALYTICS / PROD"'),
  allowedSchemas: z.array(z.string()).optional()
    .describe('Whitelist of remote schemas/databases that may be exposed.'),
  allowWrites: z.boolean().default(false)
    .describe('Global write gate. Individual objects must also opt in via object.external.writable.'),
  validation: z.object({
    onMismatch: z.enum(['fail', 'warn', 'ignore']).default('fail')
      .describe('What to do when a federated object diverges from the remote table.'),
    checkOnBoot: z.boolean().default(true)
      .describe('Validate federated objects against the remote schema at boot.'),
    checkIntervalMs: z.number().optional()
      .describe('Optional background drift-check interval in milliseconds.'),
  }).default({ onMismatch: 'fail', checkOnBoot: true }).describe('Boot/drift validation policy'),
  credentialsRef: z.string().optional()
    .describe('Reference into the secrets store; never inline credentials.'),
  queryTimeoutMs: z.number().default(30_000)
    .describe('Hard cap on per-query execution time.'),
  requirePermission: z.string().optional()
    .describe('Optional convenience: gate the entire datasource behind a single role.'),
}).describe('External datasource federation settings (schemaMode != "managed")');

export type ExternalDatasourceSettings = z.infer<typeof ExternalDatasourceSettingsSchema>;

/**
 * Datasource Schema
 * Represents a connection to an external data store.
 */
export const DatasourceSchema = lazySchema(() => z.object({
  /** Machine Name */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique datasource identifier'),
  
  /** Human Label */
  label: z.string().optional().describe('Display label'),
  
  /** Driver */
  driver: DriverType.describe('Underlying driver type'),
  
  /** 
   * Connection Configuration 
   * Specific to the driver (e.g., host, port, user, password, bucket, etc.)
   * Stored securely (passwords usually interpolated from ENV).
   */
  config: z.record(z.string(), z.unknown()).describe('Driver specific configuration'),
  
  /**
   * Connection Pool Configuration
   * Standard connection pooling settings.
   */
  pool: z.object({
    min: z.number().default(0).describe('Minimum connections'),
    max: z.number().default(10).describe('Maximum connections'),
    idleTimeoutMillis: z.number().default(30000).describe('Idle timeout'),
    connectionTimeoutMillis: z.number().default(3000).describe('Connection establishment timeout'),
  }).optional().describe('Connection pool settings'),

  /**
   * Read Replicas
   * Optional list of duplicate configurations for read-only operations.
   * Useful for scaling read throughput.
   */
  readReplicas: z.array(z.record(z.string(), z.unknown())).optional().describe('Read-only replica configurations'),

  /**
   * Capability Overrides
   * Manually override what the driver claims to support.
   */
  capabilities: DatasourceCapabilities.optional().describe('Capability overrides'),
  
  /** Health Check */
  healthCheck: z.object({
    enabled: z.boolean().default(true).describe('Enable health check endpoint'),
    intervalMs: z.number().default(30000).describe('Health check interval in milliseconds'),
    timeoutMs: z.number().default(5000).describe('Health check timeout in milliseconds'),
  }).optional().describe('Datasource health check configuration'),

  /** SSL/TLS Configuration */
  ssl: z.object({
    enabled: z.boolean().default(false).describe('Enable SSL/TLS for database connection'),
    rejectUnauthorized: z.boolean().default(true).describe('Reject connections with invalid/self-signed certificates'),
    ca: z.string().optional().describe('CA certificate (PEM format or path to file)'),
    cert: z.string().optional().describe('Client certificate (PEM format or path to file)'),
    key: z.string().optional().describe('Client private key (PEM format or path to file)'),
  }).optional().describe('SSL/TLS configuration for secure database connections'),

  /** Retry Policy */
  retryPolicy: z.object({
    maxRetries: z.number().default(3).describe('Maximum number of retry attempts'),
    baseDelayMs: z.number().default(1000).describe('Base delay between retries in milliseconds'),
    maxDelayMs: z.number().default(30000).describe('Maximum delay between retries in milliseconds'),
    backoffMultiplier: z.number().default(2).describe('Exponential backoff multiplier'),
  }).optional().describe('Connection retry policy for transient failures'),

  /** Description */
  description: z.string().optional().describe('Internal description'),
  
  /** Is enabled? */
  active: z.boolean().default(true).describe('Is datasource enabled'),

  /**
   * Auto-connect opt-in (ADR-0062 D2(c)).
   *
   * Forces the runtime to build a live driver for this datasource at boot even
   * when it is `managed` and nothing routes to it. By default a declared
   * datasource only auto-connects when it is `external` or an object explicitly
   * binds to it via `object.datasource` (see ADR-0062 D2). Set this to opt a
   * managed, unrouted datasource into the live-connection lifecycle.
   */
  autoConnect: z.boolean().default(false)
    .describe('Force a live driver connection at boot even when managed + unrouted (ADR-0062 D2).'),

  /**
   * Schema Ownership Mode (ADR-0015)
   * Declares whether ObjectStack owns this schema (`managed`, default) or
   * is a guest in a mature external database (`external` / `validate-only`).
   */
  schemaMode: SchemaModeSchema.default('managed'),

  /**
   * External Federation Settings (ADR-0015)
   * Required when `schemaMode !== 'managed'`; forbidden otherwise.
   */
  external: ExternalDatasourceSettingsSchema.optional(),

  /**
   * Provenance (ADR-0015 Addendum)
   *
   * Server-managed, read-only. Distinguishes code-defined datasources
   * (`code` — authored as `*.datasource.ts`, GitOps-owned, read-only in the
   * UI) from runtime datasources (`runtime` — created via the Studio wizard,
   * persisted in the runtime metadata store, environment-scoped, editable).
   *
   * Never accepted from client input: the runtime stamps `code` on artefact
   * load and `runtime` on UI create. Defaults to `code` for artefact-defined
   * datasources that predate this field.
   */
  origin: z.enum(['code', 'runtime']).default('code')
    .describe('Datasource provenance (server-managed, read-only)'),
}).superRefine((ds, ctx) => {
  if (ds.schemaMode !== 'managed' && !ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `schemaMode='${ds.schemaMode}' requires 'external' settings.`,
    });
  }
  if (ds.schemaMode === 'managed' && ds.external) {
    ctx.addIssue({
      code: 'custom',
      path: ['external'],
      message: `'external' settings only apply when schemaMode != 'managed'.`,
    });
  }
}));

export type Datasource = z.infer<typeof DatasourceSchema>;
/** Authoring input for {@link Datasource} — defaulted fields are optional. */
export type DatasourceInput = z.input<typeof DatasourceSchema>;
export type DatasourceCapabilitiesType = z.infer<typeof DatasourceCapabilities>;

/**
 * Type-safe factory for an external data connection (datasource). Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Datasource` literal.
 */
export function defineDatasource(config: z.input<typeof DatasourceSchema>): Datasource {
  return DatasourceSchema.parse(config);
}
