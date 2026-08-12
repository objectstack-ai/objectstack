// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Multi-Tenant Architecture Schema
 *
 * Defines the schema for managing multi-tenant architecture with:
 * - Global control plane: Single database for auth, org management, tenant registry
 * - Tenant data plane: Isolated databases per organization (UUID-based naming)
 *
 * Design decisions:
 * - Database naming: {uuid}.turso.io (not org-slug, since slugs can be modified)
 * - Each tenant has its own Turso database for complete data isolation
 * - Global database stores user auth, organizations, and tenant metadata
 */

/**
 * Tenant Database Status
 */
import { lazySchema } from '../shared/lazy-schema';
export const TenantDatabaseStatusSchema = lazySchema(() => z.enum([
  'provisioning',  // Database is being created
  'active',        // Database is active and accepting connections
  'suspended',     // Database is suspended (read-only or inaccessible)
  'archived',      // Database is archived (data preserved but not accessible)
  'failed',        // Provisioning or migration failed
]));

export type TenantDatabaseStatus = z.input<typeof TenantDatabaseStatusSchema>;

/**
 * Tenant Plan Identifier
 *
 * An **opaque** plan/tier identifier (ruling: cloud#1216, executed on the
 * spec side by objectstack#7513). The vocabulary — which strings exist, what
 * each one unlocks — is control-plane **config owned by the cloud
 * distribution**, not protocol: this schema does not enumerate it and never
 * has runtime knowledge of it. Widened from a closed 5-value enum
 * (`free`/`starter`/`pro`/`enterprise`/`custom`) after measuring that no
 * reader outside the cloud distribution branches on the value — framework
 * and console treat it as a pass-through string; only the cloud
 * distribution's own entitlement modules (e.g. `isFreePlan`,
 * `planAllowsAiStudio`) interpret specific values, and they own that
 * interpretation independently of this schema.
 *
 * Convention (not enforced here): an empty or unrecognized value is treated
 * as the free tier by cloud-side readers. Spec accepts any string, including
 * the empty one — the free-tier fallback is the cloud distribution's
 * normalization, not a spec-level default.
 */
export const TenantPlanSchema = lazySchema(() => z.string().describe(
  'Opaque plan/tier identifier. The vocabulary is control-plane config owned by the '
  + 'cloud distribution, not protocol — this schema accepts any string and does not '
  + 'enumerate valid values. Convention: an empty or unrecognized value is treated as '
  + 'the free tier by cloud-side readers (not enforced by this schema).',
));

export type TenantPlan = z.input<typeof TenantPlanSchema>;

/**
 * Tenant Database Registry Entry
 *
 * Tracks each tenant's dedicated database instance.
 * Stored in the global control plane database.
 *
 * @deprecated v4.x shim — superseded by the environment-per-database
 * isolation model introduced in v4.1. New code should use
 * {@link EnvironmentSchema} + {@link EnvironmentDatabaseSchema} +
 * {@link DatabaseCredentialSchema} from `./environment.zod`. This schema
 * (and the `sys_tenant_database` table) will be removed in v5.0.
 * See `docs/adr/0002-environment-database-isolation.md`.
 */
