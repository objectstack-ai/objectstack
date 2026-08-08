// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ManifestSchema } from './manifest.zod';
import { DependencyResolutionResultSchema } from './dependency-resolution.zod';

/**
 * # Package Registry Protocol
 * 
 * Defines the runtime state and lifecycle operations for installed packages.
 * 
 * ## Key Distinction: App vs Package (ADR-0019)
 * - **App (AppSchema)**: the one consumer-facing unit — what a tenant downloads,
 *   opens, and uninstalls. Only `type: app` packages are consumer-installable
 *   (see `isConsumerInstallable`), and a consumer package defines **at most one
 *   app** — there is no "suite contains apps" aggregator.
 * - **Package (Manifest)**: the internal / control-plane artifact term (the
 *   "row" in the installed-packages table). Never surfaced to consumers as a
 *   separate noun.
 * - **Internal contributions** (plugin/driver/server/…): the "frameworks inside
 *   the .app bundle" — bundled within an App or operator-provisioned; a consumer
 *   never installs them directly.
 *
 * ## Architecture Alignment
 * - **Salesforce**: Managed Packages with install/uninstall lifecycle
 * - **VS Code**: Extension marketplace with enable/disable per-workspace
 * - **Kubernetes**: Helm charts with release state tracking
 * - **npm**: Package registry with install/uninstall/version management
 */

// ==========================================
// Package Status & Lifecycle
// ==========================================

/**
 * Package installation status.
 */
import { lazySchema } from '../shared/lazy-schema';
export const PackageStatusEnum = z.enum([
  'installed',     // Successfully installed and enabled
  'disabled',      // Installed but disabled (metadata not active)
  'installing',    // Installation in progress
  'upgrading',     // Upgrade in progress
  'uninstalling',  // Removal in progress
  'error',         // Installation or runtime error
]).describe('Package installation status');
export type PackageStatus = z.input<typeof PackageStatusEnum>;

/**
 * Installed Package Schema
 * 
 * Wraps a ManifestSchema with runtime lifecycle state.
 * This is the "row" in the installed packages table.
 */
export const InstalledPackageSchema = lazySchema(() => z.object({
  /** 
   * The full package manifest (source of truth for package definition).
   */
  manifest: ManifestSchema.describe('Full package manifest'),

  /**
   * Current lifecycle status.
   */
  status: PackageStatusEnum.default('installed')
    .describe('Package state: installed, disabled, installing, upgrading, uninstalling, or error'),

  /**
   * Whether the package is currently enabled (active).
   * When disabled, the package's metadata is not loaded into the registry.
   */
  enabled: z.boolean().default(true)
    .describe('Whether the package is currently enabled'),

  /**
   * ISO 8601 timestamp of when the package was installed.
   */
  installedAt: z.string().datetime().optional()
    .describe('Installation timestamp'),

  /**
   * ISO 8601 timestamp of last update.
   */
  updatedAt: z.string().datetime().optional()
    .describe('Last update timestamp'),

  /**
   * The currently installed version string.
   * Mirrors manifest.version for quick access without parsing the full manifest.
   */
  installedVersion: z.string().optional()
    .describe('Currently installed version for quick access'),

  /**
   * The previously installed version (before last upgrade).
   * Useful for rollback and upgrade tracking.
   */
  previousVersion: z.string().optional()
    .describe('Version before the last upgrade'),

  /**
   * ISO 8601 timestamp of when the package was last enabled/disabled.
   */
  statusChangedAt: z.string().datetime().optional()
    .describe('Status change timestamp'),

  /**
   * Error message if status is 'error'.
   */
  errorMessage: z.string().optional()
    .describe('Error message when status is error'),

  /**
   * Configuration values set by the user for this package.
   * Keys correspond to the package's `configuration.properties`.
   */
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('User-provided configuration settings'),

  /**
   * Upgrade history for this package.
   * Records each version migration with status and optional log.
   */
  upgradeHistory: z.array(z.object({
    /** Previous version before upgrade */
    fromVersion: z.string().describe('Version before upgrade'),
    /** New version after upgrade */
    toVersion: z.string().describe('Version after upgrade'),
    /** Timestamp of the upgrade */
    upgradedAt: z.string().datetime().describe('Upgrade timestamp'),
    /** Outcome of the upgrade */
    status: z.enum(['success', 'failed', 'rolled_back']).describe('Upgrade outcome'),
    /** Migration log entries */
    migrationLog: z.array(z.string()).optional().describe('Migration step logs'),
  })).optional().describe('Version upgrade history'),

  /**
   * Namespaces registered by this package.
   * Tracks which namespace prefixes are occupied by this package.
   */
  registeredNamespaces: z.array(z.string()).optional()
    .describe('Namespace prefixes registered by this package'),
}).describe('Installed package with runtime lifecycle state'));
export type InstalledPackage = z.input<typeof InstalledPackageSchema>;
/** Post-parse shape of {@link InstalledPackage} — defaults applied, transforms run (ADR-0122). */
export type InstalledPackageParsed = z.infer<typeof InstalledPackageSchema>;

