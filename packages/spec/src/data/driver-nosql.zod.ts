// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DriverConfigSchema } from './driver.zod';

/**
 * NoSQL Database Type Enumeration
 * Supported NoSQL database types
 */
import { lazySchema } from '../shared/lazy-schema';
export const NoSQLDatabaseTypeSchema = lazySchema(() => z.enum([
  'mongodb',
  'couchdb',
  'dynamodb',
  'cassandra',
  'redis',
  'elasticsearch',
  'neo4j',
  'orientdb',
]));

export type NoSQLDatabaseType = z.input<typeof NoSQLDatabaseTypeSchema>;

/**
 * NoSQL Query Operation Types
 * Different types of operations supported by NoSQL databases
 */
export const NoSQLOperationTypeSchema = lazySchema(() => z.enum([
  'find',           // Query documents/records
  'findOne',        // Get single document
  'insert',         // Insert document
  'update',         // Update document
  'delete',         // Delete document
  'aggregate',      // Aggregation pipeline
  'mapReduce',      // MapReduce operation
  'count',          // Count documents
  'distinct',       // Get distinct values
  'createIndex',    // Create index
  'dropIndex',      // Drop index
]));

export type NoSQLOperationType = z.input<typeof NoSQLOperationTypeSchema>;

/**
 * NoSQL Consistency Level
 * Consistency guarantees for distributed NoSQL databases
 * 
 * Consistency levels (from strongest to weakest):
 * - **all**: All replicas must respond (strongest consistency, lowest availability)
 * - **quorum**: Majority of replicas must respond (balanced)
 * - **one**: Any single replica responds (weakest consistency, highest availability)
 * - **local_quorum**: Majority of replicas in local datacenter
 * - **each_quorum**: Quorum of replicas in each datacenter
 * - **eventual**: Eventual consistency (highest availability, weakest consistency)
 */
export const ConsistencyLevelSchema = lazySchema(() => z.enum([
  'all',
  'quorum',
  'one',
  'local_quorum',
  'each_quorum',
  'eventual',
]));

export type ConsistencyLevel = z.input<typeof ConsistencyLevelSchema>;

/**
 * NoSQL Index Type
 * Types of indexes supported by NoSQL databases
 */
export const NoSQLIndexTypeSchema = lazySchema(() => z.enum([
  'single',         // Single field index
  'compound',       // Multiple fields index
  'unique',         // Unique constraint
  'text',           // Full-text search index
  'geospatial',     // Geospatial index (2d, 2dsphere)
  'hashed',         // Hashed index for sharding
  'ttl',            // Time-to-live index (auto-deletion)
  'sparse',         // Sparse index (only indexed documents with field)
]));

export type NoSQLIndexType = z.input<typeof NoSQLIndexTypeSchema>;

/**
 * NoSQL Sharding Configuration
 * Configuration for horizontal partitioning across multiple nodes
 */
export const ShardingConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable sharding'),
  shardKey: z.string().optional().describe('Field to use as shard key'),
  shardingStrategy: z.enum(['hash', 'range', 'zone']).optional().describe('Sharding strategy'),
  numShards: z.number().int().positive().optional().describe('Number of shards'),
}));

export type ShardingConfig = z.input<typeof ShardingConfigSchema>;
/** Post-parse shape of {@link ShardingConfig} — defaults applied, transforms run (ADR-0122). */
export type ShardingConfigParsed = z.infer<typeof ShardingConfigSchema>;

/**
 * NoSQL Replication Configuration
 * Configuration for data replication across nodes
 */
export const ReplicationConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable replication'),
  replicaSetName: z.string().optional().describe('Replica set name'),
  replicas: z.number().int().positive().optional().describe('Number of replicas'),
  readPreference: z.enum(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'])
    .optional()
    .describe('Read preference for replica set'),
  writeConcern: z.enum(['majority', 'acknowledged', 'unacknowledged'])
    .optional()
    .describe('Write concern level'),
}));

export type ReplicationConfig = z.input<typeof ReplicationConfigSchema>;
/** Post-parse shape of {@link ReplicationConfig} — defaults applied, transforms run (ADR-0122). */
export type ReplicationConfigParsed = z.infer<typeof ReplicationConfigSchema>;

/**
 * Document Schema Validation
 * Schema validation rules for document-based NoSQL databases
 */
