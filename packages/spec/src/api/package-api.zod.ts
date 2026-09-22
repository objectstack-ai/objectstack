// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { InstalledPackageSchema } from '../kernel/package-registry.zod';
import { DependencyResolutionResultSchema } from '../kernel/dependency-resolution.zod';
import { UpgradePlanSchema } from '../kernel/package-upgrade.zod';
import { PackageArtifactSchema } from '../kernel/package-artifact.zod';
import { ManifestSchema } from '../kernel/manifest.zod';
import { ArtifactReferenceSchema } from '../marketplace/marketplace.zod';
import { retiredKey } from '../shared/retired-key';
import { RecordStagePackageBodySchema } from '../stack.zod';

/**
 * # Package API Protocol
 *
 * REST API endpoint schemas for package lifecycle management.
 *
 * Base path: /api/v1/packages
 *
 * @example Endpoints
 * ```
 * POST   /api/v1/packages                      — Install a package
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
 * declaration, so a wrong-shaped body is refused exactly as it is there.
 *
 * ## The row's manifest is the RECORD stage, not the assembled one
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
 * at all: `z.toJSONSchema` refuses a function and a custom type, and embedding
 * the body verbatim in the two published response schemas below made BOTH of
 * them disappear from `json-schema/api/`, which the build's own disappearance
 * ratchet refuses. `build-schemas.ts` names the remedy taken here:
 * «make it emit — narrow the unrepresentable member».
 *
 * ⚠️ ⛔ Those two members are NOT why `ArtifactPackageSchema` and
 * `ObjectStackDefinitionSchema` publish no JSON Schema — an earlier version of
 * this docblock said they were, and it is false. `src/stack.zod.ts` is not one
 * of the subpath namespaces `build-schemas.ts` walks, so neither schema is ever
 * reached by the emit loop; repairing the two branches would not make either
 * appear. What the narrowing below buys is this file's own two responses, which
 * ARE in the emit loop.
 *
 * ⭐ The narrowing is a DECLARATION rather than a hole. Until #17518 these two
 * keys were `z.unknown().optional()` here — accepted without being checked —
 * and that hole is what `RecordStagePackageBodySchema` replaces: the registry
 * record stage, declared in `../stack.zod` beside the assembled and artifact
 * stages, is the assembled body with both collections lowered and
 * `functions[].handler` optional. ⛔ Never widen either key back to `unknown`
 * to make a row fit: a row that parses through neither declared stage is a
 * producer defect, and the record stage exists to keep saying so. The set of
 * members that need the treatment is MEASURED, never hand-picked — pinned
 * key-by-key in `./package-api.test.ts`, so a new collection with no JSON form
 * reddens there, naming itself.
 */
