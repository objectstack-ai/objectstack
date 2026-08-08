// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Tenant Schema (Multi-Tenant Architecture)
 * 
 * Defines the tenant/tenancy model for ObjectStack SaaS deployments.
 * Supports different levels of data isolation to meet varying security,
 * performance, and compliance requirements.
 * 
 * Isolation Levels:
 * - shared_schema: All tenants share the same database and schema (row-level isolation)
 * - isolated_schema: Tenants have separate schemas within a shared database
 * - isolated_db: Each tenant has a completely separate database
 */

/**
 * Tenant Isolation Level Enum
 * Defines how tenant data is separated in the system
 */
import { lazySchema } from '../shared/lazy-schema';
export const TenantIsolationLevel = z.enum([
  'shared_schema',    // Shared DB, shared schema, row-level isolation (most economical)
  'isolated_schema',  // Shared DB, separate schema per tenant (balanced)
  'isolated_db',      // Separate database per tenant (maximum isolation)
]);

export type TenantIsolationLevel = z.input<typeof TenantIsolationLevel>;

/**
 * Database Provider Enum
 * Defines which database backend is used for the tenant
 */
export const DatabaseProviderSchema = lazySchema(() => z.enum([
  'turso',     // Turso/libSQL (DB-per-Tenant, edge-native)
  'postgres',  // PostgreSQL (traditional, self-hosted or managed)
  'memory',    // In-memory (testing/development only)
]).describe('Database provider for tenant data'));

export type DatabaseProvider = z.input<typeof DatabaseProviderSchema>;

/**
 * Tenant Connection Config Schema
 * Stores the database connection details for a tenant (encrypted at rest)
 */
export const TenantConnectionConfigSchema = lazySchema(() => z.object({
  /** Database connection URL */
  url: z.string().min(1).describe('Database connection URL'),
  /** Authentication token (JWT for Turso, password for Postgres) */
  authToken: z.string().optional().describe('Database auth token (encrypted at rest)'),
  /** Turso database group name */
  group: z.string().optional().describe('Turso database group name'),
}).describe('Tenant database connection configuration'));

export type TenantConnectionConfig = z.input<typeof TenantConnectionConfigSchema>;

/**
 * Tenant Quota Schema
 * Defines resource limits and usage quotas for a tenant
 */
export const TenantQuotaSchema = lazySchema(() => z.object({
  /**
   * Maximum number of users allowed for this tenant
   */
  maxUsers: z.number().int().positive().optional().describe('Maximum number of users'),
  
  /**
   * Maximum storage space in bytes
   */
  maxStorage: z.number().int().positive().optional().describe('Maximum storage in bytes'),
  
  /**
   * API rate limit (requests per minute)
   */
  apiRateLimit: z.number().int().positive().optional().describe('API requests per minute'),

  /**
   * Maximum number of custom objects the tenant can create
   */
  maxObjects: z.number().int().positive().optional().describe('Maximum number of custom objects'),

  /**
   * Maximum records per object/table
   */
  maxRecordsPerObject: z.number().int().positive().optional().describe('Maximum records per object'),

  /**
   * Maximum deployments allowed per day
   */
  maxDeploymentsPerDay: z.number().int().positive().optional().describe('Maximum deployments per day'),

  /**
   * Maximum storage in bytes
   */
  maxStorageBytes: z.number().int().positive().optional().describe('Maximum storage in bytes'),
}));

export type TenantQuota = z.input<typeof TenantQuotaSchema>;

/**
 * Tenant Usage Schema
 * Tracks current resource usage for quota enforcement
 */
export const TenantUsageSchema = lazySchema(() => z.object({
  /** Current number of custom objects */
  currentObjectCount: z.number().int().min(0).default(0).describe('Current number of custom objects'),
  /** Current total record count across all objects */
  currentRecordCount: z.number().int().min(0).default(0).describe('Total records across all objects'),
  /** Current storage usage in bytes */
  currentStorageBytes: z.number().int().min(0).default(0).describe('Current storage usage in bytes'),
  /** Deployments executed today */
  deploymentsToday: z.number().int().min(0).default(0).describe('Deployments executed today'),
  /** Current number of active users */
  currentUsers: z.number().int().min(0).default(0).describe('Current number of active users'),
  /** API requests in the current minute */
  apiRequestsThisMinute: z.number().int().min(0).default(0).describe('API requests in the current minute'),
  /** Last updated timestamp (ISO 8601) */
  lastUpdatedAt: z.string().datetime().optional().describe('Last usage update time'),
}).describe('Current tenant resource usage'));

