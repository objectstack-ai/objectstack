// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { TenantPlanSchema } from './tenant.zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * # Environment Protocol (runtime container)
 *
 * An **Environment** is the runtime container of an organization's data.
 * It owns a physically isolated database, a canonical hostname, a plan/quota
 * tier, and per-environment RBAC. An organization may own many environments
 * (dev/test/prod/sandbox/preview/…) — exactly one is marked `is_default`.
 *
 * This file defines the Control-Plane schemas for the `sys_environment`,
 * `sys_environment_credential` and `sys_environment_member` tables. Business
 * data lives in each environment's own database — those data-plane DBs hold
 * no system tables.
 *
 * See ADR-0006 v4: `sys_environment` was renamed to `sys_environment`; the
 * separate dev-workspace `Project` concept introduced in v3 has been
 * dropped — user code is now modelled as an implicit `sys_package` with
 * a per-org `manifest_id` (see ADR-0003), so a single package + version
 * + installation model serves both Marketplace apps and user projects.
 *
 * Split of concerns:
 * - **Control Plane**: `sys_environment` (includes physical DB addressing),
 *   `sys_package_installation` (with `environment_id`), `sys_environment_credential`,
 *   `sys_environment_member`, `sys_metadata` (with `environment_id`).
 * - **Data Plane**: each environment DB contains only business objects
 *   (account, task, …). No system tables, no `environment_id` columns.
 */

// ---------------------------------------------------------------------------
// Environment registry
// ---------------------------------------------------------------------------

/**
 * Environment categorical tag — canonical buckets per industry convention
 * (Salesforce, Power Platform, ServiceNow all use this taxonomy).
 *
 * NOTE: As of ADR-0006 v3 the `sys_environment` row does not persist this tag
 * as a dedicated column. It remains in the protocol as a typed advisory used
 * by Studio badges, provisioning policies and SDK helpers; deployments that
 * need to persist it should write it into `metadata.env_type`.
 *
 * ⚠️ **This is NOT the enum a discovery response advertises.**
 * `DiscoverySchema.environment` (`api/discovery.zod.ts`) is a deliberately
 * coarser THREE-member enum — `production` / `sandbox` / `development` — that
 * answers "am I talking to production?", not "which environment is this". The
 * three are a strict subset of the seven here, and `resolveDiscoveryEnvironment`
 * folds the other four onto them (#4828): `test` → `development`; `staging`,
 * `preview` and `trial` → `sandbox`, the enum's provisioned pre-production
 * member. So a `staging` value that is first-class on this taxonomy is REJECTED
 * by `DiscoveryEnvironmentSchema`; do not carry a value from here onto a
 * discovery response without going through that resolver. The subset relation is
 * pinned in `api/discovery-environment-subset.pin.test.ts` so neither enum can
 * drift out of it silently (#5676).
 *
 * ⚠️ **Adding a member here is a decision over there too** (#6287). The fold
 * table is typed `Record<EnvironmentType, DiscoveryEnvironment>`, so a new
 * bucket does not compile until someone says which of the three coarse postures
 * it advertises. That is on purpose: before #6287 `preview` and `trial` reached
 * `development` through a `??` fallback instead of a decision, and a new bucket
 * would have joined them silently — including a production-side one, which is
 * the dangerous direction (#5673).
 */
export const EnvironmentTypeSchema = lazySchema(() => z
  .enum(['production', 'sandbox', 'development', 'test', 'staging', 'preview', 'trial'])
  .describe('Environment categorical tag (prod/sandbox/dev/test/…)'));

export type EnvironmentType = z.input<typeof EnvironmentTypeSchema>;

/**
 * Environment lifecycle status.
 *
 * Transitions go through dedicated status-machine actions
 * (`suspend_environment` / `resume_environment` / `archive_environment` / …) —
 * direct field edits are blocked at the object layer.
 */
export const EnvironmentStatusSchema = lazySchema(() => z
  .enum(['provisioning', 'active', 'suspended', 'archived', 'failed', 'migrating'])
  .describe('Environment lifecycle status'));

export type EnvironmentStatus = z.input<typeof EnvironmentStatusSchema>;

/**
 * Backend driver registry — keys used by the data-plane driver factory.
 * Kept open-ended (`z.string()`) so third-party drivers can register new
 * backends without a core release.
 */
export const EnvironmentDriverSchema = lazySchema(() => z
  .string()
  .min(1)
  .describe('Data-plane driver key (e.g. `turso`, `libsql`, `sqlite`, `postgres`)'));

export type EnvironmentDriver = z.input<typeof EnvironmentDriverSchema>;

