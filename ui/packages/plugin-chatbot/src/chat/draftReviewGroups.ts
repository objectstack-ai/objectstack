/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { DraftReviewItemParsed } from '@objectstack/spec/ai';

/** One package's drafts, in save order, with the package's Changes route. */
export interface PackageGroup {
  name: string;
  changes: string;
  drafts: DraftReviewItemParsed[];
}

/** Group the rows by package, packages in the order their first draft was saved. */
export function groupDraftsByPackage(drafts: readonly DraftReviewItemParsed[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();
  for (const draft of drafts) {
    const group = groups.get(draft.package);
    if (group) group.drafts.push(draft);
    else groups.set(draft.package, { name: draft.package, changes: draft.review.changes, drafts: [draft] });
  }
  return [...groups.values()];
}