export type TenantUsage = z.input<typeof TenantUsageSchema>;
/** Post-parse shape of {@link TenantUsage} — defaults applied, transforms run (ADR-0122). */
export type TenantUsageParsed = z.infer<typeof TenantUsageSchema>;

/**
 * Quota Enforcement Result
 * Result of checking whether an operation would exceed tenant quotas
 */
export const QuotaEnforcementResultSchema = lazySchema(() => z.object({
  /** Whether the operation is allowed */
  allowed: z.boolean().describe('Whether the operation is within quota'),
  /** Quota that would be exceeded (if not allowed) */
  exceededQuota: z.string().optional().describe('Name of the exceeded quota'),
  /** Current usage value */
  currentUsage: z.number().optional().describe('Current usage value'),
  /** Quota limit value */
  limit: z.number().optional().describe('Quota limit'),
  /** Human-readable message */
  message: z.string().optional().describe('Human-readable quota message'),
}).describe('Quota enforcement check result'));

export type QuotaEnforcementResult = z.input<typeof QuotaEnforcementResultSchema>;

/**
 * Tenant Schema
 * 
 * @deprecated This schema is maintained for backward compatibility only.
 * New implementations should use HubSpaceSchema which embeds tenant concepts.
 * 
 * **Migration Guide:**
 * ```typescript
 * // Old approach (deprecated):
 * const tenant: Tenant = {
 *   id: 'tenant_123',
 *   name: 'My Tenant',
 *   isolationLevel: 'shared_schema',
 *   quotas: { maxUsers: 100 }
 * };
 * 
 * // New approach (recommended):
 * const space: HubSpace = {
 *   id: '...uuid...',
 *   name: 'My Tenant',
 *   slug: 'my-tenant',
 *   ownerId: 'user_id',
 *   runtime: {
 *     isolation: 'shared_schema',
 *     quotas: { maxUsers: 100 }
 *   },
 *   bom: { ... }
 * };
 * ```
 * 
 * See HubSpaceSchema in space.zod.ts for the recommended approach.
 */
export const TenantSchema = lazySchema(() => z.object({
  /**
   * Unique tenant identifier
   */
  id: z.string().describe('Unique tenant identifier'),
  
  /**
   * Tenant display name
   */
  name: z.string().describe('Tenant display name'),
  
  /**
   * Data isolation level
   */
  isolationLevel: TenantIsolationLevel,

  /**
   * Database provider for this tenant
   */
  databaseProvider: DatabaseProviderSchema.optional().describe('Database provider'),

  /**
   * Database connection configuration (encrypted at rest)
   */
  connectionConfig: TenantConnectionConfigSchema.optional().describe('Database connection config'),

  /**
   * Current provisioning status
   */
  provisioningStatus: z.enum([
    'provisioning', 'active', 'suspended', 'failed', 'destroying',
  ]).optional().describe('Current provisioning lifecycle status'),

  /**
   * Tenant subscription plan
   */
  plan: z.enum(['free', 'pro', 'enterprise']).optional().describe('Subscription plan'),
  
  /**
   * Custom configuration values
   */
  customizations: z.record(z.string(), z.unknown()).optional().describe('Custom configuration values'),
  
  /**
   * Resource quotas
   */
  quotas: TenantQuotaSchema.optional(),
}));

export type Tenant = z.input<typeof TenantSchema>;

/**
 * Tenant Isolation Strategy Documentation
 * 
 * Comprehensive documentation of three isolation strategies for multi-tenant systems.
 * Each strategy has different trade-offs in terms of security, cost, complexity, and compliance.
 */

