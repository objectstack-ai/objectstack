// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20808] A `count_distinct` aggregation over a JSON-STORED field is refused
 * with `INVALID_FIELD` / 400 by the engine's `aggregate`, naming the field,
 * its declared type and the position, before any driver is asked.
 *
 * ## What ran before this door, measured on `origin/main` `42d78b97fe`
 *
 * Through `POST /api/v1/data/:object/query` (`{ aggregations: [{ function:
 * 'count_distinct', field: FIELD, alias: 'n' }] }`) over three rows, two of
 * which hold equal values under the counted field:
 *
 * | counted field | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | a `text` or single-value `select` (the control) | 2 | 2 | 2 |
 * | a structured-JSON field (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`) | 3 | 2 (3 for `json`, whose three documents differ) | **500 `DATABASE_ERROR`** |
 * | a multi-value field (`multiselect`, `checkboxes`, `tags`; `select`, `lookup`, `user`, `file`, `image` with `multiple: true`) | 3 | 2 | **500 `DATABASE_ERROR`** |
 *
 * The in-memory driver compares each row's value by identity, so equal
 * documents count apart; SQLite compares the serialized text; PostgreSQL has
 * no equality operator for a `json` column ("could not identify an equality
 * operator for type json") and answers 500. One query, three answers.
 *
 * ## Whose verdict it is
 *
 * The TYPE half is the spec table's: `AGGREGATE_FIELD_TYPE_COMPATIBILITY`'s
 * `count_distinct` row, asked through `isAggregateCompatibleWithFieldType`
 * (`@objectstack/spec/data`) — ⛔ never a second list here. The triage
 * direction on #20808: the table "stops accepting it" for the structured-JSON
 * class, on the table's own ground ("can every backend give one answer"); the
 * row refuses the three multi-option types too, on the same measurement.
 *
 * The DECLARATION half is `isMultiValueField`: a multi-capable type flagged
 * `multiple: true` (`select`, `lookup`, `user`, `file`, `image`) is stored in
 * a JSON column like the rest, but a per-TYPE table cannot see the flag. The
 * two answers are asked side by side, so a field is refused if either one
 * refuses it.
 *
 * ⛔ No per-backend JSON distinctness is defined to make the pair answerable:
 * no caller of it was measured (no dataset measure, widget or `count_distinct`
 * in `examples/` or the published hotcrm stack counts one).
 *
 * ## Where it stands, and what it judges
 *
 * At the entry of `aggregate`, right after the `groupBy` door
 * (`group-by-structured-json-door.ts`), before the per-aggregation `filter`
 * doors and before any driver is resolved — so it holds for every caller that
 * reaches the engine: the REST query door, a flow, a hook, and the analytics
 * strategy that lowers a cube measure onto `engine.aggregate`.
 *
 * **Not judged:** any other aggregate function (`count` compares no value; the
 * table's other rows have their own doors and are not this card's), a
 * `count_distinct` with no named field, an undeclared name, a registry-less
 * host (no field map, no verdict), and a declared type outside `FieldType`
 * (a driver-internal alias such as `string` or `integer` on an introspected
 * object): the table is fail-closed on vocabulary, and "cannot answer, do not
 * block" is this consumer's tier, as the table's own TSDoc says.
 *
 * `INVALID_FIELD`, the code the `groupBy` door beside it answers: the verdict
 * is about the NAMED field's type at a position.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20808
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { FieldType, isAggregateCompatibleWithFieldType, isMultiValueField } from '@objectstack/spec/data';

/** The declared `FieldType` vocabulary — the only types the table can answer for. */
const DECLARED_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/** One `count_distinct` aggregation that names a JSON-stored field. */
interface JsonStoredDistinctTarget {
  readonly field: string;
  readonly type: string;
  /** The declared field carries `multiple: true` (said in the words). */
  readonly multiple: boolean;
  /** A multi-value field (the route differs: filter by one member). */
  readonly multiValue: boolean;
  /** `aggregations[i].field`. */
  readonly position: string;
}

/**
 * The `count_distinct` aggregations that name a declared field the table's
 * `count_distinct` row refuses, or a declared multi-value field, in order.
 */
function jsonStoredDistinctTargets(
  fields: Record<string, unknown>,
  aggregations: readonly unknown[],
): JsonStoredDistinctTarget[] {
  const hits: JsonStoredDistinctTarget[] = [];
  for (const [i, agg] of aggregations.entries()) {
    if (agg === null || typeof agg !== 'object' || Array.isArray(agg)) continue;
    if ((agg as { function?: unknown }).function !== 'count_distinct') continue;
    const field = (agg as { field?: unknown }).field;
    if (typeof field !== 'string' || field === '*') continue;
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const def = fields[field] as { type?: unknown; multiple?: unknown } | undefined;
    const type = def?.type;
    if (typeof type !== 'string' || !DECLARED_FIELD_TYPES.has(type)) continue;
    const multiple = def?.multiple === true;
    const multiValue = isMultiValueField({ type, multiple });
    if (isAggregateCompatibleWithFieldType('count_distinct', type) && !multiValue) continue;
    hits.push({ field, type, multiple, multiValue, position: `aggregations[${i}].field` });
  }
  return hits;
}

/**
 * Refuse a `count_distinct` aggregation over a declared JSON-stored field —
 * `INVALID_FIELD` / 400, before any driver is asked. See the module header.
 *
 * The words put the position and the verdict first, then that the query did
 * not run, then the route, then the reason: the REST door keeps the first 500
 * characters of a 4xx message (`CLIENT_MESSAGE_MAX`), and the route must be
 * inside them.
 */
export function assertCountDistinctNamesNoJsonStoredField(
  object: string,
  schema: unknown,
  aggregations: unknown,
): void {
  if (!Array.isArray(aggregations) || aggregations.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const hits = jsonStoredDistinctTargets(fields as Record<string, unknown>, aggregations);
  if (hits.length === 0) return;
  const [first] = hits;
  const declared = first.multiple ? `${first.type} field with multiple: true` : `${first.type} field`;
  const kind = first.multiValue ? 'a multi-value field' : 'a structured-JSON value';
  const route = first.multiValue
    ? 'Count the records that hold one member instead: count with '
      + `where { "${first.field}": { "$contains": VALUE } }, one query per member.`
    : 'Count distinct values of a field that stores one scalar value: store the part you count in a '
      + 'field of its own and count_distinct that field, or count the rows with count.';
  const err = new Error(
    `aggregate('${object}'): ${first.position} counts distinct '${first.field}', a declared ${declared} `
    + `— ${kind}, which the engine does not count distinct`
    + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '')
    + `. The query was NOT run. ${route} `
    + 'A JSON-stored value is no distinct key the drivers share: one counted every row apart, one '
    + 'compared the serialized text, one refused the statement.',
  ) as Error & {
    code?: string; status?: number; httpStatus?: number;
    field?: string; fields?: string[]; object?: string; param?: string;
  };
  err.code = StandardErrorCode.enum.INVALID_FIELD;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a
  // consumer holding the THROWN error reads; `status` stays for the HTTP doors.
  err.httpStatus = 400;
  err.field = first.field;
  err.fields = hits.map((h) => h.field);
  err.object = object;
  err.param = 'aggregations';
  throw err;
}
