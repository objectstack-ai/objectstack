// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which filter operator FITS which declared field type: the one exported
 * judgement every door asks, so no door keeps its own operator-by-type table.
 *
 * ## What "fits" means here, and why it is this narrow
 *
 * An operator does NOT fit a field type when a declared-type door of the
 * platform REFUSES that operator over a field of that type. That is a fact the
 * runtime enforces, so a caller that reports "this filter stops fitting" (the
 * destructive-change answer's `stillShownBy` for a type change, a hosted build
 * door's preview) reports a filter that will be refused, never a matter of
 * taste. Every other pair fits: an ordering operator over a `boolean`, say, is
 * answered by the engine, so it is not called unfit here.
 *
 * ## The rows are the doors, by reference
 *
 * {@link FILTER_OPERATOR_FIELD_TYPE_FIT} holds one row per declared-type door
 * that judges an operator CLASS. Each row names its operators and its verdict
 * by reference to the door's own exports — never a re-listing of field types.
 * Today there is one door of that kind: the text-operator declared-type door
 * (`filter-text-operator-declared-type.ts`, #15661), whose ruled verdict
 * ({@link textOperatorDoorVerdict}) refuses a text operator over a type that can
 * never store a string, with `INVALID_FILTER` / 400 at the engine's field-aware
 * seam. A declared-type door added later that judges an operator class adds its
 * row here, and every caller of {@link filterOperatorFieldTypeFit} sees it.
 *
 * The comparand doors (number, boolean, temporal, string-stored) judge the
 * VALUE a filter compares with, not its operator, and are deliberately not
 * rows: a type change that leaves a stored comparand unreadable is a different
 * question from an operator that stops fitting.
 *
 * ## Not the filter builder's offer
 *
 * `@object-ui/components`' `operatorsForFieldType` decides which operators a
 * dropdown DRAWS for a column. That is an offer, wider and narrower than this
 * judgement in places (it draws no ordering operator over a `select`, which the
 * engine still answers). This module judges what the runtime refuses.
 */

import { dollarFilterOperatorOf, FILTER_OPERATORS } from './filter.zod';
import {
  TEXT_FILTER_OPERATORS,
  textOperatorDoorVerdict,
  type TextOperatorDoorFieldMeta,
} from './filter-text-operator-declared-type';

/**
 * The judgement's three answers.
 *
 * - `fits` — no declared-type door refuses this operator over this field.
 * - `unfit` — a declared-type door refuses it (the row's `refusal` says how).
 * - `unjudged` — the operator spelling is outside the vocabulary, or the door
 *   that would judge it records no verdict for this field (a `formula` whose
 *   return type cannot be read).
 */
export type FilterOperatorFieldTypeFit = 'fits' | 'unfit' | 'unjudged';

/** The slice of a field definition the judgement reads. */
export type FilterOperatorFieldMeta = TextOperatorDoorFieldMeta;

/** One declared-type door that judges an operator class. */
export interface FilterOperatorFieldTypeFitRow {
  /** The door, named after the module that declares it. */
  readonly door: string;
  /** The `$`-spelled operators the door judges — the door's own export. */
  readonly operators: readonly string[];
  /** The door's verdict for one field, folded onto this judgement's answers. */
  readonly verdict: (field: FilterOperatorFieldMeta) => FilterOperatorFieldTypeFit;
  /** What the runtime answers an unfit filter with. */
  readonly refusal: string;
}

/**
 * The operator-by-field-type judgement: one row per declared-type door that
 * judges an operator class. Read it through {@link filterOperatorFieldTypeFit}.
 */
export const FILTER_OPERATOR_FIELD_TYPE_FIT: readonly FilterOperatorFieldTypeFitRow[] = Object.freeze([
  Object.freeze({
    door: 'filter-text-operator-declared-type',
    operators: TEXT_FILTER_OPERATORS,
    verdict: (field: FilterOperatorFieldMeta): FilterOperatorFieldTypeFit => {
      const verdict = textOperatorDoorVerdict(field);
      return verdict === 'door-refusal' ? 'unfit' : verdict === 'deferred' ? 'unjudged' : 'fits';
    },
    refusal: 'INVALID_FILTER (400) at the engine\'s field-aware seam: a text operator over a field whose declared '
      + 'type can never store a string',
  }),
]);

/** Every `$` operator the judgement knows: the declared field operators and the text-operator door's set. */
const KNOWN_DOLLAR_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...FILTER_OPERATORS,
  ...TEXT_FILTER_OPERATORS,
]);

/**
 * Does `operator` fit a field declared as `field`? `operator` is any spelling
 * the filter vocabularies accept: a view rule's (`contains`, `not_contains`),
 * an alias (`notContains`, `startsWith`), an infix one (`>`, `before`) or a `$`
 * one (`$contains`). Pure: no I/O.
 */
export function filterOperatorFieldTypeFit(
  operator: string,
  field: FilterOperatorFieldMeta,
): FilterOperatorFieldTypeFit {
  const dollar = dollarFilterOperatorOf(operator);
  if (dollar === undefined || !KNOWN_DOLLAR_OPERATORS.has(dollar)) return 'unjudged';
  for (const row of FILTER_OPERATOR_FIELD_TYPE_FIT) {
    if (row.operators.includes(dollar)) return row.verdict(field);
  }
  return 'fits';
}
