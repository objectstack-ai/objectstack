// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 32] A stored commit row's `items` column read back as its revert
 * plan, from `ObjectStackProtocolImplementation`, moved out of `protocol.ts`
 * whole: `parseCommitItems`, which `listCommits` and `revertCommit` call. An
 * array is the plan as stored; a string is parsed as JSON; anything else, or a
 * string that is not a JSON array, reads as no items.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name
 * and declared signature. The body reads no class member, so the method's
 * body calls the plain function, with no host. Every caller keeps calling the
 * class method.
 *
 * The plan item type is `protocol.ts`'s own, and is imported from there as a
 * type. Nothing re-exports this module, so the published surface does not
 * move.
 */

import type { CommitPlanItem } from './protocol.js';

/** The body of `ObjectStackProtocolImplementation#parseCommitItems`. */
export function parseCommitItems(
    raw: unknown,
): CommitPlanItem[] {
    if (Array.isArray(raw)) return raw as CommitPlanItem[];
    if (typeof raw === 'string') {
        try {
            const p = JSON.parse(raw);
            return Array.isArray(p) ? p : [];
        } catch {
            return [];
        }
    }
    return [];
}
