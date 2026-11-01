// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ## Package lifecycle response contracts (#12038)
 *
 * Response payloads for the dispatcher-served `packages.*` lifecycle routes —
 * the ADR-0067 commit timeline, the ADR-0033 draft batch doors, the ADR-0070
 * export / adopt / duplicate family — ruled on 2026-08-27 (#12038,
 * 1C · 2C · 3A · 4A · 5A).
 *
 * Every schema here is a DESCRIBE-ONLY TRANSCRIPTION of the return type its
 * producer already declares inline (`@objectstack/metadata-protocol`
 * `protocol.ts`, except where a schema's own docblock says otherwise) —
 * authoring one changes no wire byte. All of these routes are served by the
 * runtime dispatcher ONLY (no REST twin — #12038 survey §1b), which answers
 * through the `{ success, data }` envelope (`http-dispatcher.ts`), so each
 * schema declares the `data` payload, envelope-free — the same convention as
 * `PublishPackageDraftsResponseSchema` and its ledger row.
 *
 * Two pairs are the exception, each with a request half its producer PARSES
 * rather than a transcription: `ImportUnmanagedPackageRequestSchema` /
 * `ImportUnmanagedPackageResponseSchema` (ADR-0131 D6) declare a protocol verb
 * no route serves yet, and `EnsureCustomizationPackageRequestSchema` /
 * `EnsureCustomizationPackageResponseSchema` (ADR-0146 D3) declare the ensure
 * door of a base's paired `.custom` package — see their own docblocks.
 *
 * `packages.publish`'s contract is NOT here: its producer
 * (`MetadataManager.publishPackage`) already has an exact published schema,
 * `PackagePublishResultSchema` in `@objectstack/spec/system` — re-exported
 * below into this `/api` namespace (ruling 5A: re-export, never a second
 * copy) because the route-ledger resolver looks names up only in the API
 * protocol's entries — `@objectstack/spec/api`, and `/api-assembled` for the
 * declarations that embed the assembled package body (#18576).
 *
 * The retired `PackageRollbackResponseSchema` and its
 * `PackageApiContracts.rollbackPackage` binding (see `./package-api-assembled.zod.ts`)
 * declared a VERSION rollback against the live COMMIT-rollback path;
 * `RollbackToPackageCommitResponseSchema` below is the true contract,
 * authored after that retirement per the ruling's sequencing (3A).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { MetadataLockSchema } from '../kernel/metadata-protection.zod';

// Ruling 5A — the `/api` re-export of the one existing declaration. The
// schema (and its type) stay declared in `system/metadata-persistence.zod.ts`
// beside the persistence vocabulary they belong to; this line only makes the
// name resolvable where the ledger resolver searches.
export { PackagePublishResultSchema, type PackagePublishResult } from '../system/metadata-persistence.zod';

/**
 * `POST /packages/:id/discard-drafts` — drop every pending draft bound to
 * the package (ADR-0033).
 *
 * Transcribed from `discardPackageDrafts`'s declared return.
 */
export const DiscardPackageDraftsResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('True exactly when nothing failed.'),
  discardedCount: z.number().describe('How many drafts were discarded.'),
  failedCount: z.number().describe('How many drafts could not be discarded.'),
  discarded: z.array(z.object({
    type: z.string().describe('Metadata type of the discarded draft.'),
    name: z.string().describe('Name of the discarded draft.'),
  })).describe('Every draft that was discarded.'),
  failed: z.array(z.object({
    type: z.string().describe('Metadata type of the failing draft.'),
    name: z.string().describe('Name of the failing draft.'),
    error: z.string().describe('Why the discard failed.'),
    code: z.string().optional().describe('Machine-readable failure code, when one was recorded.'),
  })).describe('Every draft the discard could not remove.'),
}));

