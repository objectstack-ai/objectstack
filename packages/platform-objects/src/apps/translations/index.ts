// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup App Translations — barrel.
 */

export { SetupAppTranslations } from './setup.translation.js';
export { en } from './en.js';
export { zhCN } from './zh-CN.js';
export { jaJP } from './ja-JP.js';
export { esES } from './es-ES.js';

/**
 * The staleness mechanism (#8765 Option B, extended to the generated bundles by
 * the #12069 Option A ruling). Exported because `os i18n extract` writes the
 * generated half of the records and must use THIS hash function and THIS rule —
 * a second copy in the CLI would be the "second mechanism" the ruling forbids.
 */
export {
  HAND_AUTHORED_SECTIONS,
  GENERATED_SECTIONS,
  hashSource,
  collectSourceLeaves,
  collectGeneratedLeaves,
  collectSourceHashes,
  collectFilledFromHashes,
  findStaleLeaves,
  findStaleFills,
  withSourceFallback,
} from './source-hash.js';
export type { SourceHashes, StaleLeaf, StaleFill } from './source-hash.js';
