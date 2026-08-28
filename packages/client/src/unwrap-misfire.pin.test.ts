// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12038 §8.2] The `unwrapResponse` mis-unwrap hazard, pinned.
 *
 * `unwrapResponse` (`./index.ts`) strips an envelope exactly when the body
 * carries BOTH a boolean `success` AND a `data` key, and passes everything
 * else through. On the REST surface the bound routes answer their payload
 * BARE, so the heuristic runs against the payload itself: a payload that ever
 * grew both keys would be silently unwrapped to its `data` member and every
 * annotation this family added would become false — with no type error and no
 * failing runtime test anywhere.
 *
 * None of the bound producer payloads carries both keys today (several carry
 * boolean `success`; none carries `data` beside it — survey §8.2 measured
 * exactly this). This suite pins that fact at the CONTRACT: it reads each
 * bound schema's declared key set and refuses the `success`+`data`
 * combination, so the hazard cannot re-enter through a schema edit. Adding a
 * `data` key to one of these payloads is not automatically wrong — but it
 * cannot be done without meeting this pin and deciding what the SDK's unwrap
 * should do about it.
 *
 * Deliberately OUTSIDE the pin:
 * - `GetPublishedMetaItemResponseSchema` — opaque by ruling (1C): the body is
 *   an arbitrary authored metadata item, so no key set exists to pin. A
 *   published item body carrying both keys would be mis-unwrapped on the REST
 *   surface; that exposure is inherent to the ruled opacity and is recorded
 *   here rather than hidden.
 * - `PackageExportManifestSchema`'s catch-all keys — registry-derived plural
 *   metadata type names. The companion assertion below pins that the plural
 *   vocabulary contains neither `success` nor `data`, so the open half cannot
 *   produce the combination either.
 */

import { describe, it, expect } from 'vitest';
import {
  ListDraftsResponseSchema,
  GetMetaDiagnosticsResponseSchema,
  FindReferencesToMetaResponseSchema,
  AuditMetaItemResponseSchema,
  RollbackMetaItemResponseSchema,
  DiffMetaItemResponseSchema,
  ResolvedBookSchema,
  PackagePublishResultSchema,
  DiscardPackageDraftsResponseSchema,
  ListPackageCommitsResponseSchema,
  RevertPackageCommitResponseSchema,
  RollbackToPackageCommitResponseSchema,
  PackageExportManifestSchema,
  ReassignOrphanedMetadataResponseSchema,
  DuplicatePackageResponseSchema,
} from '@objectstack/spec/api';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

/** Every bound object-shaped payload schema, labelled for the failure message. */
const BOUND_PAYLOAD_SCHEMAS: ReadonlyArray<readonly [string, unknown]> = [
  ['ListDraftsResponseSchema', ListDraftsResponseSchema],
  ['GetMetaDiagnosticsResponseSchema', GetMetaDiagnosticsResponseSchema],
  ['FindReferencesToMetaResponseSchema', FindReferencesToMetaResponseSchema],
  ['AuditMetaItemResponseSchema', AuditMetaItemResponseSchema],
  ['RollbackMetaItemResponseSchema', RollbackMetaItemResponseSchema],
  ['DiffMetaItemResponseSchema', DiffMetaItemResponseSchema],
  ['ResolvedBookSchema', ResolvedBookSchema],
  ['PackagePublishResultSchema', PackagePublishResultSchema],
  ['DiscardPackageDraftsResponseSchema', DiscardPackageDraftsResponseSchema],
  ['ListPackageCommitsResponseSchema', ListPackageCommitsResponseSchema],
  ['RevertPackageCommitResponseSchema', RevertPackageCommitResponseSchema],
  ['RollbackToPackageCommitResponseSchema', RollbackToPackageCommitResponseSchema],
  ['PackageExportManifestSchema', PackageExportManifestSchema],
  ['ReassignOrphanedMetadataResponseSchema', ReassignOrphanedMetadataResponseSchema],
  ['DuplicatePackageResponseSchema', DuplicatePackageResponseSchema],
];

/** The predicate under pin: would `unwrapResponse`'s heuristic fire on this declared key set? */
function declaresTheEnvelopeShape(keys: readonly string[]): boolean {
  return keys.includes('success') && keys.includes('data');
}

/** Declared top-level keys of a (lazySchema-proxied) z.object — the AuditMetaItemRequest pattern. */
function declaredKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  expect(shape && typeof shape === 'object').toBe(true);
  return Object.keys(shape as Record<string, unknown>);
}

describe('no bound payload can trip the unwrapResponse heuristic (#12038 §8.2)', () => {
  it.each(BOUND_PAYLOAD_SCHEMAS.map(([name, schema]) => ({ name, schema })))(
    '$name never declares boolean `success` beside `data`',
    ({ schema }) => {
      const keys = declaredKeys(schema);
      // Anti-vacuity half: the shape really was read (every bound payload
      // declares at least one key).
      expect(keys.length).toBeGreaterThan(0);
      expect(declaresTheEnvelopeShape(keys)).toBe(false);
    },
  );

  it('the predicate itself is live — a payload declaring both keys WOULD be refused', () => {
    // Negative control: drive the same predicate a real schema goes through
    // with the exact key set the heuristic fires on. A guard whose failure
    // path never executes is a guard nobody has seen fail.
    expect(declaresTheEnvelopeShape(['success', 'data'])).toBe(true);
    expect(declaresTheEnvelopeShape(['success', 'revertedCommits', 'failed'])).toBe(false);
  });

  it('the export manifest\'s OPEN half cannot produce the combination either', () => {
    // `PackageExportManifestSchema`'s catch-all keys come from the plural
    // metadata-type vocabulary (`manifest[plural] = …` in the handler). Pin
    // that the vocabulary can never contribute the heuristic's key pair.
    const plurals = Object.keys(PLURAL_TO_SINGULAR);
    expect(plurals.length).toBeGreaterThan(0);
    expect(plurals).not.toContain('success');
    expect(plurals).not.toContain('data');
  });
});
