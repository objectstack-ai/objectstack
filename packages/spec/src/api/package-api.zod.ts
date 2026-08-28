// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { InstalledPackageSchema } from '../kernel/package-registry.zod';
import { DependencyResolutionResultSchema } from '../kernel/dependency-resolution.zod';
import { UpgradePlanSchema } from '../kernel/package-upgrade.zod';
import { PackageArtifactSchema } from '../kernel/package-artifact.zod';
import { ManifestSchema } from '../kernel/manifest.zod';
import { ArtifactReferenceSchema } from '../cloud/marketplace.zod';

/**
 * # Package API Protocol
 *
 * REST API endpoint schemas for package lifecycle management.
 *
 * Base path: /api/v1/packages
 *
 * @example Endpoints
 * POST   /api/v1/packages/install              — Install a package
 * POST   /api/v1/packages/upgrade              — Upgrade a package
 * POST   /api/v1/packages/resolve-dependencies — Resolve dependencies
 * POST   /api/v1/packages/upload               — Upload an artifact
 * GET    /api/v1/packages                      — List installed packages
 * GET    /api/v1/packages/:packageId           — Get package details
 * POST   /api/v1/packages/:packageId/rollback  — Rollback a package
 * DELETE /api/v1/packages/:packageId           — Uninstall a package
 */

// ==========================================
// 1. Path Parameters
// ==========================================

/**
 * Path parameters for package-level operations.
 */
import { lazySchema } from '../shared/lazy-schema';
export const PackagePathParamsSchema = lazySchema(() => z.object({
  packageId: z.string().describe('Package identifier'),
}));
export type PackagePathParams = z.input<typeof PackagePathParamsSchema>;

// ==========================================
// 2. List Packages (GET /api/v1/packages)
// ==========================================

/**
 * Query parameters for listing installed packages.
 */
export const ListInstalledPackagesRequestSchema = lazySchema(() => z.object({
  /** Filter by package status */
  status: z.enum(['installed', 'disabled', 'installing', 'upgrading', 'uninstalling', 'error']).optional()
    .describe('Filter by package status'),
  /** Filter by enabled state */
  enabled: z.boolean().optional()
    .describe('Filter by enabled state'),
  /** Maximum number of packages to return */
  limit: z.number().int().min(1).max(100).default(50)
    .describe('Maximum number of packages to return'),
  /** Cursor for pagination */
  cursor: z.string().optional()
    .describe('Cursor for pagination'),
}).describe('List installed packages request'));
export type ListInstalledPackagesRequest = z.input<typeof ListInstalledPackagesRequestSchema>;
/** Post-parse shape of {@link ListInstalledPackagesRequest} — defaults applied, transforms run (ADR-0122). */
export type ListInstalledPackagesRequestParsed = z.infer<typeof ListInstalledPackagesRequestSchema>;

/**
 * Response for listing installed packages.
 */
export const ListInstalledPackagesResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    packages: z.array(InstalledPackageSchema).describe('Installed packages'),
    total: z.number().int().optional().describe('Total matching packages'),
    nextCursor: z.string().optional().describe('Cursor for the next page'),
    hasMore: z.boolean().describe('Whether more packages are available'),
  }),
}).describe('List installed packages response'));
export type ListInstalledPackagesResponse = z.input<typeof ListInstalledPackagesResponseSchema>;
/** Post-parse shape of {@link ListInstalledPackagesResponse} — defaults applied, transforms run (ADR-0122). */
export type ListInstalledPackagesResponseParsed = z.infer<typeof ListInstalledPackagesResponseSchema>;

// ==========================================
// 3. Get Package (GET /api/v1/packages/:packageId)
// ==========================================

/**
 * Request for getting a single installed package.
 */
export const GetInstalledPackageRequestSchema = lazySchema(() => PackagePathParamsSchema);
export type GetInstalledPackageRequest = z.input<typeof GetInstalledPackageRequestSchema>;

/**
 * Response for getting a single installed package.
 */
export const GetInstalledPackageResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: InstalledPackageSchema.describe('Installed package details'),
}).describe('Get installed package response'));
export type GetInstalledPackageResponse = z.input<typeof GetInstalledPackageResponseSchema>;
/** Post-parse shape of {@link GetInstalledPackageResponse} — defaults applied, transforms run (ADR-0122). */
export type GetInstalledPackageResponseParsed = z.infer<typeof GetInstalledPackageResponseSchema>;

// ==========================================
// 4. Install Package (POST /api/v1/packages/install)
// ==========================================

/**
 * Request body for installing a package.
 *
 * @example POST /api/v1/packages/install
 * { manifest: {...}, platformVersion: '3.2.0', enableOnInstall: true }
 */
