// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field → aggregation semantics. The single source of truth for "how should a
 * numeric field be aggregated into a measure", shared by authoring (dataset
 * derivation) and validation (build-time coherence checks) so the two cannot
 * drift.
 *
 * The motivating defect: additive amounts (currency/number) SUM correctly, but
 * a RATE — a `percent` field such as a win-probability or conversion rate — must
 * AVG. Summing percentages is meaningless: the total routinely exceeds 100%.
 */

/** Numeric field types that can back a value measure. */
export const MEASURE_FIELD_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent']);

/**
 * The aggregation a derived value measure should use for a field of this type:
 * rates (`percent`) AVG, every other additive amount SUMs.
 */
export function defaultAggregateFor(fieldType: string | undefined): 'sum' | 'avg' {
  return fieldType === 'percent' ? 'avg' : 'sum';
}

/**
 * Is applying `aggregate` to a field of `fieldType` semantically incoherent?
 * True only for cases that produce a meaningless number — today: SUM (or
 * COUNT_DISTINCT) of a percentage/rate. Returns false when the field type is
 * unknown (cannot judge) so callers never raise a false positive.
 */
export function isIncoherentAggregate(aggregate: string, fieldType: string | undefined): boolean {
  if (fieldType === 'percent' && (aggregate === 'sum' || aggregate === 'count_distinct')) return true;
  return false;
}

/**
 * What this aggregate evaluates to over an EMPTY set of rows — the identity
 * element, or `undefined` when the aggregate genuinely has no answer.
 *
 * Counting no rows is `0` and summing them is `0`: those are measured facts,
 * not missing data. Averaging, minimising or maximising no rows is undefined —
 * there is nothing to average — and must stay null rather than be flattened to
 * a zero that reads as a real measurement.
 *
 * This distinction only surfaces for a measure the runtime evaluates per
 * GROUP: a measure-scoped filter can exclude every row of a group the grid
 * still lists, and a database reports that group by omitting the row entirely.
 * Treating that omission as "no data" reported "0 of 12 paid" as blank and
 * left any ratio built on it null (objectui#3136) — hiding the very number a
 * compliance dashboard exists to show.
 */
export function emptyGroupValueFor(aggregate: string | undefined): 0 | undefined {
  return aggregate === 'count' || aggregate === 'count_distinct' || aggregate === 'sum'
    ? 0
    : undefined;
}