export const DocumentSchemaValidationSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable schema validation'),
  validationLevel: z.enum(['strict', 'moderate', 'off']).optional().describe('Validation strictness'),
  validationAction: z.enum(['error', 'warn']).optional().describe('Action on validation failure'),
  jsonSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for validation'),
}));

export type DocumentSchemaValidation = z.input<typeof DocumentSchemaValidationSchema>;
/** Post-parse shape of {@link DocumentSchemaValidation} — defaults applied, transforms run (ADR-0122). */
export type DocumentSchemaValidationParsed = z.infer<typeof DocumentSchemaValidationSchema>;

/**
 * NoSQL Data Type Mapping Schema
 * Maps ObjectStack field types to NoSQL-specific data types
 * 
 * @example MongoDB data type mapping
 * {
 *   text: 'string',
 *   number: 'double',
 *   boolean: 'bool',
 *   date: 'date',
 *   datetime: 'date',
 *   json: 'object',
 *   uuid: 'string',
 *   binary: 'binData',
 *   array: 'array',
 *   objectId: 'objectId'
 * }
 */
export const NoSQLDataTypeMappingSchema = lazySchema(() => z.object({
  text: z.string().describe('NoSQL type for text fields'),
  number: z.string().describe('NoSQL type for number fields'),
  boolean: z.string().describe('NoSQL type for boolean fields'),
  date: z.string().describe('NoSQL type for date fields'),
  datetime: z.string().describe('NoSQL type for datetime fields'),
  json: z.string().optional().describe('NoSQL type for JSON/object fields'),
  uuid: z.string().optional().describe('NoSQL type for UUID fields'),
  binary: z.string().optional().describe('NoSQL type for binary fields'),
  array: z.string().optional().describe('NoSQL type for array fields'),
  objectId: z.string().optional().describe('NoSQL type for ObjectID fields (MongoDB)'),
  geopoint: z.string().optional().describe('NoSQL type for geospatial point fields'),
}));

export type NoSQLDataTypeMapping = z.input<typeof NoSQLDataTypeMappingSchema>;

/**
 * NoSQL Driver Configuration Schema
 * Extended driver configuration specific to NoSQL databases
 * 
 * @example MongoDB driver configuration
 * {
 *   name: 'primary-mongo',
 *   type: 'nosql',
 *   databaseType: 'mongodb',
 *   connectionString: 'mongodb://user:pass@localhost:27017/mydb',
 *   dataTypeMapping: {
 *     text: 'string',
 *     number: 'double',
 *     boolean: 'bool',
 *     date: 'date',
 *     datetime: 'date',
 *     json: 'object',
 *     uuid: 'string',
 *     binary: 'binData',
 *     array: 'array',
 *     objectId: 'objectId'
 *   },
 *   consistency: 'quorum',
 *   replication: {
 *     enabled: true,
 *     replicaSetName: 'rs0',
 *     replicas: 3,
 *     readPreference: 'primaryPreferred',
 *     writeConcern: 'majority'
 *   },
 *   sharding: {
 *     enabled: true,
 *     shardKey: '_id',
 *     shardingStrategy: 'hash',
 *     numShards: 4
 *   },
 *   capabilities: {
 *     // Only the live bits remain authorable (#4634, ADR-0049): MongoDB batches
 *     // its DDL round-trips, owns neither autonumber sequences nor native date
 *     // bucketing here. Everything else a driver "supports" is expressed by
 *     // implementing the corresponding IDataDriver method.
 *     batchSchemaSync: true
 *   }
 * }
 *
 * @example DynamoDB driver configuration
 * {
 *   name: 'dynamodb-main',
 *   type: 'nosql',
 *   databaseType: 'dynamodb',
 *   region: 'us-east-1',
 *   accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
 *   secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
 *   consistency: 'eventual',
 *   capabilities: {}
 * }
 */
