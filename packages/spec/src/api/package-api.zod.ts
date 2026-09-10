// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { InstalledPackageSchema } from '../kernel/package-registry.zod';
import { DependencyResolutionResultSchema } from '../kernel/dependency-resolution.zod';
import { UpgradePlanSchema } from '../kernel/package-upgrade.zod';
import { PackageArtifactSchema } from '../kernel/package-artifact.zod';
import { ManifestSchema } from '../kernel/manifest.zod';
import { ArtifactReferenceSchema } from '../marketplace/marketplace.zod';
import { AssembledPackageBodySchema } from '../stack.zod';

/**
 * # Package API Protocol
 *
 * REST API endpoint schemas for package lifecycle management.
 *
 * Base path: /api/v1/packages
 *
 * @example Endpoints
 * ```
 * POST   /api/v1/packages/install              — Install a package
 * POST   /api/v1/packages/upgrade              — Upgrade a package
 * POST   /api/v1/packages/resolve-dependencies — Resolve dependencies
 * POST   /api/v1/packages/upload               — Upload an artifact
 * GET    /api/v1/packages                      — List installed packages
 * GET    /api/v1/packages/:packageId           — Get package details
 * POST   /api/v1/packages/:packageId/rollback  — Rollback a package
 * DELETE /api/v1/packages/:packageId           — Uninstall a package
 * ```
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
// Installed Package Rows — the two declared manifest STAGES
// ==========================================

/**
 * One installed-package row whose `manifest` is the ASSEMBLED package body —
 * the assembled-stage counterpart of {@link InstalledPackageSchema}.
 *
 * ## The stage this exists to name
 *
 * `InstalledPackageSchema.manifest` is `ManifestSchema`, the AUTHORING stage:
 * its `objects` is `z.array(z.string())`, GLOB PATTERNS naming files a
 * file-based loader should read. What a `defineStack()` host installs is the
 * ASSEMBLED body, whose `objects` are object DEFINITIONS — `ObjectQL.registerApp`
 * is handed exactly that and iterates it into `registerObject(objDef, …)`, and
 * `SchemaRegistry.installPackage` records what it was handed. So the read doors
 * serve rows the authoring declaration refuses, with a single surviving reason:
 * the manifest stage.
 *
 * That is the mismatch #14242 identified one layer down, and this declaration
 * follows its ruling rather than re-deriving one. The maintainer's decision
 * (2026-09-02, road B), quoted at `ArtifactPackageSchema` in `../stack.zod`,
 * was to «declare the assembled stage rather than widen the authoring one».
 * ⛔ Widening `ManifestSchema.objects` into a union of both spellings was road
 * C and was REJECTED by name: a union AT THE KEY makes neither stage checkable,
 * which is the tolerate-at-the-consumer shape Prime Directive #12 refuses. So
 * `ManifestSchema` is untouched here — still `strictObject`, still globs — and
 * the assembled stage gets its own name, built from `AssembledPackageBodySchema`
 * (#14242's own declaration) rather than a second transcription of it.
 *
 * The body half is deliberately typed `Record<string, unknown>`; the reason is
 * recorded at `AssembledPackageBodySchema` and is not repeated here. The RUNTIME
 * schema still carries the manifest's every field plus every collection's full
 * declaration, so a wrong-shaped body is refused exactly as it is there — with
 * the one measured exception {@link AssembledPackageRecordBodySchema} states
 * and pins.
 */
/**
 * The assembled package body AS THE REGISTRY RECORDS IT — the same declaration,
 * with the two collections that have no JSON form left unchecked.
 *
 * ## Why this exists at all, measured rather than assumed
 *
 * `SchemaRegistry.installPackage` does not store the caller's object; it stores
 * `toRecordManifest(manifest)`, a structural JSON projection that DROPS
 * functions, class instances, `Map`, `Set` and every other exotic value. So the
 * row this API serves is JSON by construction, and two of the assembled body's
 * 55 collections cannot survive that projection in the shape they declare:
 *
 * - `functions` — a `z.function()` branch (a named callable);
 * - `hooks` — a `z.custom()` branch (a lifecycle handler).
 *
 * Those same two are the reason `AssembledPackageBodySchema` has NO JSON Schema
 * at all: `z.toJSONSchema` refuses a function and a custom type, which is also
 * why `ArtifactPackageSchema` and `ObjectStackDefinitionSchema` publish none.
 * Embedding the body verbatim in the two published response schemas below made
 * BOTH of them disappear from `json-schema/api/`, which the build's own
 * disappearance ratchet refuses and whose only other remedy is retiring two
 * published defs. `build-schemas.ts` names the remedy taken here instead:
 * «make it emit — narrow the unrepresentable member».
 *
 * ⛔ The override set is NOT hand-picked, and must never become so. It is the
 * measured set of shape members with no JSON form, pinned key-by-key in
 * `./package-api.test.ts`: a new collection with no JSON form reddens there,
 * naming itself, instead of silently unpublishing these responses again.
 *
 * ⚠️ What `unknown` costs, stated plainly: on THIS surface those two keys are
 * accepted without being checked. It is a widening from today, where both are
 * refused outright by `ManifestSchema`'s strict close while the door really can
 * serve them — so the declaration moves from wrong to incomplete, never from
 * checked to tolerant. Every other key, `objects` included, is checked at the
 * assembled stage exactly as `AssembledPackageBodySchema` declares it. The
 * ARTIFACT surface is untouched and keeps both collections fully declared.
 */
