// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cross-object dimension re-bucketing (#3654 capability).
 *
 * `engine.aggregate()` cannot join, so the ObjectQL path cannot group directly
 * by a related object's attribute (`account.region`). Instead the strategy:
 *   1. groups the base aggregate by the LOOKUP FK column (`account`), which the
 *      engine CAN do (it is a plain base column), and
 *   2. resolves each FK id to the related attribute (`region`) with a SCOPED
 *      read of the referenced object, then
 *   3. re-buckets the base aggregate by that attribute here, in memory,
 *      recombining the measures.
 *
 * This module is the pure, deterministic step (3): given the base rows, the
 * FK→attribute maps, and the measures' aggregation methods, produce the rows a
 * direct cross-object grouping would have. It is unit-tested in isolation
 * because a wrong re-combination silently corrupts totals — exactly the class of
 * bug #3654 exists to kill.
 *
 * A base row whose FK does not resolve (the referenced record is hidden by the
 * referenced object's own RLS) buckets under {@link RESTRICTED_BUCKET}: its
 * measure still counts, so grand totals are preserved, but the hidden record's
 * attribute value never appears (no leak — ADR-0021 D-C, the #3602 class).
 */

/** Only aggregation methods that re-combine across sub-buckets are supported. */
export type RecombinableMethod = 'sum' | 'count' | 'min' | 'max';

export const RECOMBINABLE_METHODS: ReadonlySet<string> = new Set<RecombinableMethod>([
  'sum',
  'count',
  'min',
  'max',
]);

/** Sentinel bucket for base rows whose referenced record the caller cannot read. */
export const RESTRICTED_BUCKET = '(restricted)';

export interface CrossObjectDim {
  /** Output key for the resolved attribute (the original dimension name), e.g. `region`. */
  outputName: string;
  /** The base FK column the base aggregate was grouped by, e.g. `account`. */
  fkField: string;
  /** `fkValue → attributeValue`. An FK absent from the map buckets as RESTRICTED. */
  fkToAttr: Map<unknown, unknown>;
}

export interface MeasureRecombine {
  /** The measure's output key in each base row. */
  alias: string;
  method: RecombinableMethod;
}

/**
 * Order two measure values. A number orders as itself; a `Date` or an ISO
 * timestamp orders as its instant, so a `min`/`max` over a temporal measure
 * compares correctly instead of collapsing to `NaN` (#3797). `NaN` means "not
 * orderable" and the caller keeps the other side.
 */
function orderableValue(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return Date.parse(String(v));
}

/**
 * Combine two measure values under an aggregation method (either may be
 * undefined).
 *
 * `sum`/`count` are numeric by construction and stay so. `min`/`max` return the
 * winning ORIGINAL value rather than a number: the value they pick is a value
 * OF the column, so a temporal measure has to come back out in the same shape
 * the driver presented it (#3797) — coercing it to a number here would put the
 * epoch leak back one layer up, and on any dialect whose driver returns an ISO
 * string it would produce `NaN` outright.
 */
function recombine(method: RecombinableMethod, acc: unknown, next: unknown): unknown {
  if (method === 'min' || method === 'max') {
    if (acc === undefined) return next ?? 0;
    const a = orderableValue(acc);
    const n = orderableValue(next);
    if (Number.isNaN(n)) return acc;
    if (Number.isNaN(a)) return next;
    const nextWins = method === 'min' ? n < a : n > a;
    return nextWins ? next : acc;
  }
  const n = Number(next ?? 0);
  return acc === undefined ? n : Number(acc) + n;
}

/**
 * Re-bucket base aggregate rows by resolved cross-object attributes.
 *
 * @param baseRows        rows grouped by `baseDimFields` + every `crossDims[*].fkField`.
 * @param baseDimFields   the NON-cross-object group keys carried through unchanged
 *                        (base columns and date buckets), keyed as in `baseRows`.
 * @param crossDims       one entry per cross-object dimension (its FK→attr map).
 * @param measures        measure keys + their (recombinable) aggregation method.
 * @returns rows keyed by `baseDimFields` + each `crossDims[*].outputName` + measures.
 */
export function rebucketCrossObject(
  baseRows: Record<string, unknown>[],
  baseDimFields: string[],
  crossDims: CrossObjectDim[],
  measures: MeasureRecombine[],
): Record<string, unknown>[] {
  const buckets = new Map<string, Record<string, unknown>>();

  for (const row of baseRows) {
    // Resolve each cross-object FK to its attribute (or RESTRICTED).
    const resolved: Record<string, unknown> = {};
    for (const cd of crossDims) {
      const fk = row[cd.fkField];
      resolved[cd.outputName] = cd.fkToAttr.has(fk) ? cd.fkToAttr.get(fk) : RESTRICTED_BUCKET;
    }

    // Bucket key = base dims (unchanged) + resolved attributes. `` is a
    // separator no group value contains, matching the engine's own convention.
    const keyParts: string[] = [];
    for (const f of baseDimFields) keyParts.push(`${f}=${String(row[f] ?? '(null)')}`);
    for (const cd of crossDims) keyParts.push(`${cd.outputName}=${String(resolved[cd.outputName])}`);
    const key = keyParts.join('');

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {};
      for (const f of baseDimFields) bucket[f] = row[f];
      for (const cd of crossDims) bucket[cd.outputName] = resolved[cd.outputName];
      buckets.set(key, bucket);
    }
    for (const m of measures) {
      bucket[m.alias] = recombine(m.method, bucket[m.alias], row[m.alias]);
    }
  }

  return [...buckets.values()];
}