/**
 * `GET /packages/:id/commits` — the package's ADR-0067 commit timeline,
 * newest first.
 *
 * The element shape is transcribed from `listCommits`'s declared return —
 * a BARE array. The `{ commits }` wrapper is minted AT THE HANDLER
 * (`runtime/src/domains/packages.ts`, `success({ commits })`) and nowhere
 * else; this schema declares the handler's payload, wrapper included, and
 * that wrapper is declared as the handler's own, not the protocol's
 * (#12038 survey §1b rider).
 *
 * [#23073] An item's `member` tells two members of one bundle apart: for a
 * type whose identity is a pair (`email_template`, `(name, locale)`), two
 * languages of one template are two items with one `type` and `name`. It is
 * the member the stored revert plan records, the one a revert of the commit
 * acts on.
 */
export const ListPackageCommitsResponseSchema = lazySchema(() => z.object({
  commits: z.array(z.object({
    id: z.string().describe('Commit id.'),
    operation: z.enum(['apply', 'revert']).describe(
      'Whether the commit applied changes or reverted an earlier commit.',
    ),
    message: z.string().optional().describe('Commit message, when one was recorded.'),
    actor: z.string().optional().describe('Who made the commit, when recorded.'),
    aiModel: z.string().optional().describe('AI model that authored the change, when recorded.'),
    parentCommitId: z.string().optional().describe('The commit this one chains from, when recorded.'),
    itemCount: z.number().describe('How many items the commit touched.'),
    items: z.array(z.object({
      type: z.string().describe('Metadata type of the touched item.'),
      name: z.string().describe('Name of the touched item.'),
      member: z.string().optional().describe(
        'The bundle member the touched item is, for a metadata type whose identity is a pair (today only '
        + '`email_template`, identified by `(name, locale)`): its discriminator value (`zh-CN`), and the '
        + 'canonical member spelled out (`en-US`). Present on every item of such a type, so two members of '
        + 'one name are two items; absent for a type whose identity is its name alone. It is the by-name '
        + 'doors\' `member` selector (`?member=`) for that item.',
      ),
      existedBefore: z.boolean().describe('Whether the item existed before the commit.'),
      prevVersion: z.number().nullable().describe(
        'The item\'s history version before the commit, `null` when it had none.',
      ),
    })).describe('The items the commit touched.'),
    createdAt: z.string().optional().describe('When the commit was made (ISO-8601 string), when recorded.'),
  })).describe('The commit timeline, newest first.'),
}));

/**
 * `POST /packages/:id/commits/:commitId/revert` — revert ONE commit; the
 * revert is itself a commit (ADR-0067).
 *
 * Transcribed from `revertCommit`'s declared return.
 */
export const RevertPackageCommitResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('True exactly when nothing failed.'),
  revertedCount: z.number().describe('How many items were reverted.'),
  failedCount: z.number().describe('How many items could not be reverted.'),
  reverted: z.array(z.object({
    type: z.string().describe('Metadata type of the reverted item.'),
    name: z.string().describe('Name of the reverted item.'),
    action: z.enum(['removed', 'restored']).describe(
      'What the revert did to the item — removed what the commit created, or '
      + 'restored what it overwrote.',
    ),
  })).describe('Every item the revert touched.'),
  failed: z.array(z.object({
    type: z.string().describe('Metadata type of the failing item.'),
    name: z.string().describe('Name of the failing item.'),
    error: z.string().describe('Why the revert failed for this item.'),
    code: z.string().optional().describe('Machine-readable failure code, when one was recorded.'),
  })).describe('Every item the revert could not touch.'),
  revertCommitId: z.string().optional().describe(
    'Id of the commit the revert itself created, when one was written.',
  ),
}));

/**
 * `POST /packages/:id/rollback` — roll back through ALL commits newer than
 * `commitId` (ADR-0067) — the COMMIT rollback.
 *
 * Transcribed from `rollbackToPackageCommit`'s declared return. This is the
 * TRUE contract for the live path the retired `PackageRollbackResponseSchema`
 * falsely described as a version rollback (#12038 ruling 3A — retirement
 * first, then this schema).
 */