/**
 * Public exposure of an environment's compiled artifacts.
 *
 * - `private`  (default) — every read requires authentication.
 * - `unlisted` — `/pub/v1/environments/:id/artifact?commit=<id>` works (no enumeration).
 * - `public`   — full listing + download via `/pub/v1/environments/:id/*`.
 */
export const EnvironmentVisibilitySchema = lazySchema(() => z
  .enum(['private', 'unlisted', 'public'])
  .describe('Public exposure of this environment artifacts (private | unlisted | public).'));

export type EnvironmentVisibility = z.input<typeof EnvironmentVisibilitySchema>;

/**
 * Environment — one logical runtime of an organization's data.
 *
 * Physical database connection info is stored directly on this row so a
 * single lookup gives both logical and physical addressing. Environments are
 * addressable by `id` (UUID) and by `hostname` (URL-unique).
 */
export const EnvironmentSchema = lazySchema(() => z.object({
  /** UUID of the environment (stable, never reused). */
  id: z.string().uuid().describe('UUID of the environment (stable, never reused)'),

  /** Organization that owns this environment. */
  organizationId: z.string().describe('Organization that owns this environment'),

  /** Display name shown in Studio and APIs. */
  displayName: z.string().describe('Display name shown in Studio and APIs'),

  /**
   * Whether this is the organization's **default** environment.
   * Exactly one per org carries `true`.
   */
  isDefault: z.boolean().default(false).describe('Whether this is the default environment for the organization'),

  /** Whether this is a system environment (platform infrastructure, not user data). */
  isSystem: z.boolean().default(false).describe('Whether this is a system environment (platform infrastructure, not user data)'),

  /** Plan tier applied to this environment for quota/billing enforcement. */
  plan: TenantPlanSchema.default('free').describe('Plan tier for this environment'),

  /** Environment lifecycle status. Driven by status-machine actions. */
  status: EnvironmentStatusSchema.default('provisioning').describe('Environment lifecycle status'),

  /** User ID that created the environment. */
  createdBy: z.string().describe('User ID that created the environment'),

  /** Creation timestamp (ISO-8601). */
  createdAt: z.string().datetime().describe('Creation timestamp (ISO-8601)'),

  /** Last update timestamp (ISO-8601). */
  updatedAt: z.string().datetime().describe('Last update timestamp (ISO-8601)'),

  // ── Physical database addressing ──

  /** Full connection URL (e.g. `libsql://env-<uuid>.turso.io`, `postgres://…`). Set after provisioning. */
  databaseUrl: z.string().url().optional().describe('Full connection URL for the environment database'),

  /** Data-plane driver key. */
  databaseDriver: EnvironmentDriverSchema.optional().describe('Data-plane driver key (turso, libsql, sqlite, memory, postgres)'),

  /** Storage quota in megabytes. */
  storageLimitMb: z.number().int().positive().optional().describe('Storage quota in megabytes'),

  /** When the physical database was provisioned. */
  provisionedAt: z.string().datetime().optional().describe('Provisioning timestamp (ISO-8601)'),

  /** Free-form metadata (feature flags, tags, …). */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Free-form metadata'),

  /**
   * Canonical hostname for this environment (e.g. `acme-dev.objectstack.app` or `api.acme.com`).
   * UNIQUE. Auto-set on creation; can be overridden for custom domains via the
   * `change_hostname` action. Used for environment resolution via hostname matching.
   */
  hostname: z
    .string()
    .optional()
    .describe(
      'Canonical hostname for this environment. UNIQUE. Auto-set on creation; can be overridden for custom domains.',
    ),

  /**
   * Pre-computed clickable URL into this environment's admin Console.
   * Auto-derived from `hostname` at provisioning time so detail pages can
   * render a real `<a>` link without view-render template substitution.
   */
  consoleUrl: z.string().url().optional().describe('Pre-computed admin Console URL for this environment'),

  /**
   * Pre-computed REST API base URL for this environment.
   * Auto-derived from `hostname` at provisioning time.
   */
  apiBaseUrl: z.string().url().optional().describe('Pre-computed REST API base URL for this environment'),

  /**
   * Public exposure of this environment's compiled artifacts.
   */
  visibility: EnvironmentVisibilitySchema.optional().default('private')
    .describe('Public exposure of this environment artifacts (private | unlisted | public).'),
}));

export type Environment = z.input<typeof EnvironmentSchema>;
/** Post-parse shape of {@link Environment} — defaults applied, transforms run (ADR-0122). */
export type EnvironmentParsed = z.infer<typeof EnvironmentSchema>;

// ---------------------------------------------------------------------------
// Credential (rotatable)
// ---------------------------------------------------------------------------

/**
 * Credential lifecycle status — used during rotation.
 */
