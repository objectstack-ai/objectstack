// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The operation a write's row-level security is composed for, given the verb
 * the write was asked as.
 *
 * Row-level security policies declare `select` / `insert` / `update` /
 * `delete` (`RowLevelSecurityPolicySchema`); the destructive lifecycle verbs
 * have no policy class of their own. Each one is judged as its nearest write
 * class, so the policies an author wrote for that class apply to it:
 *
 *   transfer → update   (it rewrites `owner_id`, an ordinary update)
 *   restore  → update   (it rewrites the row back into existence)
 *   purge    → delete   (it destroys the row, as delete does)
 *
 * Every other verb is returned unchanged.
 *
 * ⛔ Not the RLS compiler's own map. `RLSCompiler.mapOperationToRLS` sends every
 * verb outside its list to `select`, so a lifecycle verb handed to
 * `computeLayeredRlsFilter` raw is composed as a READ: no update-class policy
 * and no ownership floor reaches it. That default serves the compiler's other
 * callers and is left alone; the mapping is applied here, BEFORE the
 * composition is asked, and every composition for a lifecycle verb reads it:
 *
 *  - the by-id write pre-image gate (`security-plugin.ts`, step 2.7) — the
 *    door's composition, whose floor decision (`resolvePreImageFloorDrop`) and
 *    floor hand-over (`masterGateCoversOperation`) key on the mapped verb;
 *  - `security/explain` (`explain-engine.ts`), the object-level `rls` layer and
 *    the record-level row story alike, so a `transfer` is explained against the
 *    update-class policies the door judges it by.
 *
 * The middleware's AST step (step 3) passes its verb RAW, by design: the
 * engine's middleware vocabulary carries no lifecycle verb, an invariant
 * pinned in `packages/objectql/src/engine-middleware-operation-vocabulary.test.ts`.
 * If that invariant ever breaks, this is the mapping that site adopts.
 *
 * `restore` and `purge` are refused at the object gate for every principal
 * until their grants return (`permission-evaluator.ts`,
 * `DESTRUCTIVE_OPERATIONS`), so the object-level CRUD layer decides their
 * verdict first; the mapping is what their row-level security is composed for
 * on the day they can be granted.
 */
export const LIFECYCLE_VERB_RLS_OPERATION: Readonly<Record<string, 'update' | 'delete'>> = Object.freeze({
  transfer: 'update',
  restore: 'update',
  purge: 'delete',
});

/** The operation `computeLayeredRlsFilter` is asked for when a write is asked as `operation`. */
export function rlsOperationForVerb(operation: string): string {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_VERB_RLS_OPERATION, operation)
    ? LIFECYCLE_VERB_RLS_OPERATION[operation]
    : operation;
}
