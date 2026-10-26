/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Per-record `visible` eligibility for a bulk action (objectui#3067).
 *
 * ## The rule
 *
 * A bulk def's `visible` is evaluated **once per selected record, with that
 * record in scope** — the same binding and the same fail-closed contract the
 * row kebab uses (`useRowPredicate(..., { fallback: false })`). From that one
 * evaluation both questions are answered:
 *
 *   - **Is the button offered?** Yes when at least one selected record passes.
 *     A record-free predicate (`features.x`, `current_user.y`) returns the same
 *     verdict for every row, so it behaves exactly like a button-level gate —
 *     no need to detect whether the author referenced `record`.
 *   - **Which records does it run on?** The ones that passed. The rest are
 *     reported as skipped rather than silently included.
 *
 * ## What this replaces
 *
 * The bar used to evaluate `visible` against the ambient scope with no record
 * bound, on the lenient path. That does not fail open — it returns `true` for
 * *every* row-scoped predicate, including the ones that should be false:
 * `${record.done}` and `${record.owner == user.id}` both evaluated `true` with
 * no record in scope. So an authored gate was not weakened, it was inverted for
 * half its inputs, and nothing distinguished that from a real verdict.
 *
 * The mechanism predates objectui#3002, but only inline-authored
 * `bulkActionDefs[].visible` used to reach it — written by authors who knew
 * there was no record. #3031 began promoting object actions into the bar, and
 * their `visible` is typically written for a row/record surface, which is what
 * made row-scoped predicates land in a record-free evaluation.
 */

import { partitionRowsByPredicate, type FieldContainerLike } from '@object-ui/core';
import { hasDeclaredVisibilityGate } from '@object-ui/components';
import type { BulkActionDef } from '@object-ui/types';

export interface BulkEligibility<TRow> {
  /** Records whose `visible` passed — the ones the action actually runs on. */
  eligible: TRow[];
  /**
   * How many selected records were filtered out. Surfaced to the user in the
   * dialog: a run over fewer records than they selected must say so.
   */
  skipped: number;
}

/**
 * A def as far as this fold is concerned. `visible` is widened with `boolean`
 * beyond `BulkActionDef`'s `ExpressionInput`: the schema cannot emit one, but
 * hand-written view JSON and in-process callers do, and the fold owes them the
 * same short-circuit every other predicate surface gives (see below).
 */
export type BulkEligibilityDef = Pick<BulkActionDef, 'name'> & {
  visible?: BulkActionDef['visible'] | boolean;
};

/**
 * Whether the def declares a visibility gate at all. The `def`-shaped door onto
 * the action family's one definition of "declared", `hasDeclaredVisibilityGate`
 * (`@object-ui/components`, a re-export of core's `hasDeclaredPredicate`).
 * {@link partitionBulkRows} asks it too before it hands anything to the fold,
 * so the button and the fold behind it cannot disagree about one def.
 *
 * The bar reads it because "no record qualified" only means "hide me" for a def
 * that gated itself; an ungated def renders regardless. Truthiness cannot
 * answer this: `visible: false` is a declared gate that excludes everything,
 * and testing `def.visible &&` classified it as *ungated* — which rendered the
 * button `false` was written to remove (objectui#3492).
 *
 * Blank is not declared: `''`, a whitespace-only string and an envelope whose
 * `source` is blank are all "no gate", as on the row menu and the toolbars.
 * This used to be a test of its own, `!= null && !== ''`, so a whitespace-only
 * `visible` counted as a gate here, every record failed it, and the selection
 * bar hid an action the rest of the grid showed (objectui#11322).
 */
export function hasVisibilityGate(def: BulkEligibilityDef | null | undefined): boolean {
  return hasDeclaredVisibilityGate(def?.visible);
}

/**
 * Split selected records into the ones this def may act on and a count of the
 * ones it may not.
 *
 * The loop, the boolean short-circuit and the fail-closed posture all live in
 * `@object-ui/core`'s {@link partitionRowsByPredicate} — the ONE per-record
 * fold every bulk surface shares. This function is the bulk ACTION's door onto
 * it: it knows that a bulk def spells its predicate `visible`, labels warnings
 * with the def's name, and decides "is a gate declared?" first.
 *
 * That last part is the action family's question, asked here through
 * {@link hasVisibilityGate} and not left to the fold (objectui#11322). The
 * fold's own opening test (`null` / `undefined` / `''`) is its field-rule
 * callers' answer, and it is narrower: a whitespace-only `visible` or an
 * envelope whose `source` is blank would reach the evaluator there, fail
 * closed for every record, and run the action over nothing, while the row menu
 * and the toolbars read the same value as no gate. A def with no declared gate
 * therefore reaches the fold as `undefined`, and every record qualifies, by
 * reference.
 *
 * The built-in Delete's `userActions.delete.visibleWhen` does NOT come through
 * here. It is a field-rule key, not an action's `visible`, so `ObjectGrid`
 * hands it to the fold directly, as plugin-list's `ListView` does, and a blank
 * one keeps the fold's answer (objectui#4420).
 */
export function partitionBulkRows<TRow extends Record<string, unknown>>(
  def: BulkEligibilityDef | null | undefined,
  rows: readonly TRow[],
  opts: {
    scope?: Record<string, unknown>;
    /**
     * The object's field definitions, so a `visible` comparing a relation field
     * sees the stored foreign key rather than the record `$expand` substituted
     * for it — the selection bar's rows come straight off the grid's expanded
     * fetch. See `toPredicateRecord`.
     */
    fields?: FieldContainerLike;
  } = {},
): BulkEligibility<TRow> {
  return partitionRowsByPredicate(hasVisibilityGate(def) ? (def?.visible as never) : undefined, rows, {
    scope: opts.scope,
    fields: opts.fields,
    warnOnError: true,
    label: def?.name,
  });
}
