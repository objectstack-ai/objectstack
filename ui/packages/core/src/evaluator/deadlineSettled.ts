/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Whether a declared deadline is settled for one row (objectui#11815).
 *
 * `@objectstack/spec` declares the deadline semantic on a `date` / `datetime`
 * field: `dueLike: true` makes it a deadline, and `settledWhen` is a per-record
 * CEL predicate that, while it holds, settles that deadline for the record —
 * no overdue wording, no overdue colour. The date cells paint from the field's
 * declaration alone and cannot evaluate a predicate, so every host that draws
 * one beside a row asks THIS function and hands the cell its answer as the
 * `deadlineSettled` prop. One helper, so no host carries its own copy.
 */
import { evalRowPredicate, type RowPredicateOptions } from './listConditional.js';
import type { FieldRulePredicate } from './fieldRules.js';

/** The two declared keys {@link isDeadlineSettled} reads off a field. */
export interface DeadlineFieldLike {
  name?: string;
  dueLike?: boolean | null;
  settledWhen?: FieldRulePredicate | null;
}

/**
 * `true` only when the field declares `dueLike: true` AND a `settledWhen`, and
 * that predicate holds for `row` (bound as `record`, through
 * {@link evalRowPredicate} — the evaluator, scope and relation collapse the
 * grid's conditional formatting uses).
 *
 * Every other answer is `false`:
 *  - a field that is not a declared deadline, or declares no `settledWhen`, is
 *    never settled;
 *  - a predicate that fails to evaluate is NOT settled. It was judged when it
 *    was authored, and a quiet "settled" would hide an overdue item; the
 *    evaluator's own one-time warning names the fault.
 */
export function isDeadlineSettled(
  field: DeadlineFieldLike | null | undefined,
  row: Record<string, unknown> | null | undefined,
  opts: Pick<RowPredicateOptions, 'scope' | 'fields'> = {},
): boolean {
  if (!field || field.dueLike !== true) return false;
  const settledWhen = field.settledWhen;
  if (settledWhen == null) return false;
  return evalRowPredicate(settledWhen, row, {
    fallback: false,
    scope: opts.scope,
    fields: opts.fields,
    label: `${field.name ?? 'field'}.settledWhen`,
  });
}