export const RollbackToPackageCommitResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('True exactly when nothing failed.'),
  revertedCommits: z.array(z.string()).describe(
    'Ids of the commits that were rolled back, in the order they were reverted.',
  ),
  failed: z.array(z.object({
    commitId: z.string().describe('The commit that could not be reverted.'),
    error: z.string().describe('Why reverting it failed.'),
  })).describe('Every commit the rollback could not revert.'),
}));

/**
 * `GET /packages/:id/export` — the package's portable manifest (ADR-0070
 * offline export), the same shape `marketplace-install-local` consumes.
 *
 * HONESTLY OPEN (#12038 ruling 4A). `assemblePackageManifest`
 * (`runtime/src/domains/packages.ts`) builds the key set DYNAMICALLY from the
 * metadata type registry — one plural key per type present
 * (`manifest[plural] = items.map(clean)`), partitioning `views` per #5320 —
 * plus the four fixed keys below. Only the fixed keys are pinnable;
 * enumerating the registry here would freeze this contract against future
 * metadata types, so everything else deliberately falls to the open
 * catch-all. Freezes nothing.
 */
export const PackageExportManifestSchema = lazySchema(() => z.object({
  id: z.string().describe('The exported package\'s id.'),
  name: z.string().describe('The exported package\'s machine name.'),
  version: z.string().describe('The exported package\'s version.'),
  label: z.string().optional().describe('Display label, when the package declares one.'),
}).catchall(z.unknown().describe(
  'One key per metadata type present in the package (plural spelling, e.g. '
  + '`objects`, `views`), each an array of cleaned item bodies. The key set '
  + 'is registry-derived at runtime and deliberately NOT enumerated here.',
)));

/**
 * `POST /packages/:id/adopt-orphans` — bulk-rebind package-less (orphaned)
 * metadata into this base (ADR-0070 D5); the client method is
 * `packages.adoptOrphans`.
 *
 * Transcribed from `reassignOrphanedMetadata`'s declared return.
 */
export const ReassignOrphanedMetadataResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether the reassignment ran.'),
  reassignedCount: z.number().describe('How many orphaned items were adopted.'),
  reassigned: z.array(z.object({
    type: z.string().describe('Metadata type of the adopted item.'),
    name: z.string().describe('Name of the adopted item.'),
  })).describe('Every item that was adopted.'),
  targetPackageId: z.string().describe('The package the items were adopted into.'),
}));

/**
 * `POST /packages/:id/duplicate` — clone this base into a NEW writable
 * package, re-namespacing objects and rewriting references (ADR-0070 D4).
 *
 * Transcribed from `duplicatePackage`'s declared return. ⚠️ `success` is the
 * OPERATION's verdict (`failed.length === 0 && copied.length > 0`) — on this
 * enveloped route a consumer reading the top-level envelope `success` instead
 * is told a partial or empty duplicate succeeded (the objectui#6593 defect
 * this declaration exists to end).
 */
export const DuplicatePackageResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe(
    'The duplicate\'s own verdict: true exactly when nothing failed AND at '
    + 'least one item was copied.',
  ),
  copiedCount: z.number().describe('How many items were copied.'),
  failedCount: z.number().describe('How many items could not be copied.'),
  targetPackageId: z.string().describe('The new package the base was cloned into.'),
  copied: z.array(z.object({
    type: z.string().describe('Metadata type of the copied item.'),
    name: z.string().describe('Name of the copied item.'),
  })).describe('Every item that was copied.'),
  failed: z.array(z.object({
    type: z.string().describe('Metadata type of the failing item.'),
    name: z.string().describe('Name of the failing item.'),
    error: z.string().describe('Why copying it failed.'),
  })).describe('Every item the clone could not copy.'),
}));

