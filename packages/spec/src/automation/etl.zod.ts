// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';

/**
 * ETL (Extract, Transform, Load) Pipeline Protocol - LEVEL 2: Data Engineering
 * 
 * Inspired by modern data integration platforms like Airbyte, Fivetran, and Apache NiFi.
 * 
 * **Positioning in the sync/integration layering** (L1 "Simple Sync" was
 * retired in #4738 — narrative-only, zero consumers; see
 * `packages/spec/docs/SYNC_ARCHITECTURE.md`):
 * - **ETL Pipeline** (THIS FILE) - Data engineers - Aggregate 10 sources to warehouse
 * - **Enterprise Connector** (integration/connector.zod.ts) - System integrators - Full SAP integration; connector-attached sync via `syncConfig`
 * 
 * ETL pipelines enable automated data synchronization between systems, transforming
 * data as it moves from source to destination.
 * 
 * **SCOPE: Advanced multi-source, multi-stage transformations.**
 * Supports complex operations: joins, aggregations, filtering, custom SQL.
 * 
 * ## When to Use This Layer
 * 
 * **Use ETL Pipeline when:**
 * - Combining data from multiple sources
 * - Need aggregations, joins, transformations
 * - Building data warehouses or analytics platforms
 * - Complex data transformations required
 * 
 * **Examples:**
 * - Sales data from Salesforce + Marketing from HubSpot → Data Warehouse
 * - Multi-region databases → Consolidated reporting
 * - Legacy system migration with transformation
 * 
 * **When to upgrade:**
 * - Need full connector lifecycle (auth, webhooks, rate limits) → Use {@link file://../integration/connector.zod.ts | Enterprise Connector}
 *
 * @see {@link file://../integration/connector.zod.ts} for the Enterprise Connector layer
 * 
 * ## Use Cases
 * 
 * 1. **Data Warehouse Population**
 *    - Extract from multiple operational systems
 *    - Transform to analytical schema
 *    - Load into data warehouse
 * 
 * 2. **System Integration**
 *    - Sync data between CRM and Marketing Automation
 *    - Keep product catalog synchronized across e-commerce platforms
 *    - Replicate data for backup/disaster recovery
 * 
 * 3. **Data Migration**
 *    - Move data from legacy systems to modern platforms
 *    - Consolidate data from multiple sources
 *    - Split monolithic databases into microservices
 * 
 * @see https://airbyte.com/
 * @see https://docs.fivetran.com/
 * @see https://nifi.apache.org/
 * 
 * @example
 * ```typescript
 * const salesforceToDB: ETLPipeline = {
 *   name: 'salesforce_to_postgres',
 *   label: 'Salesforce Accounts to PostgreSQL',
 *   source: {
 *     type: 'api',
 *     connector: 'salesforce',
 *     config: { object: 'Account' }
 *   },
 *   destination: {
 *     type: 'database',
 *     connector: 'postgres',
 *     config: { table: 'accounts' }
 *   },
 *   transformations: [
 *     { type: 'map', config: { 'Name': 'account_name' } }
 *   ],
 *   schedule: '0 2 * * *' // Daily at 2 AM
 * }
 * ```
 */

/**
 * ETL Source/Destination Type
 */
import { lazySchema } from '../shared/lazy-schema';
export const ETLEndpointTypeSchema = lazySchema(() => z.enum([
  'database',    // SQL/NoSQL databases
  'api',         // REST/GraphQL APIs
  'file',        // CSV, JSON, XML, Excel files
  'stream',      // Kafka, RabbitMQ, Kinesis
  'object',      // ObjectStack object
  'warehouse',   // Data warehouse (Snowflake, BigQuery, Redshift)
  'storage',     // S3, Azure Blob, Google Cloud Storage
  'spreadsheet', // Google Sheets, Excel Online
]));

export type ETLEndpointType = z.infer<typeof ETLEndpointTypeSchema>;

/**
 * ETL Source Configuration
 */
export const ETLSourceSchema = lazySchema(() => z.object({
  /**
   * Source type
   */
  type: ETLEndpointTypeSchema.describe('Source type'),

  /**
   * Connector identifier
   * References a registered connector
   * 
   * @example "salesforce", "postgres", "mysql", "s3"
   */
  connector: z.string().optional().describe('Connector ID'),

  /**
   * Source-specific configuration
   * Structure varies by source type
   * 
   * @example For database: { table: 'customers', schema: 'public' }
   * @example For API: { endpoint: '/api/users', method: 'GET' }
   * @example For file: { path: 's3://bucket/data.csv', format: 'csv' }
   */
  config: z.record(z.string(), z.unknown()).describe('Source configuration'),

  /**
   * Incremental sync configuration
   * Allows extracting only changed data
   */
  incremental: z.object({
    enabled: z.boolean().default(false),
    cursorField: z.string().describe('Field to track progress (e.g., updated_at)'),
    cursorValue: z.unknown().optional().describe('Last processed value'),
  }).optional().describe('Incremental extraction config'),
}));