export const PackageInstallRequestSchema = lazySchema(() => z.object({
  /** Package manifest to install */
  manifest: ManifestSchema.describe('Package manifest to install'),

  /** User-provided settings at install time */
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('User-provided settings at install time'),

  /** Whether to enable immediately after install */
  enableOnInstall: z.boolean().default(true)
    .describe('Whether to enable immediately after install'),

  /** Current platform version for compatibility verification */
  platformVersion: z.string().optional()
    .describe('Current platform version for compatibility verification'),

  /** Artifact reference for the package (if installing from marketplace) */
  artifactRef: ArtifactReferenceSchema.optional()
    .describe('Artifact reference for marketplace installation'),
}).describe('Install package request'));
export type PackageInstallRequest = z.input<typeof PackageInstallRequestSchema>;
/** Post-parse shape of {@link PackageInstallRequest} — defaults applied, transforms run (ADR-0122). */
export type PackageInstallRequestParsed = z.infer<typeof PackageInstallRequestSchema>;

/**
 * Response after installing a package.
 */
export const PackageInstallResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    package: InstalledPackageSchema.describe('Installed package details'),
    dependencyResolution: DependencyResolutionResultSchema.optional()
      .describe('Dependency resolution result'),
    namespaceConflicts: z.array(z.object({
      type: z.literal('namespace_conflict').describe('Error type'),
      requestedNamespace: z.string().describe('Requested namespace'),
      conflictingPackageId: z.string().describe('Conflicting package ID'),
      conflictingPackageName: z.string().describe('Conflicting package name'),
      suggestion: z.string().optional().describe('Suggested alternative'),
    })).optional().describe('Namespace conflicts detected'),
    message: z.string().optional().describe('Installation status message'),
  }),
}).describe('Install package response'));
export type PackageInstallResponse = z.input<typeof PackageInstallResponseSchema>;
/** Post-parse shape of {@link PackageInstallResponse} — defaults applied, transforms run (ADR-0122). */
export type PackageInstallResponseParsed = z.infer<typeof PackageInstallResponseSchema>;

// ==========================================
// 5. Upgrade Package (POST /api/v1/packages/upgrade)
// ==========================================

/**
 * Request body for upgrading a package.
 *
 * @example POST /api/v1/packages/upgrade
 * { packageId: 'com.acme.crm', targetVersion: '2.0.0', createSnapshot: true }
 */
export const PackageUpgradeRequestSchema = lazySchema(() => z.object({
  /** Package ID to upgrade */
  packageId: z.string().describe('Package ID to upgrade'),

  /** Target version (defaults to latest) */
  targetVersion: z.string().optional()
    .describe('Target version (defaults to latest)'),

  /** New manifest for the target version */
  manifest: ManifestSchema.optional()
    .describe('New manifest for the target version'),

  /** Whether to create a pre-upgrade snapshot */
  createSnapshot: z.boolean().default(true)
    .describe('Whether to create a pre-upgrade backup snapshot'),

  /** Merge strategy for handling customizations */
  mergeStrategy: z.enum(['keep-custom', 'accept-incoming', 'three-way-merge'])
    .default('three-way-merge')
    .describe('How to handle customer customizations'),

  /** Preview upgrade without making changes */
  dryRun: z.boolean().default(false)
    .describe('Preview upgrade without making changes'),

  /** Skip pre-upgrade compatibility checks */
  skipValidation: z.boolean().default(false)
    .describe('Skip pre-upgrade compatibility checks'),
}).describe('Upgrade package request'));
export type PackageUpgradeRequest = z.input<typeof PackageUpgradeRequestSchema>;
/** Post-parse shape of {@link PackageUpgradeRequest} — defaults applied, transforms run (ADR-0122). */
export type PackageUpgradeRequestParsed = z.infer<typeof PackageUpgradeRequestSchema>;

/**
 * Response after upgrading a package.
 */
export const PackageUpgradeResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    success: z.boolean().describe('Whether the upgrade succeeded'),
    phase: z.string().describe('Current upgrade phase'),
    plan: UpgradePlanSchema.optional().describe('Upgrade plan that was executed'),
    snapshotId: z.string().optional().describe('Snapshot ID for rollback'),
    conflicts: z.array(z.object({
      path: z.string().describe('Conflict path'),
      baseValue: z.unknown().describe('Base value'),
      incomingValue: z.unknown().describe('Incoming value'),
      customValue: z.unknown().describe('Custom value'),
    })).optional().describe('Unresolved merge conflicts'),
    errorMessage: z.string().optional().describe('Error message if failed'),
    message: z.string().optional().describe('Human-readable status message'),
  }),
}).describe('Upgrade package response'));
export type PackageUpgradeResponse = z.input<typeof PackageUpgradeResponseSchema>;
/** Post-parse shape of {@link PackageUpgradeResponse} — defaults applied, transforms run (ADR-0122). */
export type PackageUpgradeResponseParsed = z.infer<typeof PackageUpgradeResponseSchema>;