/**
 * Row-Level Isolation Strategy (shared_schema)
 * 
 * Recommended for: Most SaaS applications, cost-sensitive deployments
 * 
 * IMPLEMENTATION:
 * - All tenants share the same database and schema
 * - Each table includes a tenant_id column
 * - PostgreSQL Row-Level Security (RLS) enforces isolation
 * - Queries automatically filter by tenant_id via RLS policies
 * 
 * ADVANTAGES:
 * ✅ Simple backup and restore (single database)
 * ✅ Cost-effective (shared resources, minimal overhead)
 * ✅ Easy tenant migration (update tenant_id)
 * ✅ Efficient resource utilization (connection pooling)
 * ✅ Simple schema migrations (single schema to update)
 * ✅ Lower operational complexity
 * 
 * DISADVANTAGES:
 * ❌ RLS misconfiguration can lead to data leakage
 * ❌ Performance impact from RLS policy evaluation
 * ❌ Noisy neighbor problem (one tenant can affect others)
 * ❌ Cannot easily isolate tenant to different hardware
 * ❌ Compliance challenges for regulated industries
 * 
 * SECURITY CONSIDERATIONS:
 * - Requires careful RLS policy configuration
 * - Must validate tenant_id in all queries
 * - Need comprehensive testing of RLS policies
 * - Audit all database access patterns
 * - Implement application-level validation as defense-in-depth
 * 
 * EXAMPLE RLS POLICY (PostgreSQL):
 * ```sql
 * -- Example: Apply RLS policy to a table (e.g., "app_data")
 * CREATE POLICY tenant_isolation ON app_data
 *   USING (tenant_id = current_setting('app.current_tenant')::text);
 * 
 * ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
 * ```
 */
export const RowLevelIsolationStrategySchema = lazySchema(() => z.object({
  strategy: z.literal('shared_schema').describe('Row-level isolation strategy'),
  
  /**
   * Database configuration for row-level isolation
   */
  database: z.object({
    /**
     * Whether to enable Row-Level Security (RLS)
     */
    enableRLS: z.boolean().default(true).describe('Enable PostgreSQL Row-Level Security'),
    
    /**
     * Tenant context setting method
     */
    contextMethod: z.enum([
      'session_variable',  // SET app.current_tenant = 'tenant_123'
      'search_path',       // SET search_path = tenant_123, public
      'application_name',  // SET application_name = 'tenant_123'
    ]).default('session_variable').describe('How to set tenant context'),
    
    /**
     * Session variable name for tenant context
     */
    contextVariable: z.string().default('app.current_tenant').describe('Session variable name'),
    
    /**
     * Whether to validate tenant_id at application level
     */
    applicationValidation: z.boolean().default(true).describe('Application-level tenant validation'),
  }).optional().describe('Database configuration'),
  
  /**
   * Performance optimization settings
   */
  performance: z.object({
    /**
     * Whether to use partial indexes for tenant_id
     */
    usePartialIndexes: z.boolean().default(true).describe('Use partial indexes per tenant'),
    
    /**
     * Whether to use table partitioning
     */
    usePartitioning: z.boolean().default(false).describe('Use table partitioning by tenant_id'),
    
    /**
     * Connection pool size per tenant
     */
    poolSizePerTenant: z.number().int().positive().optional().describe('Connection pool size per tenant'),
  }).optional().describe('Performance settings'),
}));

export type RowLevelIsolationStrategy = z.input<typeof RowLevelIsolationStrategySchema>;
/** Post-parse shape of {@link RowLevelIsolationStrategy} — defaults applied, transforms run (ADR-0122). */
export type RowLevelIsolationStrategyParsed = z.infer<typeof RowLevelIsolationStrategySchema>;

