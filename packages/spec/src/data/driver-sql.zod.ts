// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { DriverConfigSchema } from './driver.zod';

/**
 * SQL Dialect Enumeration
 * Supported SQL database dialects
 */
import { lazySchema } from '../shared/lazy-schema';
export const SQLDialectSchema = lazySchema(() => z.enum([
  'postgresql',
  'mysql',
  'sqlite',
  'mssql',
  'oracle',
  'mariadb',
]));

export type SQLDialect = z.input<typeof SQLDialectSchema>;

/**
 * Data Type Mapping Schema
 * Maps ObjectStack field types to SQL-specific data types
 * 
 * @example PostgreSQL data type mapping
 * {
 *   text: 'VARCHAR(255)',
 *   number: 'NUMERIC',
 *   boolean: 'BOOLEAN',
 *   date: 'DATE',
 *   datetime: 'TIMESTAMP',
 *   json: 'JSONB',
 *   uuid: 'UUID',
 *   binary: 'BYTEA'
 * }
 */
export const DataTypeMappingSchema = lazySchema(() => z.object({
  text: z.string().describe('SQL type for text fields (e.g., VARCHAR, TEXT)'),
  number: z.string().describe('SQL type for number fields (e.g., NUMERIC, DECIMAL, INT)'),
  boolean: z.string().describe('SQL type for boolean fields (e.g., BOOLEAN, BIT)'),
  date: z.string().describe('SQL type for date fields (e.g., DATE)'),
  datetime: z.string().describe('SQL type for datetime fields (e.g., TIMESTAMP, DATETIME)'),
  json: z.string().optional().describe('SQL type for JSON fields (e.g., JSON, JSONB)'),
  uuid: z.string().optional().describe('SQL type for UUID fields (e.g., UUID, CHAR(36))'),
  binary: z.string().optional().describe('SQL type for binary fields (e.g., BLOB, BYTEA)'),
}));

export type DataTypeMapping = z.input<typeof DataTypeMappingSchema>;

/**
 * SSL Configuration Schema
 * SSL/TLS connection configuration for secure database connections
 * 
 * @example PostgreSQL SSL configuration
 * {
 *   rejectUnauthorized: true,
 *   ca: '/path/to/ca-cert.pem',
 *   cert: '/path/to/client-cert.pem',
 *   key: '/path/to/client-key.pem'
 * }
 */
export const SSLConfigSchema = lazySchema(() => z.object({
  rejectUnauthorized: z.boolean().default(true).describe('Reject connections with invalid certificates'),
  ca: z.string().optional().describe('CA certificate file path or content'),
  cert: z.string().optional().describe('Client certificate file path or content'),
  key: z.string().optional().describe('Client private key file path or content'),
}).refine((data) => {
  // If cert is provided, key must also be provided, and vice versa
  const hasCert = data.cert !== undefined;
  const hasKey = data.key !== undefined;
  return hasCert === hasKey;
}, {
  message: 'Client certificate (cert) and private key (key) must be provided together',
}));

export type SSLConfig = z.input<typeof SSLConfigSchema>;
/** Post-parse shape of {@link SSLConfig} — defaults applied, transforms run (ADR-0122). */
export type SSLConfigParsed = z.infer<typeof SSLConfigSchema>;

/**
 * SQL Driver Configuration Schema
 * Extended driver configuration specific to SQL databases
 * 
 * @example PostgreSQL driver configuration
 * {
 *   name: 'primary-db',
 *   type: 'sql',
 *   dialect: 'postgresql',
 *   connectionString: 'postgresql://user:pass@localhost:5432/mydb',
 *   dataTypeMapping: {
 *     text: 'VARCHAR(255)',
 *     number: 'NUMERIC',
 *     boolean: 'BOOLEAN',
 *     date: 'DATE',
 *     datetime: 'TIMESTAMP',
 *     json: 'JSONB',
 *     uuid: 'UUID',
 *     binary: 'BYTEA'
 *   },
 *   ssl: true,
 *   sslConfig: {
 *     rejectUnauthorized: true,
 *     ca: '/etc/ssl/certs/ca.pem'
 *   },
 *   poolConfig: {
 *     min: 2,
 *     max: 10,
 *     idleTimeoutMillis: 30000,
 *     connectionTimeoutMillis: 5000
 *   },
 *   capabilities: {
 *     // Only the live bits remain authorable (#4634, ADR-0049) — everything a
 *     // driver "supports" beyond these is expressed by implementing the
 *     // corresponding IDataDriver method, not by declaring a boolean.
 *     queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true },
 *     autonumber: true,
 *     batchSchemaSync: false
 *   }
 * }
 */
export const SQLDriverConfigSchema = lazySchema(() => DriverConfigSchema.extend({
  type: z.literal('sql').describe('Driver type must be "sql"'),
  dialect: SQLDialectSchema.describe('SQL database dialect'),
  dataTypeMapping: DataTypeMappingSchema.describe('SQL data type mapping configuration'),
  ssl: z.boolean().default(false).describe('Enable SSL/TLS connection'),
  sslConfig: SSLConfigSchema.optional().describe('SSL/TLS configuration (required when ssl is true)'),
}).refine((data) => {
  // If ssl is enabled, sslConfig must be provided
  if (data.ssl && !data.sslConfig) {
    return false;
  }
  return true;
}, {
  message: 'sslConfig is required when ssl is true',
}));

export type SQLDriverConfig = z.input<typeof SQLDriverConfigSchema>;
/** Post-parse shape of {@link SQLDriverConfig} — defaults applied, transforms run (ADR-0122). */
export type SQLDriverConfigParsed = z.infer<typeof SQLDriverConfigSchema>;

// ==========================================================================
// SQLite-Specific Constants
// ==========================================================================

/**
 * Default data type mappings for SQLite/libSQL dialect.
 *
 * SQLite uses a simplified type system with type affinity:
 * - TEXT: strings, dates, UUIDs
 * - REAL: floating-point numbers
 * - INTEGER: integers, booleans
 * - BLOB: binary data
 *
 * @see https://www.sqlite.org/datatype3.html
 */
export const SQLiteDataTypeMappingDefaults: DataTypeMapping = {
  text: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  date: 'TEXT',
  datetime: 'TEXT',
  json: 'TEXT',
  uuid: 'TEXT',
  binary: 'BLOB',
};

/**
 * SQLite ALTER TABLE Limitations.
 *
 * SQLite has limited ALTER TABLE support compared to other SQL databases.
 * This constant documents the known limitations that affect migration planning.
 * The schema diff service must use the "table rebuild" strategy for operations
 * that SQLite cannot perform natively.
 *
 * @see https://www.sqlite.org/lang_altertable.html
 */
export const SQLiteAlterTableLimitations = {
  /** SQLite supports ADD COLUMN */
  supportsAddColumn: true,
  /** SQLite supports RENAME COLUMN (3.25.0+) */
  supportsRenameColumn: true,
  /** SQLite supports DROP COLUMN (3.35.0+) */
  supportsDropColumn: true,
  /** SQLite does NOT support MODIFY/ALTER COLUMN type */
  supportsModifyColumn: false,
  /** SQLite does NOT support adding constraints to existing columns */
  supportsAddConstraint: false,
  /**
   * When an unsupported alteration is needed, the migration planner
   * must use the 12-step table rebuild strategy:
   * 1. CREATE new table with desired schema
   * 2. Copy data from old table
   * 3. DROP old table
   * 4. RENAME new table to old name
   */
  rebuildStrategy: 'create_copy_drop_rename',
} as const;