/**
 * The request of `importUnmanagedPackage` — the copy-once import behind the
 * `unmanaged` install mode (ADR-0131 D6): every metadata item of ONE package
 * is written into a NEW writable base in the environment ledger, editable from
 * then on, never upgraded.
 *
 * Unlike the transcriptions above, this declaration is ENFORCED: the producer
 * (`@objectstack/metadata-protocol` `protocol.ts`) parses its request through
 * it, so a key it does not declare is refused rather than ignored. No route
 * serves the verb yet; the install door that reads an `installMode` calls it.
 * The actor is stated by that door, never by a body, so it is not declared
 * here.
 */
export const ImportUnmanagedPackageRequestSchema = lazySchema(() => z.object({
  manifest: z.record(z.string(), z.unknown()).describe(
    'The package to import: ONE package\'s assembled body, flattened — its manifest fields beside its '
    + 'metadata collections (`objects`, `views`, …), the shape the install door hands the manifest '
    + 'service. An artifact carrying `packages` is refused: import each package body on its own.',
  ),
  targetPackageId: z.string().optional().describe(
    'Id of the NEW writable base the items are written into, in reverse-domain form. It must differ '
    + 'from the source id and name no installed package. Defaults to `<manifest.id>-copy`.',
  ),
  targetName: z.string().optional().describe(
    'Display name of the new base. Defaults to the source package\'s `name`.',
  ),
}).strict());

/**
 * The answer of `importUnmanagedPackage`.
 *
 * Transcribed from the producer's declared return. The import is
 * all-or-nothing: every judgeable refusal is raised before the base exists,
 * and a write that fails deletes the base, so a returned answer always means
 * every item was copied. There is no `failed[]` and no `success` verdict to
 * read — a failure is a thrown ADR-0112 error, never a partial answer.
 *
 * `strippedLocks` is the copy's one loss, stated rather than silent (ADR-0131
 * D6 and ADR-0010 §3.3 / Phase 4.3; the ruling on the D6 lock fork, record
 * 6119681934): a copy is the environment's own metadata, so the package's
 * protection lock is not copied, in either spelling — the `_lock` envelope or
 * a `protection` block — and each lock dropped is listed as a managed install
 * would have bound it, with the reason the package gave, so an administrator
 * reads why the vendor locked the item before editing it.
 */
export const ImportUnmanagedPackageResponseSchema = lazySchema(() => z.object({
  sourcePackageId: z.string().describe('The id of the package the items were copied from.'),
  sourceVersion: z.string().optional().describe(
    'The version the imported body declared, when it declared one.',
  ),
  targetPackageId: z.string().describe(
    'The new writable base that owns every copied item. Nothing is registered under the source id.',
  ),
  namespace: z.string().describe(
    'The base\'s namespace — the SOURCE package\'s, kept so every copied object name stays valid.',
  ),
  copiedCount: z.number().describe('How many items were copied.'),
  copied: z.array(z.object({
    type: z.string().describe('Metadata type of the copied item.'),
    name: z.string().describe('Name of the copied item.'),
  })).describe('Every item that was copied, in the order it was written.'),
  strippedLocks: z.array(z.object({
    type: z.string().describe('Metadata type of the copied item.'),
    name: z.string().describe('Name of the copied item.'),
    lock: MetadataLockSchema.exclude(['none']).describe(
      'The lock the package shipped on the item — its `protection` block\'s `lock`, else its `_lock`. The copy carries no lock.',
    ),
    reason: z.string().optional().describe(
      'The reason the package gave for that lock, verbatim. Absent when it gave none.',
    ),
  })).describe(
    'Every protection lock the package shipped on a copied item and the copy does not keep, in the order the '
    + 'items were written. Empty when the package locked nothing.',
  ),
}));

/**
 * `GET /packages/:id/customizations` — the request (ADR-0146 D8 item 4).
 *
 * The path's package id and nothing else: the door's query set is CLOSED, so
 * a query parameter is refused `400 VALIDATION_ERROR` naming it rather than
 * ignored (a `?includeDrafts=true` the door never reads must not answer as if
 * it had). Unlike its lifecycle siblings this is not a transcription: the
 * route is new, and this declaration is its contract (Clause-②, widening).
 */
