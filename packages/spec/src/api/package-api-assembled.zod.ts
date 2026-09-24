// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { InstalledPackageSchema } from '../kernel/package-registry.zod';
import { lazySchema } from '../shared/lazy-schema';
import { RecordStagePackageBodySchema } from '../stack.zod';
import {
  GetInstalledPackageRequestSchema,
  ListInstalledPackagesRequestSchema,
  PackageInstallBodySchema,
  PackageInstallResponseSchema,
  UninstallPackageApiRequestSchema,
  UninstallPackageApiResponseSchema,
} from './package-api.zod';

/**
 * The Package API declarations that carry the ASSEMBLED package body.
 *
 * Published from `@objectstack/spec/api-assembled`, never from
 * `@objectstack/spec/api`. Everything here is part of the Package API
 * (`/api/v1/packages`, `./package-api.zod.ts`); what sets these five apart is
 * that each one embeds the assembled package body, `RecordStagePackageBodySchema`
 * from `../stack.zod` — or, for the route map, names a schema that does:
 *
 * - `AssembledInstalledPackageSchema` — the installed row at the assembled stage;
 * - `InstalledPackageAtEitherStageSchema` — the union the read doors serve;
 * - `ListInstalledPackagesResponseSchema` / `GetInstalledPackageResponseSchema`
 *   — the two read responses, bound to that union;
 * - `PackageApiContracts` — the route map, which names both read responses.
 *
 * ## Why they have their own entry
 *
 * The assembled body is the WHOLE metadata vocabulary: `../stack.zod` reaches
 * every collection schema, the datasource declaration and, behind it, the
 * driver-config validators and the server-only pg URL grammar. Declared inside
 * `@objectstack/spec/api` (#17517), that tree became part of every bundle of the
 * entry — and a browser module that imported two string constants from
 * `./sortability.zod` paid for all of it, roughly doubling its gzipped bundle,
 * because the entry ships as one self-contained bundle and little of that tree
 * can be dropped by a consumer's tree-shaking. The maintainer ruling on #18576
 * (letter B) removed the cost rather than watching it: the browser-facing
 * `./api` no longer carries these declarations, and this entry does.
 *
 * ⛔ Their MEANING did not change with the move — same schemas, same refusals,
 * same JSON Schema ids (`api/...`, still published under `json-schema/api/`,
 * because they are API-protocol declarations; only the import path moved).
 *
 * ⛔ Only a declaration that genuinely needs the assembled body belongs here.
 * Everything else in the Package API stays in `./package-api.zod.ts`, which
 * `@objectstack/spec/api` publishes; `./api-entry-graph.pin.test.ts` pins that
 * `./api` reaches neither `../stack.zod` nor the datasource declaration.
 */

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
  // `upgradePackage`, `resolveDependencies` and `uploadArtifact` REMOVED
  // (#19116, ADR-0087 semantic entry
  // `package-api-contracts-unmounted-entries-retired`) — they bound
  // `POST /api/v1/packages/upgrade`, `/resolve-dependencies` and `/upload`,
  // three paths the composed runtime mounts nowhere (the dispatcher answers
  // `handled=false`; `packages/rest` mounts only `/packages/publish`), and no
  // serving door existed to rebind them onto as `installPackage` was. Their
  // request/response schemas (sections 5–7) stay published, bound to no route.
  // ⛔ A package upgrade / dependency-resolution / upload route is declared
  // here only in the same change that MOUNTS it — never ahead of its door.
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