// ==========================================
// Namespace Registry
// ==========================================

/**
 * Namespace Registry Entry
 * Tracks namespace ownership within the platform instance.
 */
export const NamespaceRegistryEntrySchema = lazySchema(() => z.object({
  /** Namespace prefix */
  namespace: z.string().describe('Namespace prefix'),

  /** Package that owns this namespace */
  packageId: z.string().describe('Owning package ID'),

  /** Registration timestamp */
  registeredAt: z.string().datetime().describe('Registration timestamp'),

  /** Namespace status */
  status: z.enum(['active', 'disabled', 'reserved'])
    .describe('Namespace status'),
}).describe('Namespace ownership entry in the registry'));

export type NamespaceRegistryEntry = z.input<typeof NamespaceRegistryEntrySchema>;

/**
 * Namespace Conflict Error
 * Describes a namespace collision detected during package installation.
 */
export const NamespaceConflictErrorSchema = lazySchema(() => z.object({
  /** Error type discriminator */
  type: z.literal('namespace_conflict').describe('Error type'),

  /** Namespace that was requested */
  requestedNamespace: z.string().describe('Requested namespace'),

  /** ID of the package that already owns the namespace */
  conflictingPackageId: z.string().describe('Conflicting package ID'),

  /** Name of the conflicting package */
  conflictingPackageName: z.string().describe('Conflicting package display name'),

  /** Suggested alternative namespace */
  suggestion: z.string().optional()
    .describe('Suggested alternative namespace'),
}).describe('Namespace collision error during installation'));

export type NamespaceConflictError = z.input<typeof NamespaceConflictErrorSchema>;

// ==========================================
// Package Registry Request/Response Schemas
// ==========================================

/**
 * List Packages Request
 */
export const ListPackagesRequestSchema = lazySchema(() => z.object({
  /** Filter by status */
  status: PackageStatusEnum.optional().describe('Filter by package status'),
  /** Filter by package type */
  type: ManifestSchema.shape.type.optional().describe('Filter by package type'),
  /** Filter by enabled state */
  enabled: z.boolean().optional().describe('Filter by enabled state'),
}).describe('List packages request'));
export type ListPackagesRequest = z.input<typeof ListPackagesRequestSchema>;

/**
 * List Packages Response
 */
export const ListPackagesResponseSchema = lazySchema(() => z.object({
  packages: z.array(InstalledPackageSchema).describe('List of installed packages'),
  total: z.number().describe('Total package count'),
}).describe('List packages response'));
export type ListPackagesResponse = z.input<typeof ListPackagesResponseSchema>;
/** Post-parse shape of {@link ListPackagesResponse} — defaults applied, transforms run (ADR-0122). */
export type ListPackagesResponseParsed = z.infer<typeof ListPackagesResponseSchema>;

/**
 * Get Package Request
 */
export const GetPackageRequestSchema = lazySchema(() => z.object({
  /** Package ID (reverse domain identifier from manifest) */
  id: z.string().describe('Package identifier'),
}).describe('Get package request'));
export type GetPackageRequest = z.input<typeof GetPackageRequestSchema>;

/**
 * Get Package Response
 */
export const GetPackageResponseSchema = lazySchema(() => z.object({
  package: InstalledPackageSchema.describe('Package details'),
}).describe('Get package response'));
export type GetPackageResponse = z.input<typeof GetPackageResponseSchema>;
/** Post-parse shape of {@link GetPackageResponse} — defaults applied, transforms run (ADR-0122). */
export type GetPackageResponseParsed = z.infer<typeof GetPackageResponseSchema>;

