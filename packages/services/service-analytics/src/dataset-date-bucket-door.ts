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
 * with no declared type is not judged, as there.
 *
 * [#29167] A VIRTUAL field (`formula`, the spec's `isVirtualSearchField` /
 * `SEARCH_VIRTUAL_TYPES`) is refused first, as the engine's door now refuses
 * it: computed on read, no column to bucket, whatever its `returnType` says.
 * Measured on `origin/main` `7788eedb` before this arm, a month bucket over a
 * `formula` with `returnType: 'date'`: the dry run rendered
 * `strftime('%Y-%m', calc)` and the preview served one `null` group holding
 * the total, while the live faces refused it from the SQL driver's
 * missing-column backstop. All three now answer the engine's
 * `INVALID_FIELD` / 400 at `groupBy.N.dateGranularity`, field for field.
 *
 * [#29364] …and a third face that hands no engine the keys: the delegated
 * fallback service behind `FallbackDelegateStrategy`, which folds a bucket in
 * memory and read no field type. It is judged with the keys the strategy's
 * direct path would build and the strategy context's `declaredFieldType`, on
 * both its query and its dry run (`analytics-service.ts`,
 * `assertDelegatedDateBucketsTemporal`).
 *
 * [#29304] …and a PLAIN group key over a virtual field, which the engine's
 * storage-axis door (`assertGroupByTargetsAreStored`) now refuses ahead of its
 * date-bucket door, `INVALID_FIELD` / 400 at `groupBy.N`. Measured on
 * `origin/main` `447226b2` before it, a dataset or cube dimension over a
 * `formula` (`returnType` `date` or `text`): the dry run rendered
 * `GROUP BY calc` on both compositions and the preview served one `null`
 * group holding the total, while the native strategy answered
 * `DATABASE_ERROR` / 500 and the ObjectQL strategy the SQL driver's
 * missing-column backstop. {@link assertDatasetGroupTargetsStored} gives the
 * engine's refusal on the faces that hand it no keys (the preview, the dry
 * run, the delegated service), and `NativeSQLStrategy.canHandle` declines a
 * grouped dimension over a virtual field so the live query reaches the engine.
 *
 * Why a copy of the sentence: `@objectstack/objectql` is a dev dependency of
 * this package, never a runtime one, and its root does not export the door.
 * The message, code, status and keys are the engine's, and
 * `preview-date-bucket-type.test.ts` and `objectql-echo-non-date-bucket.test.ts`
 * compare each face's refusal with the query's field for field, so a change to
 * the engine's wording reds them.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { CALENDAR_DATE_TYPES, INSTANT_TYPES, isVirtualSearchField } from '@objectstack/spec/data';
import type { AggregateGroupKey } from './strategies/objectql-strategy.js';

type DateBucketRefusal = Error & {
  code?: string; status?: number; httpStatus?: number;
  field?: string; fields?: string[]; object?: string; param?: string; path?: string;
};

/** The refusal this module's two doors throw, with the engine's keys. */
function dateBucketRefusal(message: string, object: string, field: string, path: string): DateBucketRefusal {
  const err = new Error(message) as DateBucketRefusal;
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  err.httpStatus = 400;
  Object.assign(err, { field, fields: [field], object, param: 'groupBy', path });
  return err;
}

/**
 * [#29167, #29304] Refuse the first key in `groupBy` (built for a query on
 * `object`), plain or bucketed, whose field `declaredType` reads as a VIRTUAL
 * field (the spec's `isVirtualSearchField`), with the engine's refusal for it:
 * `aggregate-query-shape-door.ts` `assertGroupByTargetsAreStored`, the bucket
 * in `virtualDateBucketMessage`'s words, the plain key in
 * `virtualGroupMessage`'s. Called ahead of
 * {@link assertDatasetDateBucketsTemporal}, as the engine calls its two doors.
 */
export function assertDatasetGroupTargetsStored(
  object: string,
  groupBy: readonly AggregateGroupKey[],
  declaredType: (field: string) => string | undefined,
): void {
  for (const [i, key] of groupBy.entries()) {
    const field = typeof key === 'string' ? key : key.field;
    const type = declaredType(field);
    if (type === undefined || !isVirtualSearchField({ type } as never)) continue;
    if (typeof key !== 'string') {
      const path = `groupBy.${i}.dateGranularity`;
      throw dateBucketRefusal(
        `aggregate('${object}'): ${path} buckets '${field}' by '${key.dateGranularity}', but '${field}' `
        + `is a ${type} field — its value is computed on read and never stored, so no driver materialises a `
        + `column to bucket. The query was NOT run. Denormalise the value onto '${object}' (a stored date or `
        + 'datetime field, written when the source changes) and bucket that. A formula field is virtual: with '
        + 'no column behind it the bucket reached the driver as a column that does not exist, and an engine '
        + 'that aggregates in memory put every row into one null group while the answer looked served.',
        object, field, path,
      );
    }
    const path = `groupBy.${i}`;
    throw dateBucketRefusal(
      `aggregate('${object}'): ${path} groups by '${field}', but '${field}' is a ${type} field — its value `
      + 'is computed on read and never stored, so no driver materialises a column to group by. The query was NOT '
      + `run. Denormalise the value onto '${object}' (a stored field, written when the source changes) and group `
      + 'by that. A formula field is virtual: with no column behind it the group key reached the driver as a '
      + 'column that does not exist, and an engine that aggregates in memory put every row into one null group '
      + 'while the answer looked served.',
      object, field, path,
    );
  }
}

/**
 * Refuse the first bucketed key in `groupBy` (built for a query on `object`)
 * whose field `declaredType` reads as declared and neither a date nor a
 * datetime, with the engine's refusal for it. A virtual field is judged ahead
 * of this door, by {@link assertDatasetGroupTargetsStored}.
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
    const path = `groupBy.${i}.dateGranularity`;
    if (type === undefined || CALENDAR_DATE_TYPES.has(type) || INSTANT_TYPES.has(type)) continue;
    throw dateBucketRefusal(
      `aggregate('${object}'): ${path} buckets '${field}' by '${dateGranularity}', but '${field}' `
      + `is a declared ${type} field — only a date or datetime field can be date-bucketed. The query was `
      + `NOT run. Group by '${field}' without 'dateGranularity', or bucket a date or datetime field. A `
      + 'value that is not a date has no calendar position: every row fell into one null bucket (or, '
      + 'for a number, an epoch bucket) while the answer looked served.',
      object, field, path,
    );
  }
}