/**
 * Schema-Level Isolation Strategy (isolated_schema)
 * 
 * Recommended for: Enterprise SaaS, B2B platforms with compliance needs
 * 
 * IMPLEMENTATION:
 * - All tenants share the same database server
 * - Each tenant has a separate database schema
 * - Schema name typically: tenant_<tenant_id>
 * - Application switches schema using SET search_path
 * 
 * ADVANTAGES:
 * ✅ Better isolation than row-level (schema boundaries)
 * ✅ Easier to debug (separate schemas)
 * ✅ Can grant different database permissions per schema
 * ✅ Reduced risk of data leakage
 * ✅ Performance isolation (indexes, statistics per schema)
 * ✅ Simplified queries (no tenant_id filtering needed)
 * 
 * DISADVANTAGES:
 * ❌ More complex backups (must backup all schemas)
 * ❌ Higher migration costs (schema changes across all tenants)
 * ❌ Schema proliferation (PostgreSQL has limits)
 * ❌ Connection overhead (switching schemas)
 * ❌ More complex monitoring and maintenance
 * 
 * SECURITY CONSIDERATIONS:
 * - Ensure proper schema permissions (GRANT USAGE ON SCHEMA)
 * - Validate schema name to prevent SQL injection
 * - Implement connection-level schema switching
 * - Audit schema access patterns
 * - Prevent cross-schema queries in application
 * 
 * EXAMPLE IMPLEMENTATION (PostgreSQL):
 * ```sql
 * -- Create tenant schema
 * CREATE SCHEMA tenant_123;
 * 
 * -- Grant access
 * GRANT USAGE ON SCHEMA tenant_123 TO app_user;
 * 
 * -- Switch to tenant schema
 * SET search_path TO tenant_123, public;
 * ```
 */
export const SchemaLevelIsolationStrategySchema = lazySchema(() => z.object({
  strategy: z.literal('isolated_schema').describe('Schema-level isolation strategy'),
  
  /**
   * Schema configuration
   */
  schema: z.object({
    /**
     * Schema naming pattern
     * Use {tenant_id} as placeholder (must contain only alphanumeric and underscores)
     * The tenant_id will be sanitized before substitution to prevent SQL injection
     */
    namingPattern: z.string().default('tenant_{tenant_id}').describe('Schema naming pattern'),
    
    /**
     * Whether to include public schema in search_path
     */
    includePublicSchema: z.boolean().default(true).describe('Include public schema'),
    
    /**
     * Default schema for shared resources
     */
    sharedSchema: z.string().default('public').describe('Schema for shared resources'),
    
    /**
     * Whether to automatically create schema on tenant creation
     */
    autoCreateSchema: z.boolean().default(true).describe('Auto-create schema'),
  }).optional().describe('Schema configuration'),
  
  /**
   * Migration configuration
   */
  migrations: z.object({
    /**
     * Migration strategy
     */
    strategy: z.enum([
      'parallel',      // Run migrations on all schemas in parallel
      'sequential',    // Run migrations one schema at a time
      'on_demand',     // Run migrations when tenant accesses system
    ]).default('parallel').describe('Migration strategy'),
    
    /**
     * Maximum concurrent migrations
     */
    maxConcurrent: z.number().int().positive().default(10).describe('Max concurrent migrations'),
    
    /**
     * Whether to rollback on first failure
     */
    rollbackOnError: z.boolean().default(true).describe('Rollback on error'),
  }).optional().describe('Migration configuration'),
  
  /**
   * Performance optimization settings
   */
  performance: z.object({
    /**
     * Whether to use connection pooling per schema
     */
    poolPerSchema: z.boolean().default(false).describe('Separate pool per schema'),
    
    /**
     * Schema cache TTL in seconds
     */
    schemaCacheTTL: z.number().int().positive().default(3600).describe('Schema cache TTL'),
  }).optional().describe('Performance settings'),
}));

export type SchemaLevelIsolationStrategy = z.input<typeof SchemaLevelIsolationStrategySchema>;
/** Post-parse shape of {@link SchemaLevelIsolationStrategy} — defaults applied, transforms run (ADR-0122). */
export type SchemaLevelIsolationStrategyParsed = z.infer<typeof SchemaLevelIsolationStrategySchema>;