export const TenantDatabaseSchema = lazySchema(() => z.object({
  /**
   * Unique tenant database identifier (UUID)
   */
  id: z.string().uuid().describe('Unique tenant database identifier (UUID)'),

  /**
   * Organization ID (foreign key to sys_organization)
   */
  organizationId: z.string().describe('Organization ID (foreign key to sys_organization)'),

  /**
   * Database name (UUID-based for immutability)
   * Example: "550e8400-e29b-41d4-a716-446655440000"
   */
  databaseName: z.string().describe('Database name (UUID-based)'),

  /**
   * Full database URL
   * Example: "libsql://550e8400-e29b-41d4-a716-446655440000.turso.io"
   */
  databaseUrl: z.string().url().describe('Full database URL'),

  /**
   * Encrypted tenant-specific auth token
   */
  authToken: z.string().describe('Encrypted tenant-specific auth token'),

  /**
   * Database provisioning and runtime status
   */
  status: TenantDatabaseStatusSchema.default('provisioning').describe('Database status'),

  /**
   * Deployment region
   * Example: "us-east-1", "eu-west-1", "ap-southeast-1"
   */
  region: z.string().describe('Deployment region'),

  /**
   * Tenant plan tier
   */
  plan: TenantPlanSchema.default('free').describe('Tenant plan tier'),

  /**
   * Storage limit in megabytes
   */
  storageLimitMb: z.number().int().positive().describe('Storage limit in megabytes'),

  /**
   * Database creation timestamp
   */
  createdAt: z.string().datetime().describe('Database creation timestamp'),

  /**
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),

  /**
   * Last accessed timestamp (for usage tracking)
   */
  lastAccessedAt: z.string().datetime().optional().describe('Last accessed timestamp'),

  /**
   * Custom tenant configuration
   * Can store additional metadata like feature flags, quotas, etc.
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom tenant configuration'),
}));

export type TenantDatabase = z.input<typeof TenantDatabaseSchema>;
/** Post-parse shape of {@link TenantDatabase} — defaults applied, transforms run (ADR-0122). */
export type TenantDatabaseParsed = z.infer<typeof TenantDatabaseSchema>;

/**
 * Package Installation Status
 */
export const PackageInstallationStatusSchema = lazySchema(() => z.enum([
  'installing',    // Package is being installed
  'active',        // Package is active and running
  'disabled',      // Package is disabled (soft delete)
  'uninstalling',  // Package is being uninstalled
  'failed',        // Installation failed
]));

export type PackageInstallationStatus = z.input<typeof PackageInstallationStatusSchema>;

/**
 * Package Installation Record
 *
 * Tracks which packages are installed in which tenant.
 * Stored in the global control plane database.
 */
export const PackageInstallationSchema = lazySchema(() => z.object({
  /**
   * Unique installation identifier
   */
  id: z.string().uuid().describe('Unique installation identifier'),

  /**
   * Tenant database ID (foreign key to tenant_database)
   */
  tenantId: z.string().uuid().describe('Tenant database ID'),

  /**
   * Package identifier
   * Example: "@objectstack/crm", "@acme/custom-plugin"
   */
  packageId: z.string().describe('Package identifier'),

  /**
   * Installed package version (semver)
   */
  version: z.string().describe('Installed package version'),

  /**
   * Installation status
   */
  status: PackageInstallationStatusSchema.default('installing').describe('Installation status'),

  /**
   * Installation timestamp
   */
  installedAt: z.string().datetime().describe('Installation timestamp'),

  /**
   * User ID who installed the package
   */
  installedBy: z.string().describe('User ID who installed the package'),

  /**
   * Package-specific configuration
   */
  config: z.record(z.string(), z.unknown()).optional().describe('Package-specific configuration'),

  /**
   * Last update timestamp
   */
  updatedAt: z.string().datetime().describe('Last update timestamp'),
}));

export type PackageInstallation = z.input<typeof PackageInstallationSchema>;
/** Post-parse shape of {@link PackageInstallation} — defaults applied, transforms run (ADR-0122). */
export type PackageInstallationParsed = z.infer<typeof PackageInstallationSchema>;

/**
 * Tenant Context
 *
 * Runtime context containing current tenant information.
 * Extracted from request (subdomain, header, JWT claim, etc.)
 */
export const TenantContextSchema = lazySchema(() => z.object({
  /**
   * Current tenant database ID
   */
  tenantId: z.string().uuid().describe('Current tenant database ID'),

  /**
   * Current organization ID
   */
  organizationId: z.string().describe('Current organization ID'),

  /**
   * Organization slug (for display purposes)
   */
  organizationSlug: z.string().optional().describe('Organization slug'),

  /**
   * Tenant database URL
   */
  databaseUrl: z.string().url().describe('Tenant database URL'),

  /**
   * Tenant plan tier
   */
  plan: TenantPlanSchema.describe('Tenant plan tier'),

  /**
   * Custom tenant metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom tenant metadata'),
}));

export type TenantContext = z.input<typeof TenantContextSchema>;

/**
 * Tenant Identification Source
 *
 * How the tenant was identified from the request
 */
export const TenantIdentificationSourceSchema = lazySchema(() => z.enum([
  'subdomain',       // Extracted from subdomain (e.g., acme.objectstack.app)
  'custom_domain',   // Extracted from custom domain (e.g., app.acme.com)
  'header',          // Extracted from X-Tenant-ID header
  'jwt_claim',       // Extracted from JWT organizationId claim
  'session',         // Extracted from session data
  'default',         // Default/fallback tenant
]));

export type TenantIdentificationSource = z.input<typeof TenantIdentificationSourceSchema>;

/**
 * Tenant Routing Configuration
 *
 * Configuration for tenant identification and routing
 */
export const TenantRoutingConfigSchema = lazySchema(() => z.object({
  /**
   * Enable multi-tenant mode
   */
  enabled: z.boolean().default(false).describe('Enable multi-tenant mode'),

  /**
   * Tenant identification strategy (in order of precedence)
   */
  identificationSources: z.array(TenantIdentificationSourceSchema)
    .default(['subdomain', 'header', 'jwt_claim'])
    .describe('Tenant identification strategy (in order of precedence)'),

  /**
   * Default tenant ID (for single-tenant deployments or fallback)
   */
  defaultTenantId: z.string().uuid().optional().describe('Default tenant ID'),

  /**
   * Subdomain pattern for tenant extraction
   * Example: "{tenant}.objectstack.app"
   */
  subdomainPattern: z.string().optional().describe('Subdomain pattern for tenant extraction'),

  /**
   * Custom domain mapping
   * Maps custom domains to tenant IDs
   * Example: { "app.acme.com": "550e8400-e29b-41d4-a716-446655440000" }
   */
  customDomainMapping: z.record(z.string(), z.string().uuid()).optional()
    .describe('Custom domain to tenant ID mapping'),

  /**
   * Header name for tenant ID
   */
  tenantHeaderName: z.string().default('X-Tenant-ID').describe('Header name for tenant ID'),

  /**
   * JWT claim name for organization ID
   */
  jwtOrganizationClaim: z.string().default('organizationId')
    .describe('JWT claim name for organization ID'),
}));

export type TenantRoutingConfig = z.input<typeof TenantRoutingConfigSchema>;
/** Post-parse shape of {@link TenantRoutingConfig} — defaults applied, transforms run (ADR-0122). */
export type TenantRoutingConfigParsed = z.infer<typeof TenantRoutingConfigSchema>;

/**
 * Tenant Provisioning Request
 *
 * Request to provision a new tenant database
 */
export const ProvisionTenantRequestSchema = lazySchema(() => z.object({
  /**
   * Organization ID to provision database for
   */
  organizationId: z.string().describe('Organization ID'),

  /**
   * Deployment region preference
   */
  region: z.string().optional().describe('Deployment region preference'),

  /**
   * Tenant plan tier
   */
  plan: TenantPlanSchema.default('free').describe('Tenant plan tier'),

  /**
   * Storage limit in megabytes
   */
  storageLimitMb: z.number().int().positive().optional().describe('Storage limit in megabytes'),

  /**
   * Custom tenant metadata
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom tenant metadata'),
}));

export type ProvisionTenantRequest = z.input<typeof ProvisionTenantRequestSchema>;
/** Post-parse shape of {@link ProvisionTenantRequest} — defaults applied, transforms run (ADR-0122). */
export type ProvisionTenantRequestParsed = z.infer<typeof ProvisionTenantRequestSchema>;

/**
 * Tenant Provisioning Response
 *
 * Result of tenant provisioning operation
 */
export const ProvisionTenantResponseSchema = lazySchema(() => z.object({
  /**
   * Provisioned tenant database
   */
  tenant: TenantDatabaseSchema.describe('Provisioned tenant database'),

  /**
   * Provisioning duration in milliseconds
   */
  durationMs: z.number().describe('Provisioning duration in milliseconds'),

  /**
   * Any warnings or notes from provisioning
   */
  warnings: z.array(z.string()).optional().describe('Provisioning warnings'),
}));

export type ProvisionTenantResponse = z.input<typeof ProvisionTenantResponseSchema>;
/** Post-parse shape of {@link ProvisionTenantResponse} — defaults applied, transforms run (ADR-0122). */
export type ProvisionTenantResponseParsed = z.infer<typeof ProvisionTenantResponseSchema>;
