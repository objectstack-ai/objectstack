/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The most records a "select all matching" bulk action processes.
 *
 * `ObjectGrid`'s `resolveBulkRows` stops its paged fan-out here, and the bulk
 * bar and the selection's context menu name this number whenever the match set
 * is larger. All three read this one constant, so what the screen says is
 * processed and what the action receives cannot drift apart. ⛔ Never re-spell
 * the number at a consumption site.
 */
export const BULK_SELECT_ALL_MATCHING_CAP = 5000;

/** True when a "select all matching" run over `totalMatching` records stops short at the cap. */
export const exceedsBulkSelectAllMatchingCap = (totalMatching: number | undefined): totalMatching is number =>
  typeof totalMatching === 'number' && totalMatching > BULK_SELECT_ALL_MATCHING_CAP;