/**
 * Database-Level Isolation Strategy (isolated_db)
 * 
 * Recommended for: Regulated industries (healthcare, finance), strict compliance requirements
 * 
 * IMPLEMENTATION:
 * - Each tenant has a completely separate database
 * - Database name typically: tenant_<tenant_id>
 * - Requires separate connection pool per tenant
 * - Complete physical and logical isolation
 * 
 * ADVANTAGES:
 * ✅ Perfect data isolation (strongest security)
 * ✅ Meets strict regulatory requirements (HIPAA, SOX, PCI-DSS)
 * ✅ Complete performance isolation (no noisy neighbors)
 * ✅ Can place databases on different hardware
 * ✅ Easy to backup/restore individual tenant
 * ✅ Simplified compliance auditing per tenant
 * ✅ Can apply different encryption keys per database
 * 
 * DISADVANTAGES:
 * ❌ Most expensive option (resource overhead)
 * ❌ Complex database server management (many databases)
 * ❌ Connection pool limits (max connections per server)
 * ❌ Difficult cross-tenant analytics
 * ❌ Higher operational complexity
 * ❌ Schema migrations take longer (many databases)
 * 
 * SECURITY CONSIDERATIONS:
 * - Each database can have separate credentials
 * - Enables per-tenant encryption at rest
 * - Simplifies compliance and audit trails
 * - Prevents any cross-tenant data access
 * - Supports tenant-specific backup schedules
 * 
 * EXAMPLE IMPLEMENTATION (PostgreSQL):
 * ```sql
 * -- Create tenant database
 * CREATE DATABASE tenant_123
 *   WITH OWNER = tenant_123_user
 *   ENCODING = 'UTF8'
 *   LC_COLLATE = 'en_US.UTF-8'
 *   LC_CTYPE = 'en_US.UTF-8';
 * 
 * -- Connect to tenant database
 * \c tenant_123
 * ```
 */
export const DatabaseLevelIsolationStrategySchema = lazySchema(() => z.object({
  strategy: z.literal('isolated_db').describe('Database-level isolation strategy'),
  
  /**
   * Database configuration
   */
  database: z.object({
    /**
     * Database naming pattern
     * Use {tenant_id} as placeholder (must contain only alphanumeric and underscores)
     * The tenant_id will be sanitized before substitution to prevent SQL injection
     */
    namingPattern: z.string().default('tenant_{tenant_id}').describe('Database naming pattern'),
    
    /**
     * Database server/cluster assignment strategy
     */
    serverStrategy: z.enum([
      'shared',        // All tenant databases on same server
      'sharded',       // Tenant databases distributed across servers
      'dedicated',     // Each tenant gets dedicated server (enterprise)
    ]).default('shared').describe('Server assignment strategy'),
    
    /**
     * Whether to use separate credentials per tenant
     */
    separateCredentials: z.boolean().default(true).describe('Separate credentials per tenant'),
    
    /**
     * Whether to automatically create database on tenant creation
     */
    autoCreateDatabase: z.boolean().default(true).describe('Auto-create database'),
  }).optional().describe('Database configuration'),
  
  /**
   * Connection pooling configuration
   */
  connectionPool: z.object({
    /**
     * Pool size per tenant database
     */
    poolSize: z.number().int().positive().default(10).describe('Connection pool size'),
    
    /**
     * Maximum number of tenant pools to keep active
     */
    maxActivePools: z.number().int().positive().default(100).describe('Max active pools'),
    
    /**
     * Idle pool timeout in seconds
     */
    idleTimeout: z.number().int().positive().default(300).describe('Idle pool timeout'),
    
    /**
     * Whether to use connection pooler (PgBouncer, etc.)
     */
    usePooler: z.boolean().default(true).describe('Use connection pooler'),
  }).optional().describe('Connection pool configuration'),
  
  /**
   * Backup and restore configuration
   */
  backup: z.object({
    /**
     * Backup strategy per tenant
     */
    strategy: z.enum([
      'individual',    // Separate backup per tenant
      'consolidated',  // Combined backup with all tenants
      'on_demand',     // Backup only when requested
    ]).default('individual').describe('Backup strategy'),
    
    /**
     * Backup frequency in hours
     */
    frequencyHours: z.number().int().positive().default(24).describe('Backup frequency'),
    
    /**
     * Retention period in days
     */
    retentionDays: z.number().int().positive().default(30).describe('Backup retention days'),
  }).optional().describe('Backup configuration'),
  
  /**
   * Encryption configuration
   */
  encryption: z.object({
    /**
     * Whether to use per-tenant encryption keys
     */
    perTenantKeys: z.boolean().default(false).describe('Per-tenant encryption keys'),
    
    /**
     * Encryption algorithm
     */
    algorithm: z.string().default('AES-256-GCM').describe('Encryption algorithm'),
    
    /**
     * Key management service
     */
    keyManagement: z.enum(['aws_kms', 'azure_key_vault', 'gcp_kms', 'hashicorp_vault', 'custom']).optional().describe('Key management service'),
  }).optional().describe('Encryption configuration'),
}));