export const NoSQLDriverConfigSchema = lazySchema(() => DriverConfigSchema.extend({
  type: z.literal('nosql').describe('Driver type must be "nosql"'),
  databaseType: NoSQLDatabaseTypeSchema.describe('Specific NoSQL database type'),
  dataTypeMapping: NoSQLDataTypeMappingSchema.describe('NoSQL data type mapping configuration'),
  
  /**
   * Consistency level for reads/writes
   */
  consistency: ConsistencyLevelSchema.optional().describe('Consistency level for operations'),
  
  /**
   * Replication configuration
   */
  replication: ReplicationConfigSchema.optional().describe('Replication configuration'),
  
  /**
   * Sharding configuration
   */
  sharding: ShardingConfigSchema.optional().describe('Sharding configuration'),
  
  /**
   * Schema validation rules (for document databases)
   */
  schemaValidation: DocumentSchemaValidationSchema.optional().describe('Document schema validation'),
  
  /**
   * AWS Region (for DynamoDB, DocumentDB, etc.)
   */
  region: z.string().optional().describe('AWS region (for managed NoSQL services)'),
  
  /**
   * AWS Access Key ID (for DynamoDB, DocumentDB, etc.)
   */
  accessKeyId: z.string().optional().describe('AWS access key ID'),
  
  /**
   * AWS Secret Access Key (for DynamoDB, DocumentDB, etc.)
   */
  secretAccessKey: z.string().optional().describe('AWS secret access key'),
  
  /**
   * Time-to-live (TTL) field name
   * Automatically delete documents after a specified time
   */
  ttlField: z.string().optional().describe('Field name for TTL (auto-deletion)'),
  
  /**
   * Maximum document size in bytes
   */
  maxDocumentSize: z.number().int().positive().optional().describe('Maximum document size in bytes'),
  
  /**
   * Collection/Table name prefix
   * Useful for multi-tenancy or environment isolation
   */
  collectionPrefix: z.string().optional().describe('Prefix for collection/table names'),
}));

export type NoSQLDriverConfig = z.input<typeof NoSQLDriverConfigSchema>;
/** Post-parse shape of {@link NoSQLDriverConfig} — defaults applied, transforms run (ADR-0122). */
export type NoSQLDriverConfigParsed = z.infer<typeof NoSQLDriverConfigSchema>;

/**
 * NoSQL Query Options
 * Additional options for NoSQL queries
 */
export const NoSQLQueryOptionsSchema = lazySchema(() => z.object({
  /**
   * Consistency level for this query
   */
  consistency: ConsistencyLevelSchema.optional().describe('Consistency level override'),
  
  /**
   * Read from secondary replicas
   */
  readFromSecondary: z.boolean().optional().describe('Allow reading from secondary replicas'),
  
  /**
   * Projection (fields to include/exclude)
   */
  projection: z.record(z.string(), z.union([z.literal(0), z.literal(1)])).optional().describe('Field projection'),
  
  /**
   * Query timeout in milliseconds
   */
  timeout: z.number().int().positive().optional().describe('Query timeout (ms)'),
  
  /**
   * Use cursor for large result sets
   */
  useCursor: z.boolean().optional().describe('Use cursor instead of loading all results'),
  
  /**
   * Batch size for cursor iteration
   */
  batchSize: z.number().int().positive().optional().describe('Cursor batch size'),
  
  /**
   * Enable query profiling
   */
  profile: z.boolean().optional().describe('Enable query profiling'),
  
  /**
   * Use hinted index
   */
  hint: z.string().optional().describe('Index hint for query optimization'),
}));

export type NoSQLQueryOptions = z.input<typeof NoSQLQueryOptionsSchema>;

/**
 * NoSQL Aggregation Pipeline Stage
 * Represents a single stage in an aggregation pipeline (MongoDB-style)
 */
export const AggregationStageSchema = lazySchema(() => z.object({
  /**
   * Stage operator (e.g., $match, $group, $sort, $project)
   */
  operator: z.string().describe('Aggregation operator (e.g., $match, $group, $sort)'),
  
  /**
   * Stage parameters/options
   */
  options: z.record(z.string(), z.unknown()).describe('Stage-specific options'),
}));

export type AggregationStage = z.input<typeof AggregationStageSchema>;

/**
 * NoSQL Aggregation Pipeline
 * Sequence of aggregation stages for complex data transformations
 */
export const AggregationPipelineSchema = lazySchema(() => z.object({
  /**
   * Collection/Table to aggregate
   */
  collection: z.string().describe('Collection/table name'),
  
  /**
   * Pipeline stages
   */
  stages: z.array(AggregationStageSchema).describe('Aggregation pipeline stages'),
  
  /**
   * Additional options
   */
  options: NoSQLQueryOptionsSchema.optional().describe('Query options'),
}));

export type AggregationPipeline = z.input<typeof AggregationPipelineSchema>;