export const GetPackageCustomizationsRequestSchema = lazySchema(() => z.object({
  packageId: z.string().min(1).describe(
    'The installed BASE package whose customizations are read (e.g. "com.acme.crm"). A paired '
    + '`<base>.custom` id is refused `400 VALIDATION_ERROR` with a message naming its base; an id no '
    + 'installed package carries answers `404`.',
  ),
}).strict().describe('Per-package customization read request: the base package id, no query parameters.'));

/**
 * `GET /packages/:id/customizations` — the answer (ADR-0146 D8 item 4, D3).
 *
 * "What did we change on HotCRM", in one read, for an installed base X: the
 * items X's paired `<X>.custom` package overrides, the members it adds to
 * X's objects, and X's items switched off in this deployment. Served rows and
 * ledger rows only: nothing is computed from them but the counts. ⛔ No diff
 * against the base and no `basedOn` verdict (ADR-0146 D2, D6).
 *
 * Enveloped like its lifecycle siblings: the dispatcher answers
 * `{ success, data }`, and this schema declares the `data`. Strict at every
 * level: a member the door starts serving is a change to this declaration
 * first.
 *
 * X with no `.custom` package answers empty lists and zero counts (the read
 * never creates the pair); the switched-off list does not depend on the pair.
 */
export const GetPackageCustomizationsResponseSchema = lazySchema(() => z.object({
  packageId: z.string().describe('The base package the customizations are of (the request\'s id).'),
  overrides: z.array(z.object({
    type: z.string().describe('Metadata type of the overriding item, canonical singular (e.g. `view`).'),
    name: z.string().describe('Name of the item: the base\'s name it is served under.'),
    member: z.string().optional().describe(
      'The bundle member, for a metadata type whose identity is a pair (`email_template`, identified by '
      + '`(name, locale)`): its discriminator value. Absent for a type whose identity is its name alone.',
    ),
    basedOn: z.string().optional().describe(
      'The base package version the declaration records (`overrides.basedOn`), copied as stored and never '
      + 'judged. Absent when the stored body records none.',
    ),
    version: z.number().int().nonnegative().optional().describe(
      'The overriding item\'s stored history version, when the row carries one.',
    ),
  }).strict()).describe(
    'Every ACTIVE item of the base\'s paired `<base>.custom` package that declares `overrides.package` = '
    + 'the base and that the effective read serves over the base\'s item of the same name: the rows the '
    + 'served-override predicate admits (a declaration from any other package, and an undeclared pair item, '
    + 'are not listed), minus the stored rows every read declines (a shipped flow name). Ordered by type, '
    + 'name and member.',
  ),
  extensions: z.array(z.object({
    object: z.string().describe('The base-owned object the member is added to.'),
    kind: z.enum(['field', 'validation', 'index']).describe('Which collection of the object the member joins.'),
    name: z.string().optional().describe(
      'The member\'s declared name: the field name, the validation rule name, the index name. Absent only for '
      + 'an index declared without a name.',
    ),
    fields: z.array(z.string()).optional().describe('For an index: the fields it covers. Absent for a field or a validation.'),
  }).strict()).describe(
    'Every field, validation rule and index the paired `<base>.custom` package declares in an object '
    + 'extension (`objectExtensions`) of an object the base owns, one entry per member, as the extension '
    + 'declares it. Ordered by object, kind and name.',
  ),
  switchedOff: z.array(z.object({
    type: z.string().describe('The ledger row\'s metadata type (`flow`, `action`, `position`, …).'),
    name: z.string().describe('The switched-off item\'s name.'),
  }).strict()).describe(
    'Every activation-ledger row (`sys_metadata_activation`) that records the base as its package and '
    + '`active: false`: the base\'s items this deployment switched off. Ordered by type and name.',
  ),
  counts: z.object({
    overrides: z.number().int().nonnegative().describe('`overrides.length`.'),
    extensions: z.number().int().nonnegative().describe('`extensions.length`: members, not objects.'),
    switchedOff: z.number().int().nonnegative().describe('`switchedOff.length`.'),
  }).strict().describe('Each list\'s length, derived from the lists in this same answer.'),
}).strict().describe('Per-package customization read: overrides, extensions and switched-off items of one installed base.'));

