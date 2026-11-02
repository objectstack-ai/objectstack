// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28852, #28977] The analytics service's one refusal of a date bucket over a
 * column that is not a date or a datetime, for the two faces that hand no
 * engine the keys: the draft preview and the `/analytics/sql` dry run.
 *
 * Both live faces hand `engine.aggregate` the keys the ObjectQL strategy
 * builds (native declines every bucketed time dimension to it), and the engine
 * refuses a `{ field, dateGranularity }` key over a field declared anything
 * else: `@objectstack/objectql`'s `assertDateBucketTargetsAreTemporal`
 * (`aggregate-query-shape-door.ts`), `INVALID_FIELD` / 400 at
 * `groupBy.N.dateGranularity`.
 *
 * - The preview evaluates drafted rows in memory, so it served the bucket: one
 *   `null` group for a text, select or boolean column, a `1970` group for a
 *   number (#28852). It judges the keys the strategy's direct path would build
 *   (`aggregateGroupKeys`, so the positions are the engine's), with the
 *   service's `sourceFieldMeta` as the reader.
 * - The dry run renders the statement and runs nothing, so it printed
 *   `strftime('%Y-%m', region)` for a statement the query refuses (#28977). It
 *   judges the keys `execute()` would hand the engine (its cross-object
 *   path's when the selection routes there), with the strategy context's
 *   `declaredFieldType`, which the service answers from the same hook.
 *
 * The reading is the engine's: the field's declared type, classed by the
 * spec's value-class sets the engine's `classOfDeclaredType` reads. A field
 * with no declared type, or a `formula`, is not judged, as there.
 *
 * Why a copy of the sentence: `@objectstack/objectql` is a dev dependency of
 * this package, never a runtime one, and its root does not export the door.
 * The message, code, status and keys are the engine's, and
 * `preview-date-bucket-type.test.ts` and `objectql-echo-non-date-bucket.test.ts`
 * compare each face's refusal with the query's field for field, so a change to
 * the engine's wording reds them.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { CALENDAR_DATE_TYPES, INSTANT_TYPES } from '@objectstack/spec/data';
import type { AggregateGroupKey } from './strategies/objectql-strategy.js';

type DateBucketRefusal = Error & {
  code?: string; status?: number; httpStatus?: number;
  field?: string; fields?: string[]; object?: string; param?: string; path?: string;
};

/**
 * Refuse the first bucketed key in `groupBy` (built for a query on `object`)
 * whose field `declaredType` reads as declared, not a `formula`, and neither a
 * date nor a datetime, with the engine's refusal for it.
 */
export function assertDatasetDateBucketsTemporal(
  object: string,
  groupBy: readonly AggregateGroupKey[],
  declaredType: (field: string) => string | undefined,
): void {
  for (const [i, key] of groupBy.entries()) {
    if (typeof key === 'string') continue;
    const { field, dateGranularity } = key;
    const type = declaredType(field);
    if (type === undefined || type === 'formula' || CALENDAR_DATE_TYPES.has(type) || INSTANT_TYPES.has(type)) continue;
    const path = `groupBy.${i}.dateGranularity`;
    const err = new Error(
      `aggregate('${object}'): ${path} buckets '${field}' by '${dateGranularity}', but '${field}' `
      + `is a declared ${type} field — only a date or datetime field can be date-bucketed. The query was `
      + `NOT run. Group by '${field}' without 'dateGranularity', or bucket a date or datetime field. A `
      + 'value that is not a date has no calendar position: every row fell into one null bucket (or, '
      + 'for a number, an epoch bucket) while the answer looked served.',
    ) as DateBucketRefusal;
    err.code = StandardErrorCode.enum.INVALID_FIELD;
    err.status = 400;
    err.httpStatus = 400;
    Object.assign(err, { field, fields: [field], object, param: 'groupBy', path });
    throw err;
  }
}