/**
 * NoSQL Index Definition
 * Definition for creating indexes in NoSQL databases
 */
export const NoSQLIndexSchema = lazySchema(() => z.object({
  /**
   * Index name
   */
  name: z.string().describe('Index name'),
  
  /**
   * Index type
   */
  type: NoSQLIndexTypeSchema.describe('Index type'),
  
  /**
   * Fields to index
   * For compound indexes, order matters
   */
  fields: z.array(z.object({
    field: z.string().describe('Field name'),
    order: z.enum(['asc', 'desc', 'text', '2dsphere']).optional().describe('Index order or type'),
  })).describe('Fields to index'),
  
  /**
   * Unique constraint — a bare boolean, DELIBERATELY not the ADR-0120 scope
   * vocabulary (`UniqueScopeSchema`'s `boolean | 'global' | 'organization'`,
   * carried by `FieldSchema.unique` and `IndexSchema.unique`).
   *
   * This file is the raw NoSQL driver-configuration descriptor layer, not an
   * organization-aware authoring surface. Measured for #11215: nothing in the
   * repo parses `NoSQLIndexSchema` or materializes indexes from it (a leaf
   * schema — no runtime, kernel, or driver import), and the one NoSQL driver
   * that does create indexes (driver-mongodb's `syncCollectionSchema`)
   * consumes the object-level `indexes[]` surface — `IndexSchema`, which
   * already carries the scope vocabulary — and is explicitly single-tenant
   * (#3724), injecting no organization key part. The business boundary of a
   * unique constraint ('organization' vs 'global') is stated on those
   * authorable surfaces and resolved into physical key columns ABOVE this
   * layer; by the time a descriptor like this one reaches a NoSQL engine, the
   * organization key part — when there is one — is already a listed entry in
   * `fields`. A scope word here would have no consumer to honor it, which is
   * exactly the declarable-but-inert vocabulary ADR-0078 forbids. So the
   * asymmetry with the other two `unique` surfaces is deliberate, not drift.
   * If a NoSQL driver ever grows row-level tenancy and starts materializing
   * THIS shape against organization-scoped collections, adopt
   * `UniqueScopeSchema` here (import it — never fork the union) in the same
   * change.
   */
  unique: z.boolean().default(false).describe("Enforce uniqueness over exactly the listed `fields`. Boolean on purpose — no ADR-0120 scope vocabulary here: this is the raw driver-descriptor layer, below tenancy. The 'organization'/'global' boundary is stated on the authorable surfaces (FieldSchema.unique, IndexSchema.unique) and resolved into physical key columns before a descriptor like this is built, so an organization key part, when there is one, is already a listed field (#11215)"),
  
  /**
   * Sparse index (only index documents with the field)
   */
  sparse: z.boolean().default(false).describe('Sparse index'),
  
  /**
   * TTL in seconds (for TTL indexes)
   */
  expireAfterSeconds: z.number().int().positive().optional().describe('TTL in seconds'),
  
  /**
   * Partial index filter
   */
  partialFilterExpression: z.record(z.string(), z.unknown()).optional().describe('Partial index filter'),
  
  /**
   * Background index creation
   */
  background: z.boolean().default(false).describe('Create index in background'),
}));

export type NoSQLIndex = z.input<typeof NoSQLIndexSchema>;
/** Post-parse shape of {@link NoSQLIndex} — defaults applied, transforms run (ADR-0122). */
export type NoSQLIndexParsed = z.infer<typeof NoSQLIndexSchema>;

/**
 * NoSQL Transaction Options
 * Options for NoSQL transactions (where supported)
 */
export const NoSQLTransactionOptionsSchema = lazySchema(() => z.object({
  /**
   * Read concern level
   */
  readConcern: z.enum(['local', 'majority', 'linearizable', 'snapshot']).optional().describe('Read concern level'),
  
  /**
   * Write concern level
   */
  writeConcern: z.enum(['majority', 'acknowledged', 'unacknowledged']).optional().describe('Write concern level'),
  
  /**
   * Read preference
   */
  readPreference: z.enum(['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'])
    .optional()
    .describe('Read preference'),
  
  /**
   * Transaction timeout in milliseconds
   */
  maxCommitTimeMS: z.number().int().positive().optional().describe('Transaction commit timeout (ms)'),
}));

export type NoSQLTransactionOptions = z.input<typeof NoSQLTransactionOptionsSchema>;
