// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IPackageService - Package Lifecycle Service Contract
 *
 * Defines the interface for runtime package management operations including:
 * - Package installation with dependency resolution
 * - Platform compatibility enforcement
 * - Namespace conflict detection
 *
 * Follows Dependency Inversion Principle - consumers depend on this interface,
 * not on concrete package manager implementations.
 *
 * ## Architecture Alignment
 * - **Salesforce**: PackageInstallHandler with dependency validation
 * - **npm**: pacote + arborist for install/resolve
 * - **Helm**: helm install lifecycle
 * - **Kubernetes**: controller-runtime reconcile loop
 */

import type { InstalledPackage, NamespaceConflictError } from '../kernel/package-registry.zod';
import type { DependencyResolutionResult } from '../kernel/dependency-resolution.zod';
import type { PackageArtifact } from '../kernel/package-artifact.zod';
import type { ObjectStackManifest } from '../kernel/manifest.zod';

// ==========================================
// Install Types
// ==========================================

/**
 * Input for installing a package.
 */
export interface InstallPackageInput {
  /** The package manifest to install */
  manifest: ObjectStackManifest;
  /** User-provided settings at install time */
  settings?: Record<string, unknown>;
  /** Whether to enable immediately after install (default: true) */
  enableOnInstall?: boolean;
  /** Current platform version for compatibility checking */
  platformVersion?: string;
}

/**
 * Result of installing a package.
 */
export interface InstallPackageResult {
  /** The installed package */
  package: InstalledPackage;
  /** Dependency resolution result */
  dependencyResolution?: DependencyResolutionResult;
  /** Namespace conflicts detected (empty if none) */
  namespaceConflicts?: NamespaceConflictError[];
  /** Human-readable message */
  message?: string;
}

// ==========================================
// Dependency Resolution Types
// ==========================================

/**
 * Input for resolving dependencies.
 */
export interface ResolveDependenciesInput {
  /** The package manifest whose dependencies to resolve */
  manifest: ObjectStackManifest;
  /** Current platform version for compatibility filtering */
  platformVersion?: string;
}

// ==========================================
// Namespace Types
// ==========================================

/**
 * Input for checking namespace availability.
 */
export interface CheckNamespaceInput {
  /** Namespace prefixes to check */
  namespaces: string[];
  /** Package ID requesting the namespaces */
  packageId: string;
}

/**
 * Result of namespace availability check.
 */
export interface CheckNamespaceResult {
  /** Whether all namespaces are available */
  available: boolean;
  /** Conflicts found (if any) */
  conflicts: NamespaceConflictError[];
}

// The upgrade types (`PlanUpgradeInput`, `ExecuteUpgradeInput`,
// `RollbackInput`) were RETIRED with `kernel/package-upgrade.zod.ts` (#25608,
// ADR-0049 enforce-or-remove) together with the four `IPackageService`
// members that took them: no provider ever implemented any of them.

// ==========================================
// Artifact Upload Types
// ==========================================

/**
 * Input for uploading a package artifact.
 *
 * Carries both pure-metadata packages and code-bearing `.osplugin` plugins
 * (ADR-0025): the plugin fields below are optional and absent for metadata
 * packages. They align with the cloud control plane's plugin publish path
 * (`preparePluginVersion` / `verifyPublisherSignature`).
 */
export interface UploadArtifactInput {
  /** Package artifact metadata */
  artifact: PackageArtifact;
  /** Binary content (base64-encoded or stream reference) */
  content: string;
  /** Publisher authentication token */
  token?: string;

  // ---- Plugin distribution (ADR-0025) ----

