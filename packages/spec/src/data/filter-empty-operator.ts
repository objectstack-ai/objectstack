// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20311] The `$empty` expansion — ONE definition for every face.
 *
 * `$empty: boolean` is declared by `FieldOperatorsSchema` and
 * `SpecialOperatorSchema` (`./filter.zod.ts`), whose description IS the ruled
 * per-type 「is empty」 table (ruling B on #20311, record 5861435168):
 * text-like = null or `''`; multi-value (multi-select, tags, multi-value
 * lookup) = null or `[]`; every other type = null only. Ruling A on #20399
 * (record 5865693155) spelled it as that operator and ruled that "each compile
 * surface expands it by the field's declared type through one spec function".
 * This module is that function, and the value-level predicate beside it.
 *
 * The operator is STAGED (the maintainer's amendment of ruling A, record
 * 5868169573, 「照 $like 先例分阶段」): absent from `FILTER_OPERATORS` until
 * every face has an arm, and the `is_empty` / `is_not_empty` lowering still
 * emits `$null`. Nothing in this repository calls these functions yet; the
 * compile-surface lane cards do, one face each.
 *
 * ## Why this is its own module
 *
 * It reads the value contract's sets (`STRING_VALUE_TYPES`,
 * `isMultiValueField` in `./field-value.zod.ts`) rather than keeping a list of
 * its own, so it must import them — and `filter.zod.ts` is deliberately not
 * the module that does: the two meet in the `field.zod` import cycle, where a
 * module-scope read of a set is not safe under `OS_EAGER_SCHEMAS=1`, and
 * `filter.zod.ts`' import closure is what the published query skill's
 * reference index walks. The sibling `filter-text-operator-declared-type.ts`
 * reads the same sets from the same position for the same reason.
 */

import { STRING_VALUE_TYPES, isMultiValueField, type ValueShapeFieldDef } from './field-value.zod';

/**
 * [#20311] The three rows of the ruled 「is empty」 table:
 *
 * - `text` — text-like types (`STRING_VALUE_TYPES`): null or `''`;
 * - `multi_value` — a field whose persisted value is a list
 *   (`isMultiValueField`: multiselect, checkboxes, tags, or a multi-capable
 *   type with `multiple: true` — a multi-value lookup is a `lookup` or `user`
 *   with `multiple: true`): null or `[]`;
 * - `null_only` — every other type: null only.
 */
export type EmptyOperatorArm = 'text' | 'multi_value' | 'null_only';

/**
 * [#20311] What `$empty: true` matches on one field, stated surface-neutrally:
 * null (no value) always counts as empty, and the two flags say which of the
 * two further stored states count too. A compile surface turns this into its
 * own predicate — `IS NULL OR col = ''` on the SQL family, a JSON-length test
 * for `emptyList`, a value test on a JS face — and `$empty: false` is the exact
 * complement of whatever `true` matches.
 *
 * ⛔ Deliberately NOT a `FilterCondition`: the multi-value row cannot be
 * spelled in the lowered vocabulary, because an empty list is refused as an
 * equality comparand (ruling 乙 on #19757, record 5793368540, unchanged by this
 * operator). That is why the table lives in an operator each surface expands,
 * rather than in a lowering that emits fragments.
 */
export interface EmptyOperatorExpansion {
  /** Which row of the ruled table the field takes. */
  readonly arm: EmptyOperatorArm;
  /** The empty string `''` counts as empty, beside null. */
  readonly emptyString: boolean;
  /** The empty list `[]` counts as empty, beside null. */
  readonly emptyList: boolean;
}

/**
 * [#20311] The three expansions, one frozen object per row, so a surface may
 * compare by identity or switch on `arm`.
 */
export const EMPTY_OPERATOR_ARMS: Readonly<Record<EmptyOperatorArm, EmptyOperatorExpansion>> = Object.freeze({
  text: Object.freeze({ arm: 'text', emptyString: true, emptyList: false }),
  multi_value: Object.freeze({ arm: 'multi_value', emptyString: false, emptyList: true }),
  null_only: Object.freeze({ arm: 'null_only', emptyString: false, emptyList: false }),
});

/**
 * [#20311] Expand `$empty` for one field, keyed on its DEFINITION — the type
 * and `multiple` — because the multi-value row cannot be read off the type
 * alone: a `lookup` is `null_only` and a `lookup` with `multiple: true` is
 * `multi_value`. The one function every compile surface calls, reading the
 * sets the value contract already owns rather than a list of its own.
 *
 * The multi-value test runs first. The two sets are disjoint today (no
 * text-like type is multi-capable), so the order only decides a future
 * overlap, and it decides it by the stored SHAPE: a field whose value is a
 * list is emptied to `[]`.
 */
export function expandEmptyOperator(field: ValueShapeFieldDef): EmptyOperatorExpansion {
  if (isMultiValueField(field)) return EMPTY_OPERATOR_ARMS.multi_value;
  if (STRING_VALUE_TYPES.has(field.type)) return EMPTY_OPERATOR_ARMS.text;
  return EMPTY_OPERATOR_ARMS.null_only;
}

/**
 * [#20311] Is this stored VALUE empty? The value-level half of the same table,
 * for the JS evaluation faces.
 *
 * - With an `expansion` (from {@link expandEmptyOperator}): the declared row —
 *   null or `undefined` always, `''` only on the `text` row, `[]` only on the
 *   `multi_value` row.
 * - Without one: the reading ruling A gives the faces that hold NO field
 *   declaration (`@objectstack/formula`'s matcher, objectql `having` over
 *   aggregated rows) — null, `undefined`, `''` and `[]` are all empty. It
 *   differs from the declared table only on a non-text column holding `''`,
 *   which is a write-door defect rather than a stored state.
 *
 * `$empty: false` is `!isEmptyFilterValue(…)` with the same arguments.
 */
export function isEmptyFilterValue(value: unknown, expansion?: EmptyOperatorExpansion): boolean {
  if (value === null || value === undefined) return true;
  if (value === '') return expansion === undefined || expansion.emptyString;
  if (Array.isArray(value) && value.length === 0) return expansion === undefined || expansion.emptyList;
  return false;
}