export const AssembledInstalledPackageSchema = lazySchema(() => InstalledPackageSchema.extend({
  manifest: RecordStagePackageBodySchema.describe('The ASSEMBLED package body this row carries, at the stage the registry records it'),
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
 * One prescription, two keys — `limit` and `cursor` were the two halves of a
 * pagination capability `GET /api/v1/packages` has never had, so they retire
 * together and raise the same string.
 *
 * Tombstoned rather than deleted for the ADR-0104 reason these request schemas
 * keep paying for: this object is not `.strict()`, so a bare deletion makes Zod
 * SILENTLY STRIP whatever a generated client keeps sending — a clean parse and
 * a parameter that never takes effect, which is this card's own defect moved
 * one layer down. `retiredKey()` types the key as `never` (so `tsc` refuses it
 * at the authoring site) and raises this text at parse time.
 */
const PACKAGES_LIST_PAGINATION_REMOVED =
  '`limit` / `cursor` were removed from GET /api/v1/packages in @objectstack/spec 17.5.0 '
  + '(ADR-0049 enforce-or-remove) — both were declared here and read by nothing: the '
  + 'serving door filters on `status` / `type` / `enabled` and then returns every remaining row, so '
  + 'no page was ever withheld and no continuation token was ever minted. `limit` also '
  + 'declared `.default(50)`, so a reader of the published schema was entitled to believe '
  + 'an unparameterised list is capped at 50 rows; it has never been capped at all, and '
  + 'nothing parses a query string through this schema, so that default has never been '
  + 'stamped onto anything. Delete the key. This route is NOT paginated — it answers the '
  + 'whole installed set, which is a bounded table of tens of rows, and `hasMore` on the '
  + 'response is a constant `false` that is now true by construction. Filter with '
  + '`status`, `type` and `enabled` instead of asking for a window. A first-class package cursor, if '
  + 'one is ever designed, will be a response-minted opaque token, not this key.';

/**
 * Query parameters for listing installed packages.
 *
 * ⭐ The contract this declaration is being held to: every key here is one the
 * serving door — `handlePackagesRequest`'s `parts.length === 0 && m === 'GET'`
 * branch in `packages/runtime/src/domains/packages.ts` — actually reads, and
 * every key that door reads is here. #17667 moved it in BOTH directions
 * (maintainer ruling 2026-09-13, decision batch #126 item 1, route 2): `type`
 * was executed and undeclared, `limit` / `cursor` were declared and never
 * executed.
 *
 * ⭐ The `enabled` leg is closed too, so the symmetry above holds for every
 * key without exception: item 2 of the same ruling made that door read
 * `enabled` (`readEnabledFilter`, the filter line beside the `status` one).
 * ⛔ Do not "close" it the other way by deleting `enabled` — the ruling
 * chose to implement that key, not to retire it, and the door reads it.
 *
 * ⛔ Never add a key here that the door does not read. A declared-and-ignored
 * query parameter fails undetectably: the caller is answered `200` with the
 * unfiltered set and nothing in the status, headers or body distinguishes that
 * from a request served as asked.
 */
export const ListInstalledPackagesRequestSchema = lazySchema(() => z.object({
  /** Filter by package status */
  status: z.enum(['installed', 'disabled', 'installing', 'upgrading', 'uninstalling', 'error']).optional()
    .describe('Filter by package status'),
  /** Filter by enabled state */
  enabled: z.boolean().optional()
    .describe('Filter by enabled state'),
  /**
   * Filter by the installed manifest's `type`.
   *
   * ⭐ DECLARED BECAUSE THE DOOR ALREADY EXECUTES IT, not the other way round:
   * the list branch filters `manifest.type === query.type` on any non-empty
   * value it is given. Declared as an open string rather than a closed
   * vocabulary because that is what the door compares — `ManifestSchema.type`
   * is not a shared enum, and a narrower declaration here would state a
   * rejection this wire does not perform. An unmatched value is not an error;
   * it selects nothing.
   */
  type: z.string().optional()
    .describe('Filter by the installed manifest\'s `type` — exact match, unmatched values select nothing'),
  limit: retiredKey(PACKAGES_LIST_PAGINATION_REMOVED),
  cursor: retiredKey(PACKAGES_LIST_PAGINATION_REMOVED),
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
    // The door sends a constant `false` here, and since #17667 removed the
    // request half that is TRUE BY CONSTRUCTION rather than merely convenient:
    // with no `limit` and no `cursor` to ask with, nothing can request a page,
    // so there is never a next one to announce and `nextCursor` stays absent.
    // ⛔ Do not "fix" the constant back into a computed value without first
    // restoring a request-side way to ask for a page — a `true` nobody can act
    // on is the same defect this card closed, pointing the other way.
    hasMore: z.boolean().describe('Whether more packages are available — this door serves one page, so always `false`'),
  }),
}).describe('List installed packages response'));
export type ListInstalledPackagesResponse = z.input<typeof ListInstalledPackagesResponseSchema>;
/** Post-parse shape of {@link ListInstalledPackagesResponse} — defaults applied, transforms run (ADR-0122). */
export type ListInstalledPackagesResponseParsed = z.infer<typeof ListInstalledPackagesResponseSchema>;

// ==========================================
// 3. Get Package (GET /api/v1/packages/:packageId)
// ==========================================

/**
 * Request for getting a single installed package — path parameter plus the one
 * query parameter this door honours.
 *
 * ⭐ `version` is DECLARED BECAUSE THE DOOR ALREADY EXECUTES IT (#17416 made it
 * honoured; #17667 makes the declaration say so). Until now this was
 * `PackagePathParamsSchema` — path params only — so a `?version=` the handler
 * acts on was invisible to anything generated from the contract.
 */
export const GetInstalledPackageRequestSchema = lazySchema(() => PackagePathParamsSchema.extend({
  /**
   * Scope the read to one installed version.
   *
   * What the door does, exactly: the id is resolved FIRST, so an unknown id
   * still answers `404 Package '<id>' not found` whether or not `?version=`
   * rode along; only then is the version compared, by exact string equality
   * against the row's `manifest.version` (falling back to the
   * `installedVersion` mirror). A mismatch is a `404` naming the installed
   * version. The literal `latest` means "whatever is installed" and is
   * therefore equivalent to omitting the key — it is NOT a dist-tag lookup,
   * and there is no semver-range matching at this door. Repeating the
   * parameter is a `400`.
   */
  version: z.string().optional()
    .describe('Scope the read to this exact installed version; `latest` or omitted reads the installed row'),
}).describe('Get installed package request'));
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
// 4. Install Package (POST /api/v1/packages)
// ==========================================

/**
 * Request body for installing a package, in its WRAPPED form.
 *
 * ## The door this is bound to, and the one it used to name
 *
 * This declaration was bound to `POST /api/v1/packages/install` — a path the
 * real dispatcher answers `handled=false`, because `handlePackagesRequest`
 * has no one-segment `POST` branch and `packages/rest`'s registrar mounts only
 * `POST /api/v1/packages/publish`. The install door that actually serves is
 * `POST /api/v1/packages` (`packages/runtime/src/domains/packages.ts`), and it
 * had no declared request contract at all: the read side was strictly more
 * truthful than the write side producing the rows it describes.
 *
 * The binding now names the serving door. ⛔ Never re-point it at a path on the
 * strength of a docs line or a section heading — «machine-readable surfaces
 * must not lie» is judged against what the composed runtime mounts.
 *
 * ## The manifest STAGE this names
 *
 * `manifest` is `ManifestSchema`, the **AUTHORING** stage — `objects` is
 * `z.array(z.string())`, GLOB PATTERNS naming files a file-based loader should
 * read. That is the only stage this HTTP door is reached at: the ASSEMBLED
 * stage reaches the same table through `ObjectQL.registerApp`, never over this
 * wire. The read doors serve rows from BOTH and say so by name
 * ({@link InstalledPackageAtEitherStageSchema}); the write door serves one and
 * says so here. ⛔ Naming one stage on a surface reached at two, or two on a
 * surface reached at one, is the same defect in opposite directions.
 *
 * @example POST /api/v1/packages
 * { manifest: {...}, platformVersion: '3.2.0', enableOnInstall: true, overwrite: true }
 */
export const PackageInstallRequestSchema = lazySchema(() => z.object({
  /** Package manifest to install — the AUTHORING stage */
  manifest: ManifestSchema.describe('Package manifest to install (AUTHORING stage: `objects` are glob patterns)'),

  /** User-provided settings at install time */
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('User-provided settings at install time'),

  /**
   * Whether to enable the package immediately after install.
   *
   * ## ⭐ THE ONE AUTHORITY for this key, and the map to the other two
   *
   * `enableOnInstall` is declared in three published schemas. This one is the
   * authority, because it is the request contract of the door that HONOURS it:
   * `POST /api/v1/packages` writes the registry row's `enabled` from
   * `enableOnInstall ?? true`, through the same registry flip and durable
   * state write `PATCH /packages/:id/disable` uses
   * (`packages/runtime/src/domains/packages.ts`). A `false` here installs the
   * package present-but-not-active and survives a restart; `true` and absent
   * install it enabled, which is this declaration's default.
   *
   * The other two are re-read here so a reader never has to guess which of
   * three identical-looking declarations governs:
   *
   * - `InstallPackageRequestSchema` (`src/kernel/package-registry.zod.ts`) —
   *   **a COPY of this key**, restated on the in-process protocol primitive
   *   `ObjectStackProtocol.installPackage`. Same type, same default, same
   *   meaning; its own implementation does not read it, and this door does not
   *   forward it down that seam. Held to this declaration by
   *   `package-install-one-authority.test.ts`, not by an import: the authority
   *   sits above `kernel/` in the module graph, so a `…Schema.shape.…`
   *   reference from there is a cycle that dies under `OS_EAGER_SCHEMAS=1`.
   * - `MarketplaceInstallRequestSchema` (`src/marketplace/marketplace.zod.ts`)
   *   — **not this key at all**. That request's subject is a marketplace
   *   listing, its door is the control plane's `POST /api/v1/marketplace/install`,
   *   and its `enableOnInstall` is what a caller asks the marketplace channel
   *   to request on its behalf, one translation upstream of this one. It stays
   *   a declaration of its own and says why at its own site.
   *
   * ⛔ Never unify the three silently, in either direction: two of them are
   * one commitment and the third is a different party's.
   */
  enableOnInstall: z.boolean().default(true)
    .describe('Whether to enable immediately after install — honoured at POST /api/v1/packages: the installed row\'s `enabled` is written from this key'),

  /**
   * Opt back in to overwriting an already-installed package id.
   *
   * ⭐ DECLARED BECAUSE THE DOOR ALREADY HONOURS IT, not the other way round.
   * `POST /api/v1/packages` CREATES a package: an id that is already installed
   * answers `409 Conflict` rather than silently destroying the existing
   * manifest. `overwrite: true` (body) or `?overwrite=true` (query) is how an
   * intentional upgrade / re-install opts back in — read at
   * `packages/runtime/src/domains/packages.ts`, sent by the first-party SDK
   * (`client.packages.install(m, { overwrite: true })`) and pinned on both
   * sides in `packages/client/src/client.test.ts`.
   *
   * It was a live body key declared by no schema anywhere, so any parse at this
   * door would have STRIPPED it — turning a deliberate re-install into a 409.
   * ⛔ Never remove this declaration while the handler still reads the key.
   */
  overwrite: z.boolean().optional()
    .describe('Overwrite an already-installed package id instead of answering 409 Conflict'),

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
 * The install door's body at WHICHEVER of its two declared forms it arrives in
 * — the wrapped request above, or a BARE manifest as the whole body.
 *
 * ## Why the bare form is declared rather than dropped
 *
 * The door reads `const manifest = body.manifest || body`, so a bare manifest
 * IS a body form it accepts, and first-party callers send it that way — the
 * runtime's own door drives (`package-door-namespace-conflict-code.test.ts`,
 * `domain-handler-registry.test.ts`) post a manifest with no wrapper at all. A
 * contract naming only the wrapped form would refuse bodies this door answers
 * `201` to, which is the defect this declaration exists to stop repeating.
 *
 * ⚠️ What those two drives post is NOT covered by this branch, and saying so
 * is the point. Measured: `{ id, name: id, namespace, version: '1.0.0' }` and
 * `{ id: 'pkg-a', name: 'A' }` are both refused here (`invalid_union`) because
 * neither carries `type`, and the second carries no `version` either. They are
 * bare in FORM and incomplete in CONTENT — the form is declared, the content
 * is part of the residual below, and they are pinned as REFUSED in
 * `package-api.test.ts` rather than dressed up as green fixtures.
 *
 * ## The two branches are disjoint — but only ONE of them is closed
 *
 * Every parse is a FULL parse of ONE coherent form, the discipline
 * {@link InstalledPackageAtEitherStageSchema} records on the read side. The
 * two are disjoint by construction — `ManifestSchema` is a `strictObject`
 * with no `manifest` key, so a wrapped body can never fall through to the bare
 * branch, and a bare manifest has no `manifest` key, so it can never satisfy
 * the wrapped branch.
 *
 * ⛔ Closedness, however, is NOT symmetric, and an earlier revision of this
 * docblock claimed it was. {@link PackageInstallRequestSchema} is a plain
 * `z.object`, i.e. STRIP mode: `{ manifest, bogus: 1 }` parses green and comes
 * out with `bogus` GONE. Only the bare branch is closed, because
 * `ManifestSchema` is a `strictObject` and refuses an unknown key by name.
 *
 * That asymmetry is the door's own behaviour, not a gap: the handler reads
 * `body.manifest`, `body.settings`, `body.enableOnInstall` and `body.overwrite`
 * and ignores every other key, so dropping them is what it does with them.
 * ⛔ Do NOT close the wrapped branch with `.strict()` — that would refuse
 * bodies this door answers `201` to, which is the one direction this binding
 * may never move (ruling A). The pin lives in `package-api.test.ts`.
 *
 * ## What this declaration does NOT describe — the measured residual
 *
 * This is a SUBSET description of the live door, deliberately. Measured
 * through `HttpDispatcher.handlePackages`, the door additionally answers `201`
 * to five classes this schema refuses:
 *
 * 1. a manifest missing `type` and/or `version` (both door drives above);
 * 2. unknown keys on either form — refused by name on the bare branch,
 *    silently dropped on the wrapped one, `201` either way;
 * 3. a string-typed `enableOnInstall` / `overwrite` — the door compares
 *    against `true`/`false` and `'true'`, so `'false'` installs ENABLED and a
 *    body-side `'true'` overwrite is treated as ABSENT;
 * 4. install options spelled on the BARE form — ignored, never honoured;
 * 5. and it answers `400` in the OPPOSITE direction, to a whitespace-only `id`
 *    this declaration admits (the door trims before keying).
 *
 * ⛔ None of these is a licence to relax `ManifestSchema` or either branch —
 * the residual is RECORDED here so a reader is not told the declaration is the
 * door, and closing it is its own decision with its own card.
 *
 * ⚠️ The bare form carries NO install options: `settings`, `enableOnInstall`
 * and `overwrite` are not manifest keys and `ManifestSchema`'s strict close
 * refuses them by name. A bare-form caller reaches `overwrite` through the
 * query string (`?overwrite=true`) alone. ⛔ Do not "fix" that by relaxing
 * either branch — a caller that needs an option sends the wrapped form.
 */
export const PackageInstallBodySchema = lazySchema(() => z.union([
  PackageInstallRequestSchema,
  ManifestSchema,
]).describe('Install package request body, wrapped or as a bare manifest'));
export type PackageInstallBody = z.input<typeof PackageInstallBodySchema>;
/** Post-parse shape of {@link PackageInstallBody} — defaults applied, transforms run (ADR-0122). */
export type PackageInstallBodyParsed = z.infer<typeof PackageInstallBodySchema>;

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
 * Request for uninstalling a package — path parameter plus the one query
 * parameter this door honours.
 *
 * ⭐ `keepData` is DECLARED BECAUSE THE DOOR ALREADY EXECUTES IT (#17667).
 * Until now this was `PackagePathParamsSchema` — path params only — so the one
 * option that decides whether a tenant's object tables survive an uninstall
 * was declared by no request schema anywhere in the spec.
 */
export const UninstallPackageApiRequestSchema = lazySchema(() => PackagePathParamsSchema.extend({
  /**
   * Remove the package's metadata but PRESERVE its object tables.
   *
   * Omitted or false is the destructive default: storage is torn down with the
   * metadata. The door reads this off the query string and passes
   * `keepData: true` through to `deletePackage`.
   *
   * ⚠️ On the wire the door recognises exactly two spellings — `?keepData=true`
   * and `?keepData=1`. Any other value, `?keepData=yes` included, is read as
   * absent and the tables are DROPPED. Declared as a boolean because that is
   * the option's meaning and the shape the protocol layer receives; the two
   * accepted encodings are stated here rather than widened, because widening
   * the door's own comparison is a runtime change this declaration is not.
   */
  keepData: z.boolean().optional()
    .describe('Preserve object tables and remove metadata only; on the wire, `?keepData=true` or `?keepData=1`'),
}).describe('Uninstall package request'));
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
  // `installPackage` REBOUND (#18058) — it named `/api/v1/packages/install`,
  // a path the composed runtime mounts nowhere (the dispatcher answers
  // `handled=false`; `packages/rest` mounts only `/packages/publish`). The
  // serving install door is the bare `POST /api/v1/packages`, and its body is
  // declared at BOTH the forms it accepts — see `PackageInstallBodySchema`.
  installPackage: {
    method: 'POST' as const,
    path: '/api/v1/packages',
    input: PackageInstallBodySchema,
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