/**
 * The request of `ensureCustomizationPackage` — the ONE creation path of a
 * base's paired customization package `<base>.custom` (ADR-0146 D3: "no second
 * door builds the pair"). Given an installed base, the door answers the pair,
 * creating it when it is absent.
 *
 * ENFORCED, like `ImportUnmanagedPackageRequestSchema`: the producer
 * (`@objectstack/metadata-protocol`) parses its request through it, so a key it
 * does not declare is refused rather than ignored. `POST
 * /api/v1/packages/:id/ensure-customization` builds it from the path — the
 * route reads no body — and the actor is never stated here: creating the pair
 * records none, as every package install does.
 *
 * Everything the pair is made of is DERIVED, never requested: its id, its
 * namespace and its dependency range are the base's, through the pairing rules
 * of `@objectstack/spec/kernel` (`customizationPackageId`,
 * `customizationNamespace`, `customizationDependencyRange`). A request that
 * could name them would be a second spelling of the pair.
 */
export const EnsureCustomizationPackageRequestSchema = lazySchema(() => z.object({
  basePackageId: z.string().describe(
    'Id of the installed base whose paired customization package is ensured (`com.acme.crm` → '
    + '`com.acme.crm.custom`). The base must be installed and read-only — a writable base is customized '
    + 'directly — and must not itself be a customization package.',
  ),
}).strict());

/**
 * The answer of `ensureCustomizationPackage`, and the `data` of `POST
 * /api/v1/packages/:id/ensure-customization` (`201` when it created the pair,
 * `200` when the pair was already there).
 *
 * Transcribed from the producer's declared return. Every refusal is a thrown
 * ADR-0112 error raised before anything is written, so a returned answer
 * always names a pair that exists. An existing pair is returned UNCHANGED —
 * never rewritten, never adopted: one that does not declare the namespace and
 * the dependency below is refused, naming what it lacks.
 */
export const EnsureCustomizationPackageResponseSchema = lazySchema(() => z.object({
  basePackageId: z.string().describe('The base the pair customizes.'),
  packageId: z.string().describe('The paired customization package: `<basePackageId>.custom`.'),
  namespace: z.string().describe(
    'The pair\'s namespace: the base\'s namespace followed by `_custom` (`crm` → `crm_custom`), set '
    + 'explicitly and never derived from the pair\'s id. A new object authored into the pair is named '
    + '`<namespace>_<short>`.',
  ),
  dependencyRange: z.string().describe(
    'The range the pair declares on its base in `manifest.dependencies`. A created pair declares `^<major>` '
    + 'of the base\'s version at creation; an existing pair answers the range it declares, unchanged.',
  ),
  created: z.boolean().describe(
    'True when this call created the pair; false when the pair was already installed and was returned '
    + 'unchanged.',
  ),
  writable: z.boolean().describe(
    'Whether the pair is a writable package — the verdict the package read doors serve as `writable`. A '
    + 'created pair is writable; an existing pair delivered by code or an installed artifact is not, and its '
    + 'items are authored where it is built.',
  ),
}));

