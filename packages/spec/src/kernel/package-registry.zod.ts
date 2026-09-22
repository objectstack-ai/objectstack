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
   * The package manifest at the AUTHORING stage — this row's manifest is
   * `ManifestSchema`, and that is a STAGE, not "whatever was stored".
   *
   * ⚠️ **Do not read this declaration as the shape of every registry row.**
   * `SchemaRegistry.installPackage` records whatever its caller handed it, and
   * two callers hand it two different stages:
   *
   *  - `POST /api/v1/packages` declares `manifest: ManifestSchema` and passes
   *    the AUTHORING manifest — the stage this row names, whose `objects` and
   *    `datasources` are glob patterns and whose `permissions` is the ADR-0025
   *    capability grant;
   *  - a `defineStack()` host reaches the same table through
   *    `ObjectQL.registerApp`, which installs the ASSEMBLED body — `objects`
   *    and `datasources` are DEFINITIONS and `permissions` is the ADR-0090
   *    `PermissionSet[]` collection.
   *
   * The assembled stage has its own declaration rather than a widening of this
   * one: `AssembledInstalledPackageSchema` (`../api/package-api.zod.ts`) over
   * `AssembledPackageBodySchema` (`../stack.zod.ts`), the maintainer's road B
   * of 2026-09-02 — «declare the assembled stage rather than widen the
   * authoring one». The read doors (`GET /packages`, `GET /packages/:id`)
   * therefore serve `InstalledPackageAtEitherStageSchema`, a union of two whole
   * closed stages, and a consumer parsing a registry row against THIS schema
   * alone will refuse every row a `defineStack()` host installed.
   *
   * ⛔ Never relax this branch — or `ManifestSchema` — to make an assembled row
   * fit. Widening a key into a union of both spellings was road C and was
   * rejected by name: it makes neither stage checkable (Prime Directive #12).
   */
  manifest: ManifestSchema.describe('Package manifest at the AUTHORING stage; a row installed by a `defineStack()` host carries the assembled body instead — see `AssembledInstalledPackageSchema` / `InstalledPackageAtEitherStageSchema`'),

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
  /**
   * Whether to enable the package immediately after install.
   *
   * ## A RESTATEMENT of the install-request key — the one authority is
   * `PackageInstallRequestSchema` in `src/api/package-api.zod.ts`
   *
   * Same type, same optionality, same meaning: this is a COPY of the request
   * key, not a second key that happens to share a spelling. The authority is
   * the request contract bound to the door that actually serves —
   * `POST /api/v1/packages` (`packages/runtime/src/domains/packages.ts`).
   * ⛔ Never let the two drift: `src/api/package-install-one-authority.test.ts`
   * parses BOTH over one matrix and reds when they disagree on any cell.
   *
   * ## ⭐ THREE STATES — absence is one, and it is not a default
   *
   * `true` enables the row, `false` disables it, and ABSENT keeps the row's
   * current lifecycle state; a fresh id has no state to keep and lands
   * ENABLED. 「缺省 = 保持，有旗 = 设置」, ruled in maintainer batch #157 item 5
   * letter C for the door and carried onto the declarations in batch #210
   * item 4 letter A. ⛔ This key is therefore `optional()` and never
   * `.default(true)`: a default resolves absence at parse time, which erases
   * the third state from the published surface while the door still honours
   * it.
   *
   * ## ⭐ This contract's own implementation HONOURS the key — on the registry row
   *
   * This schema types the in-process protocol primitive
   * `ObjectStackProtocol.installPackage` (`src/api/protocol.zod.ts`), and that
   * implementation (`packages/metadata-protocol/src/protocol.ts`) applies the
   * same rule the HTTP door applies — 「缺省 = 保持，有旗 = 设置」 — through the
   * same registry verbs `PATCH /packages/:id/enable` and
   * `PATCH /packages/:id/disable` use:
   *
   * - `true` ⇒ `enablePackage` — clears a disable, including a boot-seeded one;
   * - `false` ⇒ `disablePackage` — the row and its `status` both move;
   * - ABSENT ⇒ no lifecycle call at all; the row the registry returned stands.
   *
   * `=== true` / `=== false`, never a truthiness test and never a `??` default:
   * the THREE states are the contract, and a non-boolean value is read as
   * ABSENT rather than coerced. The declaration below resolves nothing on an
   * absent key — it is `optional()`, and ⛔ never `.default(true)`, precisely
   * so that the third state survives the parse — and nothing parses an install
   * request through this schema on that path anyway, so an absent key arrives
   * intact and is read as absent.
   *
   * ⚠️ What this seam does NOT write, stated so the scope is not over-read: the
   * runtime's DURABLE disabled-package file. That record is keyed by
   * ENVIRONMENT (`setPackageDisabled(environmentId, id, disabled)`,
   * `packages/runtime/src/package-state-store.ts`) and an
   * `InstallPackageRequest` carries no environment, so the key cannot even be
   * formed here; that module also lives in `@objectstack/runtime`, which
   * depends on the protocol package and not the other way round. It is also why
   * the HTTP door still calls `installPackage({ manifest, settings })` and
   * performs its own enable/disable flip afterwards rather than forwarding the
   * key down this seam: the durable half must follow the ROW that door returned
   * rather than the request's intent. So an `enableOnInstall` spelled on THIS
   * request moves the registry row — what every in-process reader serves from —
   * for the life of the process; a caller that needs the choice to survive a
   * restart goes through `POST /api/v1/packages`.
   *
   * ## ⛔ Why the reference is documentary and not `…Schema.shape.…`
   *
   * `PackageInstallRequestSchema` sits ABOVE this module in the import graph —
   * it is built from `ManifestSchema` and `InstalledPackageSchema`, both
   * declared here — so a reference from here up to it is an import cycle. It
   * is not a cycle the `lazySchema` proxy absorbs: under `OS_EAGER_SCHEMAS=1`,
   * the mode `gen:schema` and `check:authorable-surface` run in, the factory
   * bodies evaluate at module load and the cycle dies with
   * `ReferenceError: Cannot access 'InstalledPackageSchema' before
   * initialization`. Measured in both directions, on this key, before this
   * doc block was written. ⛔ Do not "fix" this into
   * `PackageInstallRequestSchema.shape.enableOnInstall` — the pin above is the
   * mechanical half of the reference, and it is the half that can fail.
   */
  enableOnInstall: z.boolean().optional()
    .describe('Whether to enable immediately after install — restates the install-door request key, whose one authority is api/PackageInstallRequest; this protocol primitive honours it on the registry row: `true` enables, `false` disables, and ABSENT keeps the row\'s current lifecycle state (a fresh install lands enabled)'),
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