const AssembledPackageRecordBodySchema = lazySchema(() =>
  (AssembledPackageBodySchema as unknown as z.ZodObject<z.ZodRawShape>).extend({
    functions: z.unknown().optional()
      .describe('Named handler functions, as they survived the record JSON projection'),
    hooks: z.unknown().optional()
      .describe('Object lifecycle hooks, as they survived the record JSON projection'),
  }).describe('One package as assembled, as the registry RECORDS it (JSON only)'));

export const AssembledInstalledPackageSchema = lazySchema(() => InstalledPackageSchema.extend({
  manifest: AssembledPackageRecordBodySchema.describe('The ASSEMBLED package body this row carries'),
}).describe('Installed package row whose manifest is the assembled package body'));
export type AssembledInstalledPackage = z.input<typeof AssembledInstalledPackageSchema>;
/** Post-parse shape of {@link AssembledInstalledPackage} — defaults applied, transforms run (ADR-0122). */
export type AssembledInstalledPackageParsed = z.infer<typeof AssembledInstalledPackageSchema>;

/**
 * One installed-package row at WHICHEVER manifest stage it was installed at —
 * the element the read doors (`GET /packages`, `GET /packages/:id`) serve.
 *
 * ## Why this surface names BOTH stages, where the artifact names one
 *
 * #14242 bound the artifact's `packages[]` to the assembled stage ALONE, and
 * its stated reason is a property of that surface: «a glob in a compiled
 * artifact names files nobody will read». The installed-packages table is not
 * a compiled artifact. It is the record of what was installed, and BOTH stages
 * reach it through DECLARED doors:
 *
 * - {@link PackageInstallRequestSchema} declares `manifest: ManifestSchema` —
 *   the AUTHORING stage — and `POST /packages` hands that body straight to
 *   `SchemaRegistry.installPackage`, which stores a JSON projection of it;
 * - a `defineStack()` host reaches the same table through
 *   `ObjectQL.registerApp`, which installs the ASSEMBLED body.
 *
 * ⇒ a read contract naming only the assembled stage would refuse a row this
 * API's own install contract is declared to produce. Naming only the authoring
 * stage is the defect this declaration closes. So the row is declared as what
 * it is: one of two stages, each named by its own closed declaration.
 *
 * ## ⛔ This is a union of two whole STAGES, never a tolerant shape
 *
 * Road C's defect was a union INSIDE a key: `objects: (string | ObjectDef)[]`
 * describes no stage, and admits an array that mixes globs with definitions.
 * This union is over two complete, closed declarations, so every parse is a
 * FULL parse of one coherent stage and a body belonging to neither — a mixed
 * `objects` array among them — is refused by both branches and therefore by
 * this schema. That refusal is pinned in
 * `packages/runtime/src/domains/packages-read-delete-response-conformance.test.ts`,
 * beside the two doors, so «it accepts both» can never quietly become «it
 * accepts anything».
 *
 * ⛔ Never relax either branch to make a payload fit. A row that parses through
 * neither stage is a producer defect, and this is the declaration that has to
 * keep saying so.
 */
export const InstalledPackageAtEitherStageSchema = lazySchema(() => z.union([
  InstalledPackageSchema,
  AssembledInstalledPackageSchema,
]).describe('Installed package row at whichever manifest stage it was installed at'));
export type InstalledPackageAtEitherStage = z.input<typeof InstalledPackageAtEitherStageSchema>;
/** Post-parse shape of {@link InstalledPackageAtEitherStage} — defaults applied, transforms run (ADR-0122). */
export type InstalledPackageAtEitherStageParsed = z.infer<typeof InstalledPackageAtEitherStageSchema>;

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
    packages: z.array(InstalledPackageAtEitherStageSchema).describe('Installed packages'),
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
  data: InstalledPackageAtEitherStageSchema.describe('Installed package details'),
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