export type DatabaseLevelIsolationStrategy = z.input<typeof DatabaseLevelIsolationStrategySchema>;
/** Post-parse shape of {@link DatabaseLevelIsolationStrategy} — defaults applied, transforms run (ADR-0122). */
export type DatabaseLevelIsolationStrategyParsed = z.infer<typeof DatabaseLevelIsolationStrategySchema>;

/**
 * Tenant Isolation Configuration Schema
 * 
 * Complete configuration for tenant isolation strategy.
 * Supports all three isolation levels with detailed configuration options.
 */
export const TenantIsolationConfigSchema = lazySchema(() => z.discriminatedUnion('strategy', [
  RowLevelIsolationStrategySchema,
  SchemaLevelIsolationStrategySchema,
  DatabaseLevelIsolationStrategySchema,
]));

export type TenantIsolationConfig = z.input<typeof TenantIsolationConfigSchema>;
/** Post-parse shape of {@link TenantIsolationConfig} — defaults applied, transforms run (ADR-0122). */
export type TenantIsolationConfigParsed = z.infer<typeof TenantIsolationConfigSchema>;

/**
 * Tenant Security Policy Schema
 * Defines security policies and compliance requirements for tenants
 */
export const TenantSecurityPolicySchema = lazySchema(() => z.object({
  /**
   * Encryption requirements
   */
  encryption: z.object({
    /**
     * Require encryption at rest
     */
    atRest: z.boolean().default(true).describe('Require encryption at rest'),
    
    /**
     * Require encryption in transit
     */
    inTransit: z.boolean().default(true).describe('Require encryption in transit'),
    
    /**
     * Require field-level encryption for sensitive data
     */
    fieldLevel: z.boolean().default(false).describe('Require field-level encryption'),
  }).optional().describe('Encryption requirements'),
  
  /**
   * Access control requirements
   */
  accessControl: z.object({
    /**
     * Require multi-factor authentication
     */
    requireMFA: z.boolean().default(false).describe('Require MFA'),
    
    /**
     * Require SSO/SAML authentication
     */
    requireSSO: z.boolean().default(false).describe('Require SSO'),
    
    /**
     * IP whitelist
     */
    ipWhitelist: z.array(z.string()).optional().describe('Allowed IP addresses'),
    
    /**
     * Session timeout in seconds
     */
    sessionTimeout: z.number().int().positive().default(3600).describe('Session timeout'),
  }).optional().describe('Access control requirements'),
  
  /**
   * Audit and compliance requirements
   */
  compliance: z.object({
    /**
     * Compliance standards to enforce
     */
    standards: z.array(z.enum([
      'sox',
      'hipaa',
      'gdpr',
      'pci_dss',
      'iso_27001',
      'fedramp',
    ])).optional().describe('Compliance standards'),
    
    /**
     * Require audit logging for all operations
     */
    requireAuditLog: z.boolean().default(true).describe('Require audit logging'),
    
    /**
     * Audit log retention period in days
     */
    auditRetentionDays: z.number().int().positive().default(365).describe('Audit retention days'),
    
    /**
     * Data residency requirements
     */
    dataResidency: z.object({
      /**
       * Required geographic region
       */
      region: z.string().optional().describe('Required region (e.g., US, EU, APAC)'),
      
      /**
       * Prohibited regions
       */
      excludeRegions: z.array(z.string()).optional().describe('Prohibited regions'),
    }).optional().describe('Data residency requirements'),
  }).optional().describe('Compliance requirements'),
}));

export type TenantSecurityPolicy = z.input<typeof TenantSecurityPolicySchema>;
/** Post-parse shape of {@link TenantSecurityPolicy} — defaults applied, transforms run (ADR-0122). */
export type TenantSecurityPolicyParsed = z.infer<typeof TenantSecurityPolicySchema>;