export const EnvironmentCredentialStatusSchema = lazySchema(() => z
  .enum(['active', 'rotating', 'revoked'])
  .describe('Credential lifecycle status'));

export type EnvironmentCredentialStatus = z.input<typeof EnvironmentCredentialStatusSchema>;

/**
 * Encrypted credential for an environment's database.
 *
 * Modeled as a separate row so credentials can be rotated independently of
 * the parent environment (`status = 'rotating'` allows two active credentials
 * during a rollover window).
 */
export const EnvironmentCredentialSchema = lazySchema(() => z.object({
  /** UUID of the credential. */
  id: z.string().uuid().describe('UUID of the credential'),

  /** Environment this credential authorizes. */
  environmentId: z.string().uuid().describe('Environment this credential authorizes'),

  /** Encrypted auth token or secret (ciphertext). */
  secretCiphertext: z.string().describe('Encrypted auth token or secret (ciphertext)'),

  /** KMS/encryption key ID that produced `secretCiphertext`. */
  encryptionKeyId: z.string().describe('Encryption key ID used to encrypt the secret'),

  /** Authorization scope (e.g. `full_access`, `read_only`). */
  authorization: z
    .enum(['full_access', 'read_only'])
    .default('full_access')
    .describe('Authorization scope for this credential'),

  /** Credential lifecycle status. */
  status: EnvironmentCredentialStatusSchema.default('active').describe('Credential lifecycle status'),

  /** Credential creation timestamp. */
  createdAt: z.string().datetime().describe('Creation timestamp (ISO-8601)'),

  /** Optional expiry — after this timestamp the credential must be rotated. */
  expiresAt: z.string().datetime().optional().describe('Optional expiry timestamp'),

  /** Timestamp when the credential was revoked (null while active). */
  revokedAt: z.string().datetime().optional().describe('Revocation timestamp (if revoked)'),
}));

export type EnvironmentCredential = z.input<typeof EnvironmentCredentialSchema>;
/** Post-parse shape of {@link EnvironmentCredential} — defaults applied, transforms run (ADR-0122). */
export type EnvironmentCredentialParsed = z.infer<typeof EnvironmentCredentialSchema>;

// ---------------------------------------------------------------------------
// Environment-scoped RBAC
// ---------------------------------------------------------------------------

/**
 * Per-environment role assigned to a user/service principal.
 */
export const EnvironmentRoleSchema = lazySchema(() => z
  .enum(['owner', 'admin', 'maker', 'reader', 'guest'])
  .describe('Per-environment role'));

export type EnvironmentRole = z.input<typeof EnvironmentRoleSchema>;

/**
 * Environment membership — grants a user access to a specific environment.
 *
 * Unique by `(environmentId, userId)`.
 */
export const EnvironmentMemberSchema = lazySchema(() => z.object({
  /** UUID of the membership. */
  id: z.string().uuid().describe('UUID of the membership'),

  /** Environment this membership grants access to. */
  environmentId: z.string().uuid().describe('Environment this membership grants access to'),

  /** User ID (references `user` in the control plane). */
  userId: z.string().describe('User ID'),

  /** Per-environment role. */
  role: EnvironmentRoleSchema.describe('Per-environment role'),

  /** User ID of the member who invited / granted this membership. */
  invitedBy: z.string().describe('User ID that granted this membership'),

  /** Creation timestamp. */
  createdAt: z.string().datetime().describe('Creation timestamp (ISO-8601)'),

  /** Last update timestamp. */
  updatedAt: z.string().datetime().describe('Last update timestamp (ISO-8601)'),
}));

export type EnvironmentMember = z.input<typeof EnvironmentMemberSchema>;

// ---------------------------------------------------------------------------
// Provisioning requests / responses
// ---------------------------------------------------------------------------

/**
 * Request to provision a new environment for an organization.
 *
 * Backed by `EnvironmentProvisioningService.provisionEnvironment` which
 * atomically allocates the physical database, mints a credential, and
 * inserts the `sys_environment` row.
 */