export type DiscardPackageDraftsResponse = z.input<typeof DiscardPackageDraftsResponseSchema>;
/** Post-parse shape of {@link DiscardPackageDraftsResponse} — defaults applied, transforms run (ADR-0122). */
export type DiscardPackageDraftsResponseParsed = z.infer<typeof DiscardPackageDraftsResponseSchema>;
export type ListPackageCommitsResponse = z.input<typeof ListPackageCommitsResponseSchema>;
/** Post-parse shape of {@link ListPackageCommitsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListPackageCommitsResponseParsed = z.infer<typeof ListPackageCommitsResponseSchema>;
export type RevertPackageCommitResponse = z.input<typeof RevertPackageCommitResponseSchema>;
/** Post-parse shape of {@link RevertPackageCommitResponse} — defaults applied, transforms run (ADR-0122). */
export type RevertPackageCommitResponseParsed = z.infer<typeof RevertPackageCommitResponseSchema>;
export type RollbackToPackageCommitResponse = z.input<typeof RollbackToPackageCommitResponseSchema>;
/** Post-parse shape of {@link RollbackToPackageCommitResponse} — defaults applied, transforms run (ADR-0122). */
export type RollbackToPackageCommitResponseParsed = z.infer<typeof RollbackToPackageCommitResponseSchema>;
export type PackageExportManifest = z.input<typeof PackageExportManifestSchema>;
/** Post-parse shape of {@link PackageExportManifest} — defaults applied, transforms run (ADR-0122). */
export type PackageExportManifestParsed = z.infer<typeof PackageExportManifestSchema>;
export type ReassignOrphanedMetadataResponse = z.input<typeof ReassignOrphanedMetadataResponseSchema>;
/** Post-parse shape of {@link ReassignOrphanedMetadataResponse} — defaults applied, transforms run (ADR-0122). */
export type ReassignOrphanedMetadataResponseParsed = z.infer<typeof ReassignOrphanedMetadataResponseSchema>;
export type DuplicatePackageResponse = z.input<typeof DuplicatePackageResponseSchema>;
/** Post-parse shape of {@link DuplicatePackageResponse} — defaults applied, transforms run (ADR-0122). */
export type DuplicatePackageResponseParsed = z.infer<typeof DuplicatePackageResponseSchema>;
export type ImportUnmanagedPackageRequest = z.input<typeof ImportUnmanagedPackageRequestSchema>;
/** Post-parse shape of {@link ImportUnmanagedPackageRequest} — defaults applied, transforms run (ADR-0122). */
export type ImportUnmanagedPackageRequestParsed = z.infer<typeof ImportUnmanagedPackageRequestSchema>;
export type ImportUnmanagedPackageResponse = z.input<typeof ImportUnmanagedPackageResponseSchema>;
/** Post-parse shape of {@link ImportUnmanagedPackageResponse} — defaults applied, transforms run (ADR-0122). */
export type ImportUnmanagedPackageResponseParsed = z.infer<typeof ImportUnmanagedPackageResponseSchema>;
export type GetPackageCustomizationsRequest = z.input<typeof GetPackageCustomizationsRequestSchema>;
/** Post-parse shape of {@link GetPackageCustomizationsRequest} — defaults applied, transforms run (ADR-0122). */
export type GetPackageCustomizationsRequestParsed = z.infer<typeof GetPackageCustomizationsRequestSchema>;
export type GetPackageCustomizationsResponse = z.input<typeof GetPackageCustomizationsResponseSchema>;
/** Post-parse shape of {@link GetPackageCustomizationsResponse} — defaults applied, transforms run (ADR-0122). */
export type GetPackageCustomizationsResponseParsed = z.infer<typeof GetPackageCustomizationsResponseSchema>;
export type EnsureCustomizationPackageRequest = z.input<typeof EnsureCustomizationPackageRequestSchema>;
/** Post-parse shape of {@link EnsureCustomizationPackageRequest} — defaults applied, transforms run (ADR-0122). */
export type EnsureCustomizationPackageRequestParsed = z.infer<typeof EnsureCustomizationPackageRequestSchema>;
export type EnsureCustomizationPackageResponse = z.input<typeof EnsureCustomizationPackageResponseSchema>;
/** Post-parse shape of {@link EnsureCustomizationPackageResponse} — defaults applied, transforms run (ADR-0122). */
export type EnsureCustomizationPackageResponseParsed = z.infer<typeof EnsureCustomizationPackageResponseSchema>;