export type ETLSource = z.infer<typeof ETLSourceSchema>;

/**
 * ETL Destination Configuration
 */
export const ETLDestinationSchema = lazySchema(() => z.object({
  /**
   * Destination type
   */
  type: ETLEndpointTypeSchema.describe('Destination type'),

  /**
   * Connector identifier
   */
  connector: z.string().optional().describe('Connector ID'),

  /**
   * Destination-specific configuration
   */
  config: z.record(z.string(), z.unknown()).describe('Destination configuration'),

  /**
   * Write mode
   */
  writeMode: z.enum([
    'append',      // Add new records
    'overwrite',   // Replace all data
    'upsert',      // Insert or update based on key
    'merge',       // Smart merge based on business rules
  ]).default('append').describe('How to write data'),

  /**
   * Primary key fields for upsert/merge
   */
  primaryKey: z.array(z.string()).optional().describe('Primary key fields'),
}));

export type ETLDestination = z.infer<typeof ETLDestinationSchema>;

/**
 * ETL Transformation Type
 */
export const ETLTransformationTypeSchema = lazySchema(() => z.enum([
  'map',         // Field mapping/renaming
  'filter',      // Row filtering
  'aggregate',   // Aggregation/grouping
  'join',        // Joining with other data
  'script',      // Custom JavaScript/Python script
  'lookup',      // Enrich with lookup data
  'split',       // Split one record into multiple
  'merge',       // Merge multiple records into one
  'normalize',   // Data normalization
  'deduplicate', // Remove duplicates
]));

export type ETLTransformationType = z.infer<typeof ETLTransformationTypeSchema>;

/**
 * ETL Transformation Configuration
 */
export const ETLTransformationSchema = lazySchema(() => z.object({
  /**
   * Transformation name
   */
  name: z.string().optional().describe('Transformation name'),

  /**
   * Transformation type
   */
  type: ETLTransformationTypeSchema.describe('Transformation type'),

  /**
   * Transformation-specific configuration
   * 
   * @example For map: { oldField: 'newField' }
   * @example For filter: { condition: 'status == "active"' }
   * @example For script: { language: 'javascript', code: '...' }
   */
  config: z.record(z.string(), z.unknown()).describe('Transformation config'),

  /**
   * Whether to continue on error
   */
  continueOnError: z.boolean().default(false).describe('Continue on error'),
}));

export type ETLTransformation = z.infer<typeof ETLTransformationSchema>;

/**
 * ETL Sync Mode
 */
export const ETLSyncModeSchema = lazySchema(() => z.enum([
  'full',        // Full refresh - extract all data every time
  'incremental', // Only extract changed data
  'cdc',         // Change Data Capture - real-time streaming
]));

export type ETLSyncMode = z.infer<typeof ETLSyncModeSchema>;

/**
 * ETL Pipeline Schema
 * 
 * Complete definition of a data pipeline from source to destination with transformations.
 */
