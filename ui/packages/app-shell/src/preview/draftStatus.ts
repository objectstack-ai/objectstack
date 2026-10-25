/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Live draft-status read for the chat's draft cards (panel-as-source-of-truth,
 * made literal): how many drafts are still PENDING in a package, straight from
 * the ADR-0033 `_drafts` endpoint. The chat passes this to
 * `fetchPendingDraftCount` so a card's Publish/Published affordance reflects
 * the server's CURRENT state — across conversation reloads, other sessions'
 * publishes, and later edits into the same package — instead of replaying the
 * tool-result snapshot it was born with.
 *
 * Cookie-authenticated like every other console call; tolerant of both
 * response shapes (`[...]` and `{ drafts: [...] }`).
 */
import { fetchPendingDrafts } from './usePendingDrafts.js';

export async function fetchPendingDraftCount(packageId: string): Promise<number> {
  return (await fetchPendingDrafts(packageId)).length;
}