/**
 * Install Package Request
 * 
 * Accepts a full manifest to install. In a production system,
 * this might also accept a package ID to fetch from a marketplace.
 */
export const InstallPackageRequestSchema = lazySchema(() => z.object({
  /** The package manifest to install */
  manifest: ManifestSchema.describe('Package manifest to install'),
  /** Optional: user-provided settings at install time */
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('User-provided settings at install time'),
  /** Whether to enable immediately after install (default: true) */
  enableOnInstall: z.boolean().default(true)
    .describe('Whether to enable immediately after install'),
  /**
   * Current platform version for compatibility checking.
   * When provided, the system compares this against the package's
   * `engine.objectstack` requirement to verify compatibility.
   */
  platformVersion: z.string().optional()
    .describe('Current platform version for compatibility verification'),
}).describe('Install package request'));
export type InstallPackageRequest = z.input<typeof InstallPackageRequestSchema>;
/** Post-parse shape of {@link InstallPackageRequest} — defaults applied, transforms run (ADR-0122). */
export type InstallPackageRequestParsed = z.infer<typeof InstallPackageRequestSchema>;

/**
 * Install Package Response
 */
export const InstallPackageResponseSchema = lazySchema(() => z.object({
  package: InstalledPackageSchema.describe('Installed package details'),
  message: z.string().optional().describe('Installation status message'),
  /** Dependency resolution result (when dependencies were analyzed) */
  dependencyResolution: DependencyResolutionResultSchema.optional()
    .describe('Dependency resolution result from install analysis'),
}).describe('Install package response'));
export type InstallPackageResponse = z.input<typeof InstallPackageResponseSchema>;
/** Post-parse shape of {@link InstallPackageResponse} — defaults applied, transforms run (ADR-0122). */
export type InstallPackageResponseParsed = z.infer<typeof InstallPackageResponseSchema>;

/**
 * Uninstall Package Request
 */
export const UninstallPackageRequestSchema = lazySchema(() => z.object({
  /** Package ID to uninstall */
  id: z.string().describe('Package ID to uninstall'),
}).describe('Uninstall package request'));
export type UninstallPackageRequest = z.input<typeof UninstallPackageRequestSchema>;

/**
 * Uninstall Package Response
 */
export const UninstallPackageResponseSchema = lazySchema(() => z.object({
  id: z.string().describe('Uninstalled package ID'),
  success: z.boolean().describe('Whether uninstall succeeded'),
  message: z.string().optional().describe('Uninstall status message'),
}).describe('Uninstall package response'));
export type UninstallPackageResponse = z.input<typeof UninstallPackageResponseSchema>;

/**
 * Enable Package Request
 */
export const EnablePackageRequestSchema = lazySchema(() => z.object({
  /** Package ID to enable */
  id: z.string().describe('Package ID to enable'),
}).describe('Enable package request'));
export type EnablePackageRequest = z.input<typeof EnablePackageRequestSchema>;

/**
 * Enable Package Response
 */
export const EnablePackageResponseSchema = lazySchema(() => z.object({
  package: InstalledPackageSchema.describe('Enabled package details'),
  message: z.string().optional().describe('Enable status message'),
}).describe('Enable package response'));
export type EnablePackageResponse = z.input<typeof EnablePackageResponseSchema>;
/** Post-parse shape of {@link EnablePackageResponse} — defaults applied, transforms run (ADR-0122). */
export type EnablePackageResponseParsed = z.infer<typeof EnablePackageResponseSchema>;

/**
 * Disable Package Request
 */
export const DisablePackageRequestSchema = lazySchema(() => z.object({
  /** Package ID to disable */
  id: z.string().describe('Package ID to disable'),
}).describe('Disable package request'));
export type DisablePackageRequest = z.input<typeof DisablePackageRequestSchema>;

/**
 * Disable Package Response
 */
export const DisablePackageResponseSchema = lazySchema(() => z.object({
  package: InstalledPackageSchema.describe('Disabled package details'),
  message: z.string().optional().describe('Disable status message'),
}).describe('Disable package response'));
export type DisablePackageResponse = z.input<typeof DisablePackageResponseSchema>;
/** Post-parse shape of {@link DisablePackageResponse} — defaults applied, transforms run (ADR-0122). */
export type DisablePackageResponseParsed = z.infer<typeof DisablePackageResponseSchema>;
