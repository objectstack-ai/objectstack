/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `@object-ui/plugin-detail/core` — the side-effect-free half of this package.
 *
 * The package root registers the detail and record-page renderers with
 * `ComponentRegistry` when it is evaluated and statically reaches every detail
 * surface, so a host that imports one pure helper from the root keeps all of
 * it in its own chunk. The console shell imports the helpers below from this
 * subpath instead, and the detail renderers load (and register) only when a
 * record page or a detail block is drawn.
 *
 * ⛔ Nothing exported here may import a detail renderer, `./index` or a module
 * that registers a component, directly or through a neighbour: the subpath is
 * only worth having while its closure stays these helpers. The same names are
 * still exported from the package root, unchanged. A module added to this
 * file's closure also joins the console's `plugin-detail-core` chunk group
 * (`apps/console/vite.config.ts`).
 *
 * The record-page caches the payload seeds write (`seedRecordVerdict`,
 * `seedRecordFieldAccess`, `seedQueueClaimDecision`) are module state their
 * hooks read from the root. Both entries reach the same module, so a seed
 * written through this subpath is the one the root's hooks read: the console
 * resolves both to the one source module, and the published ESM build emits
 * the two entries from one pass with the modules they share in shared files.
 */

export { isRefusedFeedRead } from './renderers/recordActivityFeed';
export { relatedListEntryNames } from './synth/relatedListEntry';
export {
  RELATED_ARRANGEMENT_RECORD_VERSION,
  relatedArrangementFromRecord,
  relatedArrangementToRecord,
} from './synth/relatedArrangement';
export type { RelatedArrangement } from './synth/relatedArrangement';
export {
  deriveFieldGroupDetailSections,
  deriveHighlightFields,
  resolveDetailSections,
} from './synth/buildDefaultPageSchema';
export { isWideFieldType } from './autoLayout';
export { prefetchRelatedCounts, relatedCountTargetsIn } from './useRelatedCounts';
export { COMPACT_RELATED_ROWS } from './relatedListCompact';
export { normalizeSortSpec as normalizeRelatedListSort } from './relatedListSort';
export { seedQueueClaimDecision } from './queueClaim';
export { seedRecordFieldAccess } from './recordFieldAccess';
export { seedRecordVerdict } from './useRecordEditable';