  /**
   * Artifact discriminator. `plugin` triggers the signed/permissioned
   * path (verify signature → permission audit → store blob → pending review);
   * `metadata` (default) is the legacy pure-metadata fast path.
   */
  kind?: 'metadata' | 'plugin';
  /**
   * Detached publisher signature over the raw artifact bytes, in the
   * canonical `ed25519:<keyId>:<base64url>` format (produced by
   * `os plugin sign`). Verified server-side before the version is stored.
   */
  signature?: string;
  /**
   * Expected SHA-256 (hex) of the artifact bytes for tamper detection on
   * upload. The server recomputes and rejects on mismatch.
   */
  expectedChecksum?: string;
}

/**
 * Result of uploading a package artifact.
 */
export interface UploadArtifactResult {
  /** Whether the upload succeeded */
  success: boolean;
  /** URL of the uploaded artifact */
  artifactUrl?: string;
  /** SHA256 checksum of the uploaded artifact */
  sha256?: string;
  /** Error message if upload failed */
  errorMessage?: string;

  // ---- Plugin distribution (ADR-0025) ----

  /** Identifier of the created package version row (e.g. sys_package_version id). */
  versionId?: string;
  /**
   * Listing/review state after upload — e.g. `pending_review` when a plugin
   * requires human approval before it can be installed (ADR §3.7).
   */
  listingStatus?: string;
  /**
   * Whether the publisher signature was present AND cryptographically
   * verified. `false` means accepted-but-unverified (trust tier gates apply)
   * or no signature supplied.
   */
  signatureVerified?: boolean;
}

// ==========================================
// Service Interface
// ==========================================

export interface IPackageService {
  // ---- Installation ----

  /**
   * Install a package with full lifecycle checks.
   * Validates dependencies, platform compatibility, and namespace availability.
   * @param input - Installation parameters
   * @returns Installed package with resolution details
   */
  install(input: InstallPackageInput): Promise<InstallPackageResult>;

  /**
   * Uninstall a package by ID.
   * @param packageId - Package to uninstall
   * @returns Whether uninstall succeeded
   */
  uninstall(packageId: string): Promise<{ success: boolean; message?: string }>;

  // ---- Query ----

  /**
   * Get an installed package by ID.
   * @param packageId - Package identifier
   * @returns Installed package or null
   */
  getPackage(packageId: string): Promise<InstalledPackage | null>;

  /**
   * List all installed packages.
   * @param options - Optional filter criteria
   * @returns Array of installed packages
   */
  listPackages(options?: { status?: string; enabled?: boolean }): Promise<InstalledPackage[]>;

  // ---- Dependency Resolution ----

  /**
   * Resolve dependencies for a package manifest.
   * Performs topological sort, conflict detection, and platform compatibility checks.
   * @param input - Resolution parameters
   * @returns Full dependency resolution result
   */
  resolveDependencies(input: ResolveDependenciesInput): Promise<DependencyResolutionResult>;

  // ---- Namespace Management ----

  /**
   * Check namespace availability before installation.
   * @param input - Namespaces to check
   * @returns Availability result with any conflicts
   */
  checkNamespaces(input: CheckNamespaceInput): Promise<CheckNamespaceResult>;

  // ---- Upgrade Lifecycle ---- RETIRED (#25608): `planUpgrade`, `upgrade`,
  // `rollback` and `getSnapshot` left with the zero-consumer upgrade model.
  // The rollback the platform serves is the ADR-0067 commit rollback
  // (`POST /api/v1/packages/:id/rollback`, `RollbackToPackageCommitResponseSchema`);
  // an upgrade is a re-install with `overwrite: true`.

  // ---- Artifact Management ----

  /**
   * Upload a package artifact to the registry.
   * Validates checksums, signatures, and artifact structure.
   * @param input - Upload parameters
   * @returns Upload result
   */
  uploadArtifact?(input: UploadArtifactInput): Promise<UploadArtifactResult>;

  // ---- Enable/Disable ----

  /**
   * Enable or disable an installed package.
   * @param packageId - Package identifier
   * @param enabled - Whether to enable or disable
   * @returns Updated package state
   */
  togglePackage?(packageId: string, enabled: boolean): Promise<InstalledPackage>;
}
