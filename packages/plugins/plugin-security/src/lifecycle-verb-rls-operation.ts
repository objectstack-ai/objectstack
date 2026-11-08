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
 * Every site that judges a write by its class reads this mapping, never an
 * inline copy of it [#30237]: the RLS compiler's own operation map
 * (`RLSCompiler.mapOperationToRLS`, whose default would otherwise send a
 * lifecycle verb to `select` and compose it as a READ), the layered RLS
 * composition (`computeLayeredRlsFilter`), the by-id write pre-image gate
 * (`security-plugin.ts`, step 2.7, whose floor decision
 * `resolvePreImageFloorDrop` and floor hand-over `masterGateCoversOperation`
 * key on the mapped verb), the addressed-write readers
 * (`security-plugin-addressed-writes.ts`), the controlled-by-parent write
 * gate's predicate test, and `security/explain` (`explain-engine.ts`), the
 * object-level `rls` layer and the record-level row story alike — and
 * [#22571] its read-absent rewrite (#21771 ruling A), whose guard asks this
 * mapping which operation the explained verb's door is, so a `transfer` of a
 * row the caller cannot read gets the missing-record shape the transfer
 * door's 404 is.
 *
 * `restore` and `purge` dispatch on the engine since the recycle bin
 * (ADR-0148): the permanent delete as `purge` by id, `purge(entryId)` /
 * `empty(object)` as `purge` and `restore(entryId)` as `restore` with no id
 * and no AST. The object gate reads their grants (`permission-evaluator.ts`,
 * `allowRestoreOwnDeleted` / `manageRecycleBin`), and a by-id `purge` meets
 * the row-level security this mapping composes for `delete`.
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
