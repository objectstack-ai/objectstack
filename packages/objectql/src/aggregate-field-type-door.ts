// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine's `aggregate` asks the aggregate × field-type table for every
 * aggregation that names a declared field: a pair the table refuses is
 * refused with `INVALID_FIELD` / 400, naming the field, its declared type, the
 * function and the position, before any driver is asked.
 *
 * ## What ran before this door
 *
 * [#20808] measured `count_distinct` on `origin/main` `42d78b97fe`, through
 * `POST /api/v1/data/:object/query` (`{ aggregations: [{ function:
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
 * [#20914] measured the other rows on `origin/main` `dfe5a0863` through
 * `engine.aggregate` over two rows — the door the REST query route, a flow, a
 * hook and the analytics ObjectQL strategy all reach:
 *
 * | aggregation | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `max` / `min` over a `json` field | 200, a document (`{ a: 1 }`) | 200, a string (`'{"b":1}'`) | **500 `DATABASE_ERROR`** (`function max(json) does not exist`) |
 * | `max` / `min` over a `tags` field, or a `select` with `multiple: true` | 200, an array | 200, a serialized array | **500 `DATABASE_ERROR`** |
 * | `avg` over a `tags` field | 200, `null` | 200, `0` | **500 `DATABASE_ERROR`** |
 * | `avg` over a `datetime` field | 200, `null` | 200, `2026` | **500 `DATABASE_ERROR`** |
 * | `max` over a `number`, `min` over a `datetime`, `avg` over a `percent` (the controls) | one answer | the same | the same |
 *
 * ## Whose verdict it is
 *
 * The TYPE half is the spec table's: `AGGREGATE_FIELD_TYPE_COMPATIBILITY`
 * (`@objectstack/spec/data`), asked through `isAggregateCompatibleWithFieldType`
 * for the aggregation's own function — ⛔ never a second list here. The table
 * is ruled (its module TSDoc carries the rulings, the string-class `min` /
 * `max` rows included); this door applies it as it stands and re-rules
 * nothing. The refusal names the row's accepted set, read off the table.
 *
 * The DECLARATION half is `isMultiValueField`: a multi-capable type flagged
 * `multiple: true` (`select`, `lookup`, `user`, `file`, `image`) is stored in
 * the JSON column the multi-option types (`MULTI_OPTION_TYPES`) are stored in
 * and holds the same value — a list — but a per-TYPE table cannot see the
 * flag. So the declaration takes the verdict the row gives that class: a row
 * that refuses any multi-option type refuses a multi-value declaration too
 * (`count_distinct`, `sum`, `avg`, `min`, `max`), and a row that accepts the
 * whole class accepts it (`count`, which compares no value). A field is
 * refused if either half refuses it.
 *
 * ## The row the census held back: `sum`
 *
 * [#20914] The triage direction sent the door to the whole table "census
 * first": an authored pair the table refuses, in `examples/**` or a published
 * stack, stops that row and goes back to triage. The census found one, in the
 * published hotcrm stack: a grouped list view whose column summary sums a
 * `formula` field (`sum` × `formula`, refused by the table — a formula is
 * virtual in SQL storage). So `sum` is in {@link ROWS_HELD_FOR_TRIAGE} and is
 * not judged here; releasing it is deleting that entry and flipping its pins.
 * Every other row is judged.
 *
 * ## Where it stands, and what it judges
 *
 * At the entry of `aggregate`, right after the `groupBy` door
 * (`group-by-structured-json-door.ts`, which answers a different question —
 * a group KEY, not a function's operand — and stays beside this one), before
 * the per-aggregation `filter` doors and before any driver is resolved — so it
 * holds for every caller that reaches the engine: the REST query door, a flow,
 * a hook, a roll-up summary's recompute, and the analytics strategy that
 * lowers a cube measure onto `engine.aggregate`.
 *
 * **Not judged** (no verdict, the aggregation passes on as it came): an
 * aggregation that names no field (a fieldless `count`, or `'*'`), a function
 * outside the table's vocabulary (that is the query schema's refusal, not a
 * field-type one), a held row, an undeclared name (a relationship path
 * included), a registry-less host (no field map, no verdict), and a declared
 * type outside `FieldType` (a driver-internal alias such as `string` or
 * `integer` on an introspected object): the table is fail-closed on
 * vocabulary, and "cannot answer, do not block" is this consumer's tier, as
 * the table's own TSDoc says.
 *
 * `INVALID_FIELD`, the code the `groupBy` door beside it answers: the verdict
 * is about the NAMED field's type at a position.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20808
 * @see https://github.com/objectstack-ai/objectstack/issues/20914
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  FieldType,
  MULTI_OPTION_TYPES,
  STRUCTURED_JSON_TYPES,
  isAggregateCompatibleWithFieldType,
  isMultiValueField,
  type AggregationFunction,
} from '@objectstack/spec/data';

/** The declared `FieldType` vocabulary — the only types the table can answer for. */
const DECLARED_FIELD_TYPES: ReadonlySet<string> = new Set(FieldType.options);

/**
 * Rows of the table this door does not judge yet, each held by the census
 * that preceded it — see the module header. ⛔ A row is held, never trimmed:
 * the door asks the table's row whole or not at all.
 */
const ROWS_HELD_FOR_TRIAGE: ReadonlySet<string> = new Set(['sum']);

/** Does the table's `fn` row accept the multi-value class — every multi-option type? */
function rowAcceptsMultiValue(fn: string): boolean {
  for (const type of MULTI_OPTION_TYPES) {
    if (!isAggregateCompatibleWithFieldType(fn, type)) return false;
  }
  return true;
}

/** One aggregation the table (or the declaration half) refuses. */
interface RefusedAggregation {
  /** The aggregation's function — a row of the table. */
  readonly fn: string;
  readonly field: string;
  readonly type: string;
  /** The declared field carries `multiple: true` (said in the words). */
  readonly multiple: boolean;
  /** A multi-value field (the route differs for `count_distinct`: filter by one member). */
  readonly multiValue: boolean;
  /** A structured-JSON type (`STRUCTURED_JSON_TYPES`). */
  readonly structuredJson: boolean;
  /** `aggregations[i].field`. */
  readonly position: string;
}

/**
 * The aggregations that name a declared field the table refuses for their
 * function, or a declared multi-value field the row refuses, in order.
 */
function refusedAggregations(
  fields: Record<string, unknown>,
  aggregations: readonly unknown[],
): RefusedAggregation[] {
  const hits: RefusedAggregation[] = [];
  for (const [i, agg] of aggregations.entries()) {
    if (agg === null || typeof agg !== 'object' || Array.isArray(agg)) continue;
    const fn = (agg as { function?: unknown }).function;
    if (typeof fn !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(AGGREGATE_FIELD_TYPE_COMPATIBILITY, fn)) continue;
    if (ROWS_HELD_FOR_TRIAGE.has(fn)) continue;
    const field = (agg as { field?: unknown }).field;
    if (typeof field !== 'string' || field === '*') continue;
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const def = fields[field] as { type?: unknown; multiple?: unknown } | undefined;
    const type = def?.type;
    if (typeof type !== 'string' || !DECLARED_FIELD_TYPES.has(type)) continue;
    const multiple = def?.multiple === true;
    const multiValue = isMultiValueField({ type, multiple });
    const typeRefused = !isAggregateCompatibleWithFieldType(fn, type);
    const declarationRefused = multiValue && !rowAcceptsMultiValue(fn);
    if (!typeRefused && !declarationRefused) continue;
    hits.push({
      fn,
      field,
      type,
      multiple,
      multiValue,
      structuredJson: STRUCTURED_JSON_TYPES.has(type),
      position: `aggregations[${i}].field`,
    });
  }
  return hits;
}

/**
 * What each function does to its field, and its negation, in the refusal's
 * words — total over `AggregationFunction`, so a function joining the table is
 * a `tsc` error here until its words are written. (`count` accepts every type,
 * so it never reaches the words; it is here for totality.)
 */
const FUNCTION_WORDS: Readonly<Record<AggregationFunction, { readonly does: string; readonly doesNot: string }>> = {
  count: { does: 'counts', doesNot: 'does not count' },
  count_distinct: { does: 'counts distinct', doesNot: 'does not count distinct' },
  sum: { does: 'sums', doesNot: 'does not sum' },
  avg: { does: 'averages', doesNot: 'does not average' },
  min: { does: 'takes the min of', doesNot: 'does not take the min of' },
  max: { does: 'takes the max of', doesNot: 'does not take the max of' },
};

/** `a, b or c` — the row's accepted types, in the table's order. */
function acceptedTypesOf(fn: string): string {
  const row: readonly string[] = AGGREGATE_FIELD_TYPE_COMPATIBILITY[fn as AggregationFunction];
  return row.length > 1 ? `${row.slice(0, -1).join(', ')} or ${row[row.length - 1]}` : row.join('');
}

/**
 * The route and the reason for the FIRST refused aggregation. The route comes
 * before the reason so it lands inside the 500 characters the REST door keeps.
 */
function routeAndReason(first: RefusedAggregation): string {
  if (first.fn === 'count_distinct') {
    const route = first.multiValue
      ? 'Count the records that hold one member instead: count with '
        + `where { "${first.field}": { "$contains": VALUE } }, one query per member.`
      : 'Count distinct values of a field that stores one scalar value: store the part you count in a '
        + 'field of its own and count_distinct that field, or count the rows with count.';
    return `${route} `
      + 'A JSON-stored value is no distinct key the drivers share: one counted every row apart, one '
      + 'compared the serialized text, one refused the statement.';
  }
  const route = `${first.fn} accepts a field of type ${acceptedTypesOf(first.fn)}: aggregate a field `
    + 'of one of those types, or count the rows with count.';
  const reason = first.multiValue || first.structuredJson
    ? 'A JSON-stored value has no order or arithmetic the drivers share: one answered from the '
      + 'documents in memory, one from their serialized text, one refused the statement.'
    : 'The aggregate × field-type table accepts only the pairs every backend answers alike, and it '
      + 'refuses this one.';
  return `${route} ${reason}`;
}

/**
 * Refuse an aggregation whose (function, declared field type) pair the
 * aggregate × field-type table refuses — `INVALID_FIELD` / 400, before any
 * driver is asked. See the module header.
 *
 * The words put the position and the verdict first, then that the query did
 * not run, then the route, then the reason: the REST door keeps the first 500
 * characters of a 4xx message (`CLIENT_MESSAGE_MAX`), and the route must be
 * inside them.
 */
export function assertAggregationFieldTypesAccepted(
  object: string,
  schema: unknown,
  aggregations: unknown,
): void {
  if (!Array.isArray(aggregations) || aggregations.length === 0) return;
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  const hits = refusedAggregations(fields as Record<string, unknown>, aggregations);
  if (hits.length === 0) return;
  const [first] = hits;
  const words = FUNCTION_WORDS[first.fn as AggregationFunction];
  const declared = first.multiple ? `${first.type} field with multiple: true` : `${first.type} field`;
  const kind = first.multiValue
    ? ' — a multi-value field'
    : first.structuredJson ? ' — a structured-JSON value' : '';
  const err = new Error(
    `aggregate('${object}'): ${first.position} ${words.does} '${first.field}', a declared ${declared}`
    + `${kind}, which the engine ${words.doesNot}`
    + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.field}'`).join(', ')})` : '')
    + `. The query was NOT run. ${routeAndReason(first)}`,
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
