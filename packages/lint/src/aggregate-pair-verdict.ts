// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32449] The verdict the engine's `aggregate` door gives one (function,
 * declared field) pair, for the two authoring surfaces whose declarations
 * compile to an `engine.aggregate` call with that pair in it: an `object-grid`
 * block's `properties.aggregations` (`validateSortableFields`,
 * `grid-aggregation-field-type-refused`) and a list view's column summaries
 * (`validateListViewFieldRefs`, `list-view-summary-field-type-refused`).
 *
 * The verdict is the door's two halves, asked of the spec and never restated
 * (`aggregate-field-type-door.ts`, `@objectstack/objectql`):
 *
 *   - the TYPE half — the aggregate × field-type table
 *     (`AGGREGATE_FIELD_TYPE_COMPATIBILITY`), through
 *     `isAggregateCompatibleWithFieldType`, on every row: `sum` / `avg` over a
 *     non-numeric type, `min` / `max` over a string-class or JSON-stored type,
 *     `count_distinct` over a JSON-stored type. ⛔ No second type list: so
 *     `boolean` / `toggle` pass `sum` / `avg` / `min` / `max`, and a date
 *     passes `min` / `max`, exactly as they pass the door;
 *   - the DECLARATION half — `isMultiValueField`: a multi-capable type flagged
 *     `multiple: true` is a list stored as JSON, which the per-TYPE table
 *     cannot see. It takes the verdict the row gives the multi-option class,
 *     derived from the table as the door derives it (`rowAcceptsMultiValue`):
 *     a row that refuses any multi-option type refuses the declaration too.
 *     Today that moves `count_distinct` alone (the other value rows accept no
 *     multi-capable type, and `count` accepts every type), the same reading
 *     `validate-dataset-measure-aggregates.ts`' `acceptsDeclaration` gives a
 *     dataset measure.
 *
 * What neither surface judges is the door's own "cannot answer": no declared
 * type, or a type outside `FieldType` (a driver-internal alias). Callers ask
 * {@link isJudgeableAggregateType} first.
 */

import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  FieldType,
  MULTI_OPTION_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
  virtualFieldAggregateRemedy,
} from '@objectstack/spec/data';

/** The declaration slice the verdict reads: the field's type and its `multiple` flag. */
export interface AggregatedFieldShape {
  readonly type: string;
  readonly multiple?: boolean;
}

/** The declared `FieldType` vocabulary — the only types the table, and so the door, can answer for. */
const DECLARED_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/** The table's functions — `AggregationFunction`, read off the table so the two cannot drift. */
const TABLE_FUNCTIONS: readonly string[] = Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY);

/** Is `fn` a row of the table? A function outside it is the query schema's refusal, not this verdict's. */
export function isTableAggregate(fn: unknown): fn is string {
  return typeof fn === 'string' && TABLE_FUNCTIONS.includes(fn);
}

/** Does the door judge a field declared with this type at all? (`undefined` / an alias: no.) */
export function isJudgeableAggregateType(type: unknown): type is string {
  return typeof type === 'string' && DECLARED_FIELD_TYPES.has(type);
}

/** Does the table's `fn` row accept the multi-value class — every multi-option type? The door's own reading. */
function rowAcceptsMultiValue(fn: string): boolean {
  for (const type of MULTI_OPTION_TYPES) {
    if (!isAggregateCompatibleWithFieldType(fn, type)) return false;
  }
  return true;
}

/** May `fn` be applied to a field declared as `shape`? The door's two halves. */
export function aggregateAcceptsDeclaration(fn: string, shape: AggregatedFieldShape): boolean {
  if (!isAggregateCompatibleWithFieldType(fn, shape.type)) return false;
  return !(isMultiValueField({ type: shape.type, multiple: shape.multiple === true }) && !rowAcceptsMultiValue(fn));
}

/** The declaration as the words say it: the type, and the flag when the field carries it. */
export function declaredAs(shape: AggregatedFieldShape): string {
  return shape.multiple === true ? `\`${shape.type}\` with \`multiple: true\`` : `\`${shape.type}\``;
}

/** Where to point `fn` instead — the lead of the remedy, by the row's own accepted class. */
function retargetLead(fn: string): string {
  if (fn === 'count_distinct') return 'Count distinct values of a field that stores one scalar value';
  if (fn === 'min' || fn === 'max') return `Point "${fn}" at a numeric, date/time or boolean field`;
  if (fn === 'sum') return 'Point "sum" at a numeric field that adds (not a percent)';
  return `Point "${fn}" at a numeric field`;
}

/**
 * The remedy for a refused pair: the spec's one virtual-field prescription
 * when it applies (`virtualFieldAggregateRemedy`), otherwise where to point
 * the function instead, and the aggregates the field's declaration accepts —
 * read off the same verdict, in the table's order, so the words cannot name a
 * set the verdict was not taken from.
 */
export function refusedAggregateRemedy(fn: string, field: string, shape: AggregatedFieldShape): string {
  const virtual = virtualFieldAggregateRemedy(fn, shape.type);
  if (virtual !== undefined) return virtual;
  const accepted = TABLE_FUNCTIONS.filter((candidate) => aggregateAcceptsDeclaration(candidate, shape));
  const its = shape.multiple === true ? `${declaredAs(shape)} declaration` : `${declaredAs(shape)} type`;
  return `${retargetLead(fn)}, or aggregate "${field}" with one its ${its} accepts: ${accepted.join(', ')}.`;
}