export const ETLPipelineSchema = lazySchema(() => z.object({
  /**
   * Pipeline identifier (snake_case)
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Pipeline identifier (snake_case)'),

  /**
   * Human-readable pipeline name
   */
  label: z.string().optional().describe('Pipeline display name'),

  /**
   * Pipeline description
   */
  description: z.string().optional().describe('Pipeline description'),

  /**
   * Data source configuration
   */
  source: ETLSourceSchema.describe('Data source'),

  /**
   * Data destination configuration
   */
  destination: ETLDestinationSchema.describe('Data destination'),

  /**
   * Transformation steps
   * Applied in order from source to destination
   */
  transformations: z.array(ETLTransformationSchema)
    .optional()
    .describe('Transformation pipeline'),

  /**
   * Sync mode
   */
  syncMode: ETLSyncModeSchema.default('full').describe('Sync mode'),

  /**
   * Execution schedule (cron expression)
   * 
   * @example "0 2 * * *" - Daily at 2 AM
   * @example "0 *\/4 * * *" - Every 4 hours
   * @example "0 0 * * 0" - Weekly on Sunday
   */
  schedule: CronExpressionInputSchema.optional().describe('Cron schedule expression'),

  /**
   * Whether pipeline is enabled
   */
  enabled: z.boolean().default(true).describe('Pipeline enabled status'),

  /**
   * Retry configuration for failed runs
   */
  retry: z.object({
    maxAttempts: z.number().int().min(0).default(3).describe('Max retry attempts'),
    backoffMs: z.number().int().min(0).default(60000).describe('Backoff in milliseconds'),
  }).optional().describe('Retry configuration'),

  /**
   * Notification configuration
   */
  notifications: z.object({
    onSuccess: z.array(z.string()).optional().describe('Email addresses for success notifications'),
    onFailure: z.array(z.string()).optional().describe('Email addresses for failure notifications'),
  }).optional().describe('Notification settings'),

  /**
   * Pipeline tags for organization
   */
  tags: z.array(z.string()).optional().describe('Pipeline tags'),

  /**
   * Custom metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata'),
}));

export type ETLPipeline = z.infer<typeof ETLPipelineSchema>;

/**
 * ETL Run Status
 */
export const ETLRunStatusSchema = lazySchema(() => z.enum([
  'pending',    // Queued for execution
  'running',    // Currently executing
  'succeeded',  // Completed successfully
  'failed',     // Failed with errors
  'cancelled',  // Manually cancelled
  'timeout',    // Timed out
]));

export type ETLRunStatus = z.infer<typeof ETLRunStatusSchema>;

/**
 * ETL Pipeline Run Result
 * 
 * Result of a pipeline execution
 */
export const ETLPipelineRunSchema = lazySchema(() => z.object({
  /**
   * Run ID
   */
  id: z.string().describe('Run identifier'),

  /**
   * Pipeline name
   */
  pipelineName: z.string().describe('Pipeline name'),

  /**
   * Run status
   */
  status: ETLRunStatusSchema.describe('Run status'),

  /**
   * Start timestamp
   */
  startedAt: z.string().datetime().describe('Start time'),

  /**
   * End timestamp
   */
  completedAt: z.string().datetime().optional().describe('Completion time'),

  /**
   * Duration in milliseconds
   */
  durationMs: z.number().optional().describe('Duration in ms'),

  /**
   * Statistics
   */
  stats: z.object({
    recordsRead: z.number().int().default(0).describe('Records extracted'),
    recordsWritten: z.number().int().default(0).describe('Records loaded'),
    recordsErrored: z.number().int().default(0).describe('Records with errors'),
    bytesProcessed: z.number().int().default(0).describe('Bytes processed'),
  }).optional().describe('Run statistics'),

  /**
   * Error information
   */
  error: z.object({
    message: z.string().describe('Error message'),
    code: z.string().optional().describe('Error code'),
    details: z.unknown().optional().describe('Error details'),
  }).optional().describe('Error information'),

  /**
   * Execution logs
   */
  logs: z.array(z.string()).optional().describe('Execution logs'),
}));

export type ETLPipelineRun = z.infer<typeof ETLPipelineRunSchema>;

/**
 * Helper factory for creating ETL pipelines
 */
export const ETL = {
  /**
   * Create a simple database-to-database pipeline
   */
  databaseSync: (params: {
    name: string;
    sourceTable: string;
    destTable: string;
    schedule?: import("../shared/expression.zod").CronExpressionInput;
  }): ETLPipeline => ({
    name: params.name,
    source: {
      type: 'database',
      config: { table: params.sourceTable },
    },
    destination: {
      type: 'database',
      config: { table: params.destTable },
      writeMode: 'upsert',
    },
    syncMode: 'incremental',
    schedule: typeof params.schedule === 'string' ? { dialect: 'cron', source: params.schedule } : params.schedule,
    enabled: true,
  }),

  /**
   * Create an API to database pipeline
   */
  apiToDatabase: (params: {
    name: string;
    apiConnector: string;
    destTable: string;
    schedule?: import("../shared/expression.zod").CronExpressionInput;
  }): ETLPipeline => ({
    name: params.name,
    source: {
      type: 'api',
      connector: params.apiConnector,
      config: {},
    },
    destination: {
      type: 'database',
      config: { table: params.destTable },
      writeMode: 'append',
    },
    syncMode: 'full',
    schedule: typeof params.schedule === 'string' ? { dialect: 'cron', source: params.schedule } : params.schedule,
    enabled: true,
  }),
} as const;
