// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25818] Two shapes of an aggregate query that the engine's `aggregate`
 * answered with a plausible table under 200, now refused before any driver is
 * asked:
 *
 * 1. a `groupBy` entry that date-buckets (`{ field, dateGranularity }`) a field
 *    the object does not declare a date or datetime —
 *    {@link assertDateBucketTargetsAreTemporal};
 * 2. two columns of the aggregated row under one name: an aggregation alias
 *    used twice, an aggregation alias equal to a group column, or two group
 *    entries projecting one column — {@link assertAggregatedColumnsAreDistinct}.
 *
 * [#29167, #29304] …and, ahead of the first, a `groupBy` entry of any form —
 * a name, `{ field }`, or a bucket — naming a VIRTUAL field, which no driver
 * stores a column for — {@link assertGroupByTargetsAreStored}.
 *
 * ## What ran before this door, measured on `origin/main` `cb0a2fcf4f`
 *
 * Through `findData` (the `POST /api/v1/data/:object/query` door) over three
 * rows, `status` holding `open`, `open`, `won`:
 *
 * | query | answer |
 * |:--|:--|
 * | `groupBy: [{ field: 'name', dateGranularity: 'month' }]` (a `text` field) | `200 [{ name: null, n: 3 }]`: every row in one `null` bucket |
 * | `groupBy: [{ field: 'amount', dateGranularity: 'month' }]` (a `number` field) | `200 [{ amount: '1970-01', n: 3 }]`: the numbers read as epoch milliseconds |
 * | `groupBy: [{ field: 'at_time', dateGranularity: 'day' }]` (a `time` field) | `200 [{ at_time: null, n: 3 }]` |
 * | `aggregations: [{ count, alias: 'n' }, { sum amount, alias: 'n' }]` | `200 [{ n: 60 }]`: the count overwritten by the sum |
 * | `groupBy: ['status'], aggregations: [{ count, alias: 'status' }]` | `200 [{ status: 2 }, { status: 1 }]`: the group keys replaced by counts |
 * | `groupBy: [{ field: 'opened_on', dateGranularity: 'month' }, { field: 'opened_on', dateGranularity: 'year' }]` | `200 [{ opened_on: '2026', n: 1 }, { opened_on: '2026', n: 2 }]`: the month key overwritten by the year |
 *
 * The ingress door already refuses an unknown `groupBy` field, because an
 * unknown column "puts every row in ONE bucket keyed null"; these are that
 * hazard, and its overwrite twin, reached by a declared field.
 *
 * ## Where it stands
 *
 * At the entry of `engine.aggregate`, beside the structured-JSON group door and
 * the aggregate × field-type door, so it holds for every caller that reaches
 * the engine: the REST query door and its dispatcher twin (both through
 * `findData`), the analytics ObjectQL strategy, the MCP data bridge, a flow or
 * a hook. After those two doors, so a `json` field under a `dateGranularity`
 * keeps the structured-JSON refusal's words.
 *
 * ## What "a date field" is
 *
 * The declared type's class, read by `declaredFieldClasses` (having-filter.ts)
 * — the reading `in-memory-aggregation.ts` buckets a `date` field's calendar
 * day by. A `date` (`CALENDAR_DATE_TYPES`) and a `datetime` (`INSTANT_TYPES`)
 * pass. **Not judged:** a field the declaration cannot type — undeclared (the
 * ingress door answers an unknown one first; a system column the map does not
 * declare is bucketed as before), or a registry-less host.
 *
 * ## A virtual field (`formula`) is refused, on its storage ground [#29167, #29304]
 *
 * A `formula` names no stored value class (its value is the expression's), so
 * the class reading above cannot judge it. It is refused on the ground the
 * sort, filter, search and value-aggregate axes already refuse it on: it is
 * VIRTUAL — computed on read, no column — judged by the spec's
 * `isVirtualSearchField` (`SEARCH_VIRTUAL_TYPES`), never a local type list,
 * and whatever its `returnType` says. Measured on `origin/main` `7788eedb`
 * before the bucket arm (#29167), a month bucket over a `formula` with
 * `returnType: 'date'`, and on `origin/main` `447226b2` before the plain arm
 * (#29304), a plain group over a `formula` (`returnType` `date` or `text`):
 *
 * | caller | answer |
 * |:--|:--|
 * | a SQL driver | `INVALID_FIELD` / 400 from the driver's missing-column backstop: no `path`, and a "run schema sync" prescription that cannot help |
 * | a driver with no native `aggregate` (the in-memory aggregation) | `200`, one `null` group holding every row |
 *
 * Every `groupBy` entry is judged, whatever its form, by
 * {@link assertGroupByTargetsAreStored}, ahead of the date-bucket door: a
 * bucket answers {@link virtualDateBucketMessage} at
 * `groupBy.N.dateGranularity` (the #29167 words), a plain group answers
 * {@link virtualGroupMessage} at `groupBy.N` (a name) or `groupBy.N.field`
 * (the object form) — `INVALID_FIELD` / 400 either way, with the remedy those
 * axes give: store the value on a stored field and use that.
 * `@objectstack/service-analytics`'s `dataset-date-bucket-door.ts` gives the
 * same refusals on the faces that reach no engine (the `/analytics/sql` dry
 * run and the draft preview), and its native-SQL strategy declines a grouped
 * dimension over a virtual field, so that face reaches this door.
 *
 * ## The column names
 *
 * A group column is the entry's name, or `alias ?? field` for the object form
 * — the name `applyInMemoryAggregation` and `driver-sql` project it under. An
 * aggregation column is its `alias`. Entries that name nothing are left to the
 * shape gates that judge them.
 *
 * `INVALID_FIELD` for the date bucket (a verdict about the named field's type,
 * as the structured-JSON group door gives) and `INVALID_QUERY` for a column
 * collision (the query names one column twice; no field is wrong). Each
 * refusal carries `path`, the position it judged (`groupBy.0.dateGranularity`,
 * `aggregations.1.alias`).
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/25818
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { isVirtualSearchField } from '@objectstack/spec/data';
import { declaredFieldClasses } from './having-filter.js';

type ShapeRefusal = Error & {
  code?: string; status?: number; httpStatus?: number;
  field?: string; fields?: string[]; object?: string; param?: string; path?: string;
};

function refusal(
  code: 'INVALID_FIELD' | 'INVALID_QUERY',
  message: string,
  extra: Partial<ShapeRefusal>,
): ShapeRefusal {
  const err = new Error(message) as ShapeRefusal;
  err.code = StandardErrorCode.enum[code];
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a
  // consumer holding the THROWN error reads; `status` stays for the HTTP doors.
  err.httpStatus = 400;
  Object.assign(err, extra);
  return err;
}

/**
 * [#29167] The refusal of a date bucket over a VIRTUAL field (see the module
 * header): the position, the field, its type and the granularity it was
 * bucketed by, then the store-the-value remedy the sort and filter axes give.
 * `@objectstack/service-analytics`'s `dataset-date-bucket-door.ts` carries the
 * one copy, compared field for field by its tests.
 */
function virtualDateBucketMessage(
  object: string, path: string, field: string, type: string, dateGranularity: string,
): string {
  return `aggregate('${object}'): ${path} buckets '${field}' by '${dateGranularity}', but '${field}' `
    + `is a ${type} field — its value is computed on read and never stored, so no driver materialises a `
    + `column to bucket. The query was NOT run. Denormalise the value onto '${object}' (a stored date or `
    + 'datetime field, written when the source changes) and bucket that. A formula field is virtual: with '
    + 'no column behind it the bucket reached the driver as a column that does not exist, and an engine '
    + 'that aggregates in memory put every row into one null group while the answer looked served.';
}

/**
 * [#29304] The refusal of a plain group over a VIRTUAL field (see the module
 * header): {@link virtualDateBucketMessage}'s words for a group key with no
 * bucket. `@objectstack/service-analytics`'s `dataset-date-bucket-door.ts`
 * carries the one copy, compared field for field by its tests.
 */
function virtualGroupMessage(object: string, path: string, field: string, type: string): string {
  return `aggregate('${object}'): ${path} groups by '${field}', but '${field}' is a ${type} field — its value `
    + 'is computed on read and never stored, so no driver materialises a column to group by. The query was NOT '
    + `run. Denormalise the value onto '${object}' (a stored field, written when the source changes) and group `
    + 'by that. A formula field is virtual: with no column behind it the group key reached the driver as a '
    + 'column that does not exist, and an engine that aggregates in memory put every row into one null group '
    + 'while the answer looked served.';
}

/**
 * Refuse a `groupBy` entry of any form — a name, `{ field }`, or a
 * `{ field, dateGranularity }` bucket — naming a field the object declares
 * VIRTUAL (`formula`; the spec's `isVirtualSearchField`), `INVALID_FIELD` /
 * 400 at the position it names. See the module header.
 */
export function assertGroupByTargetsAreStored(
  object: string,
  schema: unknown,
  groupBy: unknown,
): void {
  if (!Array.isArray(groupBy) || groupBy.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
  for (const [i, entry] of groupBy.entries()) {
    const named = typeof entry === 'string';
    if (!named && (entry === null || typeof entry !== 'object' || Array.isArray(entry))) continue;
    const { field, dateGranularity } = named
      ? { field: entry, dateGranularity: undefined }
      : entry as { field?: unknown; dateGranularity?: unknown };
    if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const declared = (fields as Record<string, { type?: unknown }>)[field];
    if (!isVirtualSearchField(declared as never)) continue;
    const type = String(declared?.type);
    if (dateGranularity != null) {
      // [#29167] The bucket keeps its own words and position.
      const path = `groupBy.${i}.dateGranularity`;
      throw refusal(
        'INVALID_FIELD',
        virtualDateBucketMessage(object, path, field, type, String(dateGranularity)),
        { field, fields: [field], object, param: 'groupBy', path },
      );
    }
    const path = named ? `groupBy.${i}` : `groupBy.${i}.field`;
    throw refusal(
      'INVALID_FIELD',
      virtualGroupMessage(object, path, field, type),
      { field, fields: [field], object, param: 'groupBy', path },
    );
  }
}

/**
 * Refuse a `groupBy` entry whose `dateGranularity` buckets a field the object
 * declares neither a date nor a datetime — `INVALID_FIELD` / 400, naming the
 * position, the field and its declared type. A virtual field is judged ahead
 * of this door, by {@link assertGroupByTargetsAreStored}. See the module
 * header.
 */
export function assertDateBucketTargetsAreTemporal(
  object: string,
  schema: unknown,
  groupBy: unknown,
): void {
  if (!Array.isArray(groupBy) || groupBy.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
  let classes: ReturnType<typeof declaredFieldClasses> | undefined;
  for (const [i, entry] of groupBy.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { field, dateGranularity } = entry as { field?: unknown; dateGranularity?: unknown };
    if (dateGranularity == null || typeof field !== 'string') continue;
    const path = `groupBy.${i}.dateGranularity`;
    classes ??= declaredFieldClasses(fields);
    const cls = classes.get(field);
    if (cls === undefined || cls === 'date' || cls === 'datetime') continue;
    const type = String((fields as Record<string, { type?: unknown }>)[field]?.type);
    throw refusal(
      'INVALID_FIELD',
      `aggregate('${object}'): ${path} buckets '${field}' by '${String(dateGranularity)}', but '${field}' `
      + `is a declared ${type} field — only a date or datetime field can be date-bucketed. The query was `
      + `NOT run. Group by '${field}' without 'dateGranularity', or bucket a date or datetime field. A `
      + 'value that is not a date has no calendar position: every row fell into one null bucket (or, '
      + 'for a number, an epoch bucket) while the answer looked served.',
      { field, fields: [field], object, param: 'groupBy', path },
    );
  }
}

/** The column a `groupBy` entry projects: its name, or `alias ?? field`. */
function groupColumnOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const { alias, field } = entry as { alias?: unknown; field?: unknown };
  const name = alias ?? field;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** `groupBy.N` for a name, `groupBy.N.alias` / `groupBy.N.field` for the object form. */
function groupColumnPath(entry: unknown, i: number): string {
  if (typeof entry === 'string') return `groupBy.${i}`;
  return (entry as { alias?: unknown }).alias != null ? `groupBy.${i}.alias` : `groupBy.${i}.field`;
}

/**
 * Refuse a query whose aggregated row would carry two columns under one name —
 * `INVALID_QUERY` / 400, naming both positions. See the module header.
 */
export function assertAggregatedColumnsAreDistinct(
  object: string,
  groupBy: unknown,
  aggregations: unknown,
): void {
  const seen = new Map<string, string>();
  const claim = (column: string, path: string, param: 'groupBy' | 'aggregations', what: string) => {
    const first = seen.get(column);
    if (first === undefined) {
      seen.set(column, path);
      return;
    }
    throw refusal(
      'INVALID_QUERY',
      `aggregate('${object}'): ${path} names the column '${column}', which ${first} already names — `
      + `one row cannot carry two values under one column. The query was NOT run. ${what} A repeated `
      + 'column name kept only the last value written under it: a count overwritten by a sum, or the '
      + 'group keys replaced by the numbers, while the answer looked served.',
      { object, param, path, fields: [column] },
    );
  };
  for (const [i, entry] of (Array.isArray(groupBy) ? groupBy : []).entries()) {
    const column = groupColumnOf(entry);
    if (column === undefined) continue;
    claim(column, groupColumnPath(entry, i), 'groupBy',
      "Give one of the group entries its own 'alias'.");
  }
  for (const [i, entry] of (Array.isArray(aggregations) ? aggregations : []).entries()) {
    const alias = (entry as { alias?: unknown } | null)?.alias;
    if (typeof alias !== 'string' || alias.length === 0) continue;
    claim(alias, `aggregations.${i}.alias`, 'aggregations',
      "Give each aggregation an 'alias' of its own, distinct from every group column.");
  }
}