// ==========================================
// 6. Resolve Dependencies (POST /api/v1/packages/resolve-dependencies)
// ==========================================

/**
 * Request body for resolving package dependencies.
 *
 * @example POST /api/v1/packages/resolve-dependencies
 * { manifest: {...}, platformVersion: '3.2.0' }
 */
export const ResolveDependenciesRequestSchema = lazySchema(() => z.object({
  /** Package manifest whose dependencies to resolve */
  manifest: ManifestSchema.describe('Package manifest to resolve dependencies for'),

  /** Current platform version for compatibility checking */
  platformVersion: z.string().optional()
    .describe('Current platform version for compatibility filtering'),
}).describe('Resolve dependencies request'));
export type ResolveDependenciesRequest = z.input<typeof ResolveDependenciesRequestSchema>;
/** Post-parse shape of {@link ResolveDependenciesRequest} — defaults applied, transforms run (ADR-0122). */
export type ResolveDependenciesRequestParsed = z.infer<typeof ResolveDependenciesRequestSchema>;

/**
 * Response with dependency resolution results.
 */
export const ResolveDependenciesResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: DependencyResolutionResultSchema.describe('Dependency resolution result with topological sort'),
}).describe('Resolve dependencies response'));
export type ResolveDependenciesResponse = z.input<typeof ResolveDependenciesResponseSchema>;
/** Post-parse shape of {@link ResolveDependenciesResponse} — defaults applied, transforms run (ADR-0122). */
export type ResolveDependenciesResponseParsed = z.infer<typeof ResolveDependenciesResponseSchema>;

// ==========================================
// 7. Upload Artifact (POST /api/v1/packages/upload)
// ==========================================

/**
 * Request body for uploading a package artifact.
 *
 * @example POST /api/v1/packages/upload
 * Content-Type: multipart/form-data
 * { artifact: <metadata>, file: <binary> }
 */
export const UploadArtifactRequestSchema = lazySchema(() => z.object({
  /** Artifact metadata */
  artifact: PackageArtifactSchema.describe('Package artifact metadata'),

  /** SHA256 checksum of the uploaded file (for verification) */
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
    .describe('SHA256 checksum of the uploaded file'),

  /** Publisher authentication token */
  token: z.string().optional()
    .describe('Publisher authentication token'),

  /** Release notes for this version */
  releaseNotes: z.string().optional()
    .describe('Release notes for this version'),
}).describe('Upload artifact request'));
export type UploadArtifactRequest = z.input<typeof UploadArtifactRequestSchema>;
/** Post-parse shape of {@link UploadArtifactRequest} — defaults applied, transforms run (ADR-0122). */
export type UploadArtifactRequestParsed = z.infer<typeof UploadArtifactRequestSchema>;

/**
 * Response after uploading a package artifact.
 */
export const UploadArtifactResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    /** Whether the upload succeeded */
    success: z.boolean().describe('Whether the upload succeeded'),
    /** Artifact reference for the uploaded package */
    artifactRef: ArtifactReferenceSchema.optional()
      .describe('Artifact reference in the registry'),
    /** Submission ID for review tracking */
    submissionId: z.string().optional()
      .describe('Marketplace submission ID for review tracking'),
    /** Message */
    message: z.string().optional().describe('Upload status message'),
  }),
}).describe('Upload artifact response'));
export type UploadArtifactResponse = z.input<typeof UploadArtifactResponseSchema>;
/** Post-parse shape of {@link UploadArtifactResponse} — defaults applied, transforms run (ADR-0122). */
export type UploadArtifactResponseParsed = z.infer<typeof UploadArtifactResponseSchema>;

// ==========================================
// 8. Rollback Package (POST /api/v1/packages/:packageId/rollback)
// ==========================================

/**
 * Request body for rolling back a package upgrade.
 */
export const PackageRollbackRequestSchema = lazySchema(() => PackagePathParamsSchema.extend({
  /** Snapshot ID to restore from */
  snapshotId: z.string().describe('Snapshot ID to restore from'),

  /** Whether to also rollback customizations */
  rollbackCustomizations: z.boolean().default(true)
    .describe('Whether to restore pre-upgrade customizations'),
}).describe('Rollback package request'));
export type PackageRollbackRequest = z.input<typeof PackageRollbackRequestSchema>;
/** Post-parse shape of {@link PackageRollbackRequest} — defaults applied, transforms run (ADR-0122). */
export type PackageRollbackRequestParsed = z.infer<typeof PackageRollbackRequestSchema>;

