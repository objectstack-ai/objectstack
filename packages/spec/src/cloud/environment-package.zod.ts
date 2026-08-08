// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * # Environment Package Installation Protocol
 *
 * Models `sys_package_installation` — the pairing between an Environment and
 * a specific, immutable `sys_package_version` snapshot.
 *
 * Key invariants (per ADR-0003):
 * - One active version per package per environment at any time
 *   (UNIQUE `(environment_id, package_id)`).
 * - **Upgrade** = atomic `UPDATE package_version_id` to a newer version UUID.
 * - **Rollback** = atomic `UPDATE package_version_id` to an older version UUID.
 * - Only `status = 'published'` versions may be installed in production
 *   environments (draft/pre-release allowed in dev/sandbox with `allowDraft`).
 *
 * Stored in the **Control Plane DB** (not in environment data-plane DBs).
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a package installation within an environment.
 */
export const EnvironmentPackageStatusSchema = lazySchema(() => z
  .enum([
    'installed',   // Active and running; metadata loaded into this environment
    'installing',  // Install in progress (async)
    'upgrading',   // Version swap in progress (async)
    'disabled',    // Installed but not active — metadata not loaded
    'error',       // Install/upgrade failed; see errorMessage
  ])
  .describe('Package installation status within an environment'));

export type EnvironmentPackageStatus = z.input<typeof EnvironmentPackageStatusSchema>;

// ---------------------------------------------------------------------------
// sys_package_installation — Environment ↔ version pairing
// ---------------------------------------------------------------------------

/**
 * One row in `sys_package_installation`.
 *
 * Unique by `(environment_id, package_id)` — only one version of a given
 * package may be active per environment.
 */
export const EnvironmentPackageInstallationSchema = lazySchema(() => z.object({
  /** Unique installation record ID (UUID). */
  id: z.string().uuid().describe('Unique installation record ID'),

  /** Environment that owns this installation (FK → sys_environment). */
  environmentId: z.string().uuid().describe('Environment this installation belongs to'),

  /**
   * The specific, immutable version snapshot that is installed
   * (FK → sys_package_version.id).
   *
   * Upgrading = swapping this field to a newer version UUID.
   * Rollback   = swapping this field to an older version UUID.
   */
  packageVersionId: z.string().uuid()
    .describe('UUID of the installed sys_package_version row'),

  /**
   * Denormalized package UUID (FK → sys_package.id) copied from the version
   * row at install time. Used for the UNIQUE (environment_id, package_id)
   * constraint without a join.
   */
  packageId: z.string().uuid()
    .describe('UUID of the parent sys_package row (denormalized for constraint enforcement)'),

  /** Current lifecycle status within this environment. */
  status: EnvironmentPackageStatusSchema.default('installed'),

  /** Whether the package is active (metadata loaded and available). */
  enabled: z.boolean().default(true).describe('Whether the package metadata is loaded'),

  /**
   * Per-installation configuration values.
   * Keys mirror the package manifest's `configurationSchema.properties`.
   */
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('Per-installation configuration settings'),

  /**
   * When true, the environment runtime will replay the package's seed
   * datasets (demo Accounts / Contacts / …) into the primary organization
   * the next time the environment kernel boots. Set at install time and
   * never auto-cleared so the env can re-seed on cold-start until the user
   * explicitly disables it.
   */
  withSampleData: z.boolean().optional().default(false)
    .describe('Replay the package seed datasets on next kernel cold-start'),

  /** ISO-8601 timestamp when this installation was created. */
  installedAt: z.string().datetime().describe('Installation timestamp (ISO-8601)'),

  /** User ID of the member who performed the install (null for system installs). */
  installedBy: z.string().optional().describe('User ID of the installer'),

  /** ISO-8601 timestamp of the most recent update (version swap, enable/disable). */
  updatedAt: z.string().datetime().optional().describe('Last update timestamp (ISO-8601)'),

  /** Error details when `status === "error"`. */
  errorMessage: z.string().optional().describe('Error message when status is error'),
}).describe('Package installation record in an environment (sys_package_installation)'));

