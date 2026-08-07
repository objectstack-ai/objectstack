// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Package Version Protocol
 *
 * A **package version** is an **immutable** release snapshot of a package.
 * Once published (`status = 'published'`), its `manifestJson` and `checksum`
 * fields are frozen — publishing is the act of sealing the snapshot.
 *
 * Lifecycle:
 *   draft → published → deprecated
 *
 * Installing a package means pointing a `sys_package_installation` row at a
 * specific `sys_package_version` UUID. Upgrading swaps that pointer atomically.
 *
 * See `docs/adr/0003-package-as-first-class-citizen.md` for the full rationale.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Package version lifecycle status.
 *
 * - `draft`       — being authored; can be mutated; cannot be installed in production
 * - `published`   — immutable snapshot; installable in any environment
 * - `deprecated`  — published but superseded; existing installs continue to work
 *                   but new installs are blocked (unless `allowDeprecated = true`)
 */
import { lazySchema } from '../shared/lazy-schema';
export const PackageVersionStatusSchema = lazySchema(() => z
  .enum(['draft', 'published', 'deprecated'])
  .describe('Package version lifecycle status'));

export type PackageVersionStatus = z.infer<typeof PackageVersionStatusSchema>;

// ---------------------------------------------------------------------------
// Manifest content schemas (embedded in packageVersion.manifestJson)
// ---------------------------------------------------------------------------

/**
 * A single dependency declared in a package manifest.
 * Follows npm-style `"package_id": "version_range"` semantics.
 *
 * This is the DECLARATION-side shape — what an author writes into
 * `manifestJson.dependencies[]`. The resolver-side shape (a constraint plus
 * the `resolvedVersion` it resolved to) is a different concept and lives in
 * `@objectstack/spec/kernel` as `ResolvedPackageDependency`; before #4741 it
 * also went by `PackageDependency`, so which type a consumer got depended on
 * nothing but the import path (#4411). The bare name is now this one alone.
 */
export const PackageDependencySchema = lazySchema(() => z.object({
  /** Manifest ID of the required package (e.g. `com.objectstack.core`). */
  packageId: z.string().describe('Manifest ID of the dependency'),
  /** Required version range (semver, e.g. "^1.0.0"). */
  versionRange: z.string().describe('Semver version range (e.g. ^1.0.0)'),
  /** Whether this dependency is optional (missing dep is a warning, not an error). */
  optional: z.boolean().default(false).describe('Whether this dependency is optional'),
}).describe('Package dependency declaration'));

export type PackageDependency = z.infer<typeof PackageDependencySchema>;
/** Post-parse shape of {@link PackageDependency} — defaults applied, transforms run (ADR-0122). */
export type PackageDependencyParsed = z.infer<typeof PackageDependencySchema>;

/**
 * Lightweight manifest embedded in `sys_package_version.manifest_json`.
 *
 * This is the frozen snapshot of what the package declares at publish time.
 * The runtime uses this to know what metadata records to load and what
 * minimum platform version is required.
 */
export const PackageManifestSchema = lazySchema(() => z.object({
  /** Manifest ID (must match the parent `sys_package.manifest_id`). */
  id: z.string().describe('Package manifest ID (reverse-domain)'),

  /** Semantic version of this release. */
  version: z.string().describe('Semver version string (e.g. 1.2.3)'),

  /** Human-readable display name. */
  name: z.string().describe('Display name'),

  /** Short description. */
  description: z.string().optional().describe('Short description'),

  /**
   * Package scope — determines where it runs.
   * - `platform`    — provided by the runtime; cannot be installed per-env
   * - `environment` — installed into a specific environment
   */
  scope: z.enum(['platform', 'environment']).default('environment').describe('Package scope'),

  /** Minimum ObjectStack platform version required. */
  minPlatformVersion: z.string().optional().describe('Minimum required platform version (semver)'),

  /** List of packages this version depends on. */
  dependencies: z.array(PackageDependencySchema).default([]).describe('Package dependencies'),

  /**
   * Names of metadata types included in this package version.
   * Used by the installer to know which `sys_metadata` rows belong to it.
   * Example: `["object", "view", "flow", "translation"]`
   */
  metadataTypes: z.array(z.string()).default([]).describe('Metadata types provided by this package'),

  /**
   * List of migration script identifiers included in this version,
   * ordered by execution sequence. Applied to the environment DB on install/upgrade.
   */
  migrations: z.array(z.string()).default([]).describe('Migration script identifiers (ordered)'),

  /** Free-form configuration schema (JSON Schema) for per-install settings. */
  configurationSchema: z.record(z.string(), z.unknown()).optional()
    .describe('JSON Schema for per-installation configuration properties'),

  /** Free-form extension metadata. */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Extension metadata'),
}).describe('Package manifest snapshot embedded in a package version'));