// RETIRED (#12038, maintainer ruling 2026-08-27, sub-question 3A):
// `PackageRollbackResponseSchema` (with its `PackageRollbackResponse` /
// `PackageRollbackResponseParsed` types) declared a VERSION rollback —
// `{ success, restoredVersion?, message? }` — while the live
// `POST /packages/:id/rollback` route posts `{ commitId }` and the dispatcher
// routes it to `rollbackToPackageCommit`, the ADR-0067 COMMIT rollback: a
// different operation with a different result. The `PackageApiContracts`
// `rollbackPackage` entry bound that wrong-operation schema to the exact live
// path, so a future sweep would have read the false declaration as
// authoritative. Both went through the ADR-0087 retirement discipline
// (`RETIRED_DEFS_BY_MAJOR` `api/PackageRollbackResponse`, D3 semantic entry
// `package-rollback-response-retired`). The TRUE contract for the live route
// is `RollbackToPackageCommitResponseSchema` in `./package-lifecycle.zod`.
// `PackageRollbackRequestSchema` above stays published as ruled — only the
// response declaration and the contract-map binding were retired; the request
// schema binds to no route now that the contracts entry is gone.

// ==========================================
// 9. Uninstall Package (DELETE /api/v1/packages/:packageId)
// ==========================================

/**
 * Request for uninstalling a package.
 */
export const UninstallPackageApiRequestSchema = lazySchema(() => PackagePathParamsSchema);
export type UninstallPackageApiRequest = z.input<typeof UninstallPackageApiRequestSchema>;

/**
 * Response after uninstalling a package.
 */
export const UninstallPackageApiResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    packageId: z.string().describe('Uninstalled package ID'),
    success: z.boolean().describe('Whether uninstall succeeded'),
    message: z.string().optional().describe('Uninstall status message'),
  }),
}).describe('Uninstall package response'));
export type UninstallPackageApiResponse = z.input<typeof UninstallPackageApiResponseSchema>;
/** Post-parse shape of {@link UninstallPackageApiResponse} — defaults applied, transforms run (ADR-0122). */
export type UninstallPackageApiResponseParsed = z.infer<typeof UninstallPackageApiResponseSchema>;

// ==========================================
// 10. Package API Error Codes
// ==========================================

/**
 * Error codes specific to Package operations.
 */
export const PackageApiErrorCode = z.enum([
  'package_not_found',
  'package_already_installed',
  'version_not_found',
  'dependency_conflict',
  'namespace_conflict',
  'platform_incompatible',
  'artifact_invalid',
  'checksum_mismatch',
  'signature_invalid',
  'upgrade_failed',
  'rollback_failed',
  'snapshot_not_found',
  'upload_failed',
]);
export type PackageApiErrorCode = z.input<typeof PackageApiErrorCode>;

// ==========================================
// 11. Package API Contract Registry
// ==========================================

/**
 * Standard Package API contracts map.
 * Used for generating SDKs, documentation, and route registration.
 */
export const PackageApiContracts = {
  listPackages: {
    method: 'GET' as const,
    path: '/api/v1/packages',
    input: ListInstalledPackagesRequestSchema,
    output: ListInstalledPackagesResponseSchema,
  },
  getPackage: {
    method: 'GET' as const,
    path: '/api/v1/packages/:packageId',
    input: GetInstalledPackageRequestSchema,
    output: GetInstalledPackageResponseSchema,
  },
  installPackage: {
    method: 'POST' as const,
    path: '/api/v1/packages/install',
    input: PackageInstallRequestSchema,
    output: PackageInstallResponseSchema,
  },
  upgradePackage: {
    method: 'POST' as const,
    path: '/api/v1/packages/upgrade',
    input: PackageUpgradeRequestSchema,
    output: PackageUpgradeResponseSchema,
  },
  resolveDependencies: {
    method: 'POST' as const,
    path: '/api/v1/packages/resolve-dependencies',
    input: ResolveDependenciesRequestSchema,
    output: ResolveDependenciesResponseSchema,
  },
  uploadArtifact: {
    method: 'POST' as const,
    path: '/api/v1/packages/upload',
    input: UploadArtifactRequestSchema,
    output: UploadArtifactResponseSchema,
  },
  // `rollbackPackage` RETIRED (#12038 3A) — it bound the version-rollback
  // schemas to the live `/api/v1/packages/:packageId/rollback` path, which
  // actually serves the ADR-0067 COMMIT rollback (`rollbackToPackageCommit`).
  // The live route's true contract is `RollbackToPackageCommitResponseSchema`
  // (`./package-lifecycle.zod`), named by its route-ledger row.
  uninstallPackage: {
    method: 'DELETE' as const,
    path: '/api/v1/packages/:packageId',
    input: UninstallPackageApiRequestSchema,
    output: UninstallPackageApiResponseSchema,
  },
};
