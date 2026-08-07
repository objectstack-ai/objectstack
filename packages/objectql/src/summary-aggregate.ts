// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The roll-up `summary` core: what a roll-up IS (the descriptor), what it reads
 * over an empty child collection, and how ONE descriptor's value is computed
 * for ONE parent.
 *
 * Lifted out of `engine.ts` verbatim by #6063 for a single reason: the one-off
 * backfill of pre-#6013 `NULL` rows (`os migrate summary-nulls`) must write the
 * value the engine itself would write — not a second implementation that agrees
 * today. Three call sites now share this file:
 *
 *   1. {@link ObjectQL.initializeSummaryFields} — the insert-time seed (#5749 /
 *      PR #6013): a brand-new parent starts at {@link summaryEmptySetValue}.
 *   2. `ObjectQL.recomputeSummaries` — the child-write recompute: aggregate,
 *      then the same empty-set fallback.
 *   3. `backfillSummaryNulls` (`./summary-backfill.js`, #6063) — the existing
 *      rows the insert-time seed structurally cannot reach.
 *
 * The same reasoning `scan-value-shapes.ts` gives for importing the write-path
 * predicate applies here: a second "what does this roll-up equal" drifting by
 * one clause would let a migration write values the engine then disagrees with
 * on the next child write — a column that changes under a user who changed
 * nothing.
 */

/** A roll-up `summary` field on a parent object that aggregates a child. */
export interface SummaryDescriptor {
  parentObject: string;
  summaryField: string;
  /**
   * The child object aggregated — `summaryOperations.object`.
   *
   * [#6063] Present on the descriptor itself so the PARENT-side view is usable
   * on its own. The child-side index is keyed by this name, so the recompute
   * path never needed it as a field; the backfill iterates parents and does.
   */
  childObject: string;
  /** FK field on the child pointing back to the parent. */
  fkField: string;
  fn: 'count' | 'sum' | 'min' | 'max' | 'avg';
  /** Child field aggregated (unused for count). */
  sourceField: string;
  /**
   * Optional predicate (a query `where` FilterCondition) restricting which child
   * rows are aggregated. ANDed with the parent-FK match when the aggregate runs.
   * Undefined ⇒ aggregate every child of the parent.
   */
  filter?: Record<string, unknown>;
}

/**
 * The value a roll-up summary takes over an **empty** child collection (#5749).
 *
 * `count` and `sum` are defined on the empty set — zero children is zero, not
 * "unknown" — while `min`/`max`/`avg` are not, so those stay `null`. This is the
 * ONE place that list is written down: {@link aggregateSummaryValue} uses it for
 * the post-aggregate fallback (an aggregate over no rows returns
 * `null`/`undefined` on every driver), `ObjectQL.initializeSummaryFields` uses
 * it to seed a brand-new parent row with the same value the first recompute
 * would have produced, and `backfillSummaryNulls` (#6063) reads it to decide
 * which columns a stored `NULL` is even a defect in. Three sites, one list — a
 * parent that has never had a child and a parent whose last child was deleted
 * are the SAME logical state and must read the same value.
 */
export function summaryEmptySetValue(fn: SummaryDescriptor['fn']): number | null {
  return fn === 'count' || fn === 'sum' ? 0 : null;
}

/**
 * Does a stored `null` in this roll-up's column mean "never computed"?
 *
 * Only for the functions that HAVE an empty-set value: a `null` `count`/`sum`
 * is a hole (the correct value is 0 or the real aggregate), while a `null`
 * `min`/`max`/`avg` is the legitimate reading of "no child rows" and must be
 * left exactly as it is. #6063's scope narrowing is this predicate, and it is
 * derived from {@link summaryEmptySetValue} rather than re-listing the
 * functions, so the two can never disagree.
 */
export function summaryNullIsBackfillable(fn: SummaryDescriptor['fn']): boolean {
  return summaryEmptySetValue(fn) !== null;
}

/**
 * The engine surface one roll-up aggregate needs — deliberately the single
 * verb, so nothing here can write.
 */
export interface SummaryAggregateEngine {
  aggregate(object: string, query: any, options?: any): Promise<any[]>;
}

/**
 * Compute ONE roll-up descriptor's value for ONE parent id.
 *
 * The parent-FK match is ANDed with the descriptor's optional predicate so only
 * matching child rows are aggregated (e.g. sum receipts where
 * `{ status: 'received' }`), and an aggregate over no rows — `null`/`undefined`
 * on every driver — falls back to {@link summaryEmptySetValue}.
 *
 * Driver-agnostic by construction: it speaks the engine's aggregate contract,
 * never SQL, so a deployment on any driver gets the same value (#6063 ruling 3).
 */
export async function aggregateSummaryValue(
  engine: SummaryAggregateEngine,
  desc: SummaryDescriptor,
  parentId: string,
  execCtx?: unknown,
): Promise<unknown> {
  const fkMatch = { [desc.fkField]: parentId };
  const where = desc.filter ? { $and: [fkMatch, desc.filter] } : fkMatch;
  const rows = await engine.aggregate(desc.childObject, {
    where,
    aggregations: [{
      function: desc.fn,
      ...(desc.fn === 'count' ? {} : { field: desc.sourceField }),
      alias: 'value',
    }],
    context: execCtx,
  });
  const value = rows?.[0]?.value;
  return value == null ? summaryEmptySetValue(desc.fn) : value;
}