export type PackageManifest = z.infer<typeof PackageManifestSchema>;
/** Post-parse shape of {@link PackageManifest} — defaults applied, transforms run (ADR-0122). */
export type PackageManifestParsed = z.infer<typeof PackageManifestSchema>;

// ---------------------------------------------------------------------------
// sys_package_version — Immutable release snapshot
// ---------------------------------------------------------------------------

/**
 * One row in `sys_package_version` — a sealed, versioned release of a package.
 *
 * The triple `(packageId, version)` is UNIQUE.
 * Once `status = 'published'`, `manifestJson` and `checksum` MUST NOT change.
 */
export const PackageVersionSchema = lazySchema(() => z.object({
  /** UUID of the version row (stable, never reused). */
  id: z.string().uuid().describe('UUID of the package version (stable, never reused)'),

  /** Parent package this version belongs to. */
  packageId: z.string().uuid().describe('UUID of the parent sys_package row'),

  /** Semantic version string (e.g. `1.2.3`, `2.0.0-beta.1`). */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?(\+[a-z0-9.-]+)?$/)
    .describe('Semantic version string'),

  /** Lifecycle status. Immutable fields freeze on transition to "published". */
  status: PackageVersionStatusSchema.default('draft'),

  /**
   * Full package manifest frozen at publish time.
   * Stored as a JSON-serialized string for portability across database drivers.
   */
  manifestJson: z.string().describe('JSON-serialized package manifest (frozen on publish)'),

  /**
   * SHA-256 hex digest of `manifestJson`.
   * Verified by the installer to detect corrupt or tampered snapshots.
   */
  checksum: z.string().regex(/^[a-f0-9]{64}$/).optional()
    .describe('SHA-256 hex digest of manifestJson'),

  /** Human-readable release notes (markdown). */
  releaseNotes: z.string().optional().describe('Release notes for this version (markdown)'),

  /** Minimum ObjectStack platform version required (denormalized from manifest for fast queries). */
  minPlatformVersion: z.string().optional()
    .describe('Minimum required platform version (denormalized from manifest)'),

  /** Whether this version is a pre-release (beta, rc, alpha). */
  isPreRelease: z.boolean().default(false).describe('Whether this is a pre-release version'),

  /** Timestamp when the version was published (null while draft). */
  publishedAt: z.string().datetime().optional().describe('Publish timestamp (ISO-8601)'),

  /** User ID who published this version. */
  publishedBy: z.string().optional().describe('User ID who published this version'),

  /** Creation timestamp (ISO-8601). */
  createdAt: z.string().datetime().describe('Creation timestamp (ISO-8601)'),

  /** Last update timestamp (ISO-8601). Only mutable while status is "draft". */
  updatedAt: z.string().datetime().describe('Last update timestamp (ISO-8601)'),

  /** User ID that created this version row. */
  createdBy: z.string().describe('User ID that created this version'),
}));

export type PackageVersion = z.infer<typeof PackageVersionSchema>;
/** Post-parse shape of {@link PackageVersion} — defaults applied, transforms run (ADR-0122). */
export type PackageVersionParsed = z.infer<typeof PackageVersionSchema>;

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

/**
 * Request to create a new draft package version.
 */
export const CreatePackageVersionRequestSchema = lazySchema(() => z.object({
  packageId: z.string().uuid().describe('Parent package UUID'),
  version: PackageVersionSchema.shape.version,
  manifestJson: z.string().describe('Initial manifest JSON (can be updated while draft)'),
  releaseNotes: z.string().optional(),
  isPreRelease: z.boolean().optional(),
  createdBy: z.string().describe('User ID creating this version'),
}).describe('Create a new draft package version'));

export type CreatePackageVersionRequest = z.infer<typeof CreatePackageVersionRequestSchema>;

/**
 * Request to update a draft version's manifest before publishing.
 * Only allowed while `status = 'draft'`.
 */
export const UpdatePackageVersionRequestSchema = lazySchema(() => z.object({
  manifestJson: z.string().optional().describe('Updated manifest JSON'),
  releaseNotes: z.string().optional(),
  isPreRelease: z.boolean().optional(),
}).describe('Update a draft package version (only while status is draft)'));

export type UpdatePackageVersionRequest = z.infer<typeof UpdatePackageVersionRequestSchema>;

/**
 * Request to publish a draft version (seals manifestJson and checksum).
 */
export const PublishPackageVersionRequestSchema = lazySchema(() => z.object({
  publishedBy: z.string().describe('User ID publishing this version'),
}).describe('Publish a draft version — seals manifestJson and checksum'));

export type PublishPackageVersionRequest = z.infer<typeof PublishPackageVersionRequestSchema>;
