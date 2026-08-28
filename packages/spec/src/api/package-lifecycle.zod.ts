// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Package lifecycle response contracts (#12038)
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
 * `packages.publish`'s contract is NOT here: its producer
 * (`MetadataManager.publishPackage`) already has an exact published schema,
 * `PackagePublishResultSchema` in `@objectstack/spec/system` — re-exported
 * below into this `/api` namespace (ruling 5A: re-export, never a second
 * copy) because the route-ledger resolver looks names up only in
 * `@objectstack/spec/api`.
 *
 * The retired `PackageRollbackResponseSchema` / `PackageApiContracts.
 * rollbackPackage` (see `./package-api.zod.ts`) declared a VERSION rollback
 * against the live COMMIT-rollback path; `RollbackToPackageCommitResponseSchema`
 * below is the true contract, authored after that retirement per the ruling's
 * sequencing (3A).
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

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

export type DiscardPackageDraftsResponse = z.input<typeof DiscardPackageDraftsResponseSchema>;
export type ListPackageCommitsResponse = z.input<typeof ListPackageCommitsResponseSchema>;
export type RevertPackageCommitResponse = z.input<typeof RevertPackageCommitResponseSchema>;
export type RollbackToPackageCommitResponse = z.input<typeof RollbackToPackageCommitResponseSchema>;
export type PackageExportManifest = z.input<typeof PackageExportManifestSchema>;
export type ReassignOrphanedMetadataResponse = z.input<typeof ReassignOrphanedMetadataResponseSchema>;
export type DuplicatePackageResponse = z.input<typeof DuplicatePackageResponseSchema>;