export type EnvironmentPackageInstallation = z.input<typeof EnvironmentPackageInstallationSchema>;
/** Post-parse shape of {@link EnvironmentPackageInstallation} — defaults applied, transforms run (ADR-0122). */
export type EnvironmentPackageInstallationParsed = z.infer<typeof EnvironmentPackageInstallationSchema>;

// ---------------------------------------------------------------------------
// Install / Upgrade / Rollback requests
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /cloud/environments/:environmentId/packages`
 * (or the legacy `/cloud/environments/:environmentId/packages` alias).
 */
export const InstallPackageToEnvironmentRequestSchema = lazySchema(() => z.object({
  packageVersionId: z.string().uuid().optional()
    .describe('Exact package version UUID to install (preferred)'),
  packageManifestId: z.string().optional()
    .describe('Package manifest ID (reverse-domain, e.g. com.acme.crm) — resolved to version UUID'),
  version: z.string().optional().describe('Version string (defaults to latest published)'),
  allowDraft: z.boolean().default(false)
    .describe('Allow installing a draft version (dev/sandbox environments only)'),
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('Installation-time configuration settings'),
  withSampleData: z.boolean().optional().default(false)
    .describe('Replay the package seed datasets on next kernel cold-start'),
  enableOnInstall: z.boolean().default(true)
    .describe('Activate the package immediately after install'),
  installedBy: z.string().optional().describe('User ID of the installer'),
}).describe('Install a package version into a specific environment')
  .refine(
    data => data.packageVersionId != null || data.packageManifestId != null,
    { message: 'Either packageVersionId or packageManifestId must be provided' }
  ));

export type InstallPackageToEnvironmentRequest = z.input<typeof InstallPackageToEnvironmentRequestSchema>;
/** Post-parse shape of {@link InstallPackageToEnvironmentRequest} — defaults applied, transforms run (ADR-0122). */
export type InstallPackageToEnvironmentRequestParsed = z.infer<typeof InstallPackageToEnvironmentRequestSchema>;

/**
 * Request body for upgrading a package installation.
 */
export const UpgradeEnvironmentPackageRequestSchema = lazySchema(() => z.object({
  targetPackageVersionId: z.string().uuid().optional()
    .describe('Target package version UUID (preferred)'),
  targetVersion: z.string().optional()
    .describe('Target version string (defaults to latest published)'),
  allowDraft: z.boolean().default(false)
    .describe('Allow upgrading to a draft version'),
  upgradedBy: z.string().optional().describe('User ID performing the upgrade'),
}).describe('Upgrade a package installation to a newer version'));

export type UpgradeEnvironmentPackageRequest = z.input<typeof UpgradeEnvironmentPackageRequestSchema>;
/** Post-parse shape of {@link UpgradeEnvironmentPackageRequest} — defaults applied, transforms run (ADR-0122). */
export type UpgradeEnvironmentPackageRequestParsed = z.infer<typeof UpgradeEnvironmentPackageRequestSchema>;

/**
 * Request body for rolling back a package installation.
 */
export const RollbackEnvironmentPackageRequestSchema = lazySchema(() => z.object({
  targetPackageVersionId: z.string().uuid()
    .describe('Package version UUID to roll back to'),
  rolledBackBy: z.string().optional().describe('User ID performing the rollback'),
}).describe('Roll back a package installation to a specific older version'));

export type RollbackEnvironmentPackageRequest = z.input<typeof RollbackEnvironmentPackageRequestSchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * Response from `GET /cloud/environments/:environmentId/packages`.
 */
export const ListEnvironmentPackagesResponseSchema = lazySchema(() => z.object({
  packages: z.array(EnvironmentPackageInstallationSchema)
    .describe('Packages installed in this environment'),
  total: z.number().describe('Total count'),
}).describe('List of packages installed in an environment'));

export type ListEnvironmentPackagesResponse = z.input<typeof ListEnvironmentPackagesResponseSchema>;
/** Post-parse shape of {@link ListEnvironmentPackagesResponse} — defaults applied, transforms run (ADR-0122). */
export type ListEnvironmentPackagesResponseParsed = z.infer<typeof ListEnvironmentPackagesResponseSchema>;