export const ProvisionEnvironmentRequestSchema = lazySchema(() => z.object({
  organizationId: z.string().describe('Organization that will own the new environment'),
  displayName: z.string().min(1).describe('Display name shown in Studio and APIs'),
  driver: EnvironmentDriverSchema.optional().describe('Driver key (defaults to provisioning service config)'),
  plan: TenantPlanSchema.optional().describe('Plan tier'),
  storageLimitMb: z.number().int().positive().optional().describe('Storage quota in megabytes'),
  isDefault: z.boolean().optional().describe('Mark as the organization default environment'),
  createdBy: z.string().describe('User ID that initiated the provisioning'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Free-form metadata'),
  hostname: z.string().optional().describe('Canonical hostname (auto-generated if omitted)'),
  templateId: z.string().optional().describe(
    'Starter package to seed into the new environment on first provisioning (e.g. "crm", "todo"). Defaults to "blank".',
  ),
  visibility: EnvironmentVisibilitySchema.optional().default('private').describe(
    'Public exposure of this environment artifacts. private = auth required for every read (default); '
    + 'unlisted = downloadable when commit id is known; public = listed and freely downloadable via /pub/v1/environments/:id/*.',
  ),
}));

export type ProvisionEnvironmentRequest = z.input<typeof ProvisionEnvironmentRequestSchema>;
/** Post-parse shape of {@link ProvisionEnvironmentRequest} — defaults applied, transforms run (ADR-0122). */
export type ProvisionEnvironmentRequestParsed = z.infer<typeof ProvisionEnvironmentRequestSchema>;

/**
 * Response of a successful environment provisioning call.
 */
export const ProvisionEnvironmentResponseSchema = lazySchema(() => z.object({
  environment: EnvironmentSchema.describe('Provisioned environment (includes database addressing)'),
  credential: EnvironmentCredentialSchema.describe('Freshly-minted credential for the environment DB'),
  durationMs: z.number().describe('Total provisioning duration in milliseconds'),
  warnings: z.array(z.string()).optional().describe('Non-fatal warnings emitted during provisioning'),
  /**
   * Loud rename receipt: the control plane auto-renames a colliding hostname
   * (canonical hostnames are UNIQUE) by appending a short suffix instead of
   * failing the call. Present ONLY when that rename actually happened — a
   * provisioning call that got the hostname it asked for omits this key
   * entirely, so `hostnameAssignment !== undefined` is itself the signal.
   *
   * Declared here rather than in the control plane so the fact survives
   * `z.object` stripping and reaches generated provisioning clients, which
   * are built from this protocol's published surface (`api-surface.json`).
   * It is deliberately NOT carried in the free-form `metadata` bag: a caller
   * must not be able to suppress or forge a trust signal the server emits.
   */
  hostnameAssignment: z.object({
    requestedHostname: z
      .string()
      .describe('Hostname the caller asked for (explicitly, or as auto-derived from displayName)'),
    assignedHostname: z
      .string()
      .describe('Hostname actually assigned after the collision-avoiding rename; equals `environment.hostname`'),
  })
    .optional()
    .describe(
      'Populated ONLY when the control plane auto-renamed the requested hostname to avoid a '
      + 'collision. Absent means the requested hostname was assigned unchanged — never read '
      + 'absence as "unknown".',
    ),
}));

export type ProvisionEnvironmentResponse = z.input<typeof ProvisionEnvironmentResponseSchema>;
/** Post-parse shape of {@link ProvisionEnvironmentResponse} — defaults applied, transforms run (ADR-0122). */
export type ProvisionEnvironmentResponseParsed = z.infer<typeof ProvisionEnvironmentResponseSchema>;

/**
 * Request to bootstrap a brand-new organization — allocates the default
 * environment (and its DB) in one atomic call.
 */
export const ProvisionOrganizationRequestSchema = lazySchema(() => z.object({
  organizationId: z.string().describe('Organization being bootstrapped'),
  defaultEnvironmentDisplayName: z
    .string()
    .min(1)
    .default('Production')
    .describe('Display name for the default environment'),
  driver: EnvironmentDriverSchema.optional().describe('Driver key'),
  plan: TenantPlanSchema.optional().describe('Plan tier'),
  storageLimitMb: z.number().int().positive().optional().describe('Storage quota in megabytes'),
  createdBy: z.string().describe('User ID that initiated provisioning'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Free-form metadata'),
}));

export type ProvisionOrganizationRequest = z.input<typeof ProvisionOrganizationRequestSchema>;
/** Post-parse shape of {@link ProvisionOrganizationRequest} — defaults applied, transforms run (ADR-0122). */
export type ProvisionOrganizationRequestParsed = z.infer<typeof ProvisionOrganizationRequestSchema>;

/**
 * Response of a successful organization bootstrap.
 */
export const ProvisionOrganizationResponseSchema = lazySchema(() => z.object({
  defaultEnvironment: ProvisionEnvironmentResponseSchema.describe('Default environment that was created'),
  durationMs: z.number().describe('Total bootstrap duration in milliseconds'),
  warnings: z.array(z.string()).optional().describe('Non-fatal warnings'),
}));

export type ProvisionOrganizationResponse = z.input<typeof ProvisionOrganizationResponseSchema>;
/** Post-parse shape of {@link ProvisionOrganizationResponse} — defaults applied, transforms run (ADR-0122). */
export type ProvisionOrganizationResponseParsed = z.infer<typeof ProvisionOrganizationResponseSchema>;
