// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20546] The NO-OPERATOR-OBJECT arm: a plain object with no `$`-operator key
 * written where a scalar field's value belongs — `{ amount: { a: 1 } }` over a
 * declared `number` field — is refused with `INVALID_FILTER` / 400, naming the
 * field and the path, at every position the engine judges.
 *
 * ## ⛔ Not a door of its own: an ARM of the number-comparand door's walk
 *
 * This module holds the arm's three parts — which columns it judges, what it
 * refuses, and the words — and nothing that walks a filter. The walk is
 * `number-comparand-declared-type-door.ts`'s `walkCondition`, the one filter
 * walk the engine runs at all three filter positions with the column's
 * declaration in hand (`where` in both spellings, `aggregations[i].filter`,
 * and `having`). Triage directed it there: "If the same walk is the natural
 * site, it lands serially after that PR, in the same walk. ⛔ No second
 * traversal of the filter." That walk already stood on the exact branch — a
 * field spec with no `$` key — and stepped past it for the numeric fields it
 * judges; it now asks this module about every declared field before the number
 * arm runs.
 *
 * ## What ran before this arm, measured on `origin/main` `fbec216e2d`
 *
 * Three rows, through `engine.find` / `engine.aggregate` and
 * `POST /api/v1/data/:object/query` (both doors answered alike):
 *
 * | position · filter | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `where` `{ amount: { a: 1 } }` (number), `{ title: { a: 1 } }` (text), and the select, boolean, date, autonumber, multi-select, `multiple: true` select twins | 200, no rows | 400 `INVALID_FILTER`, the driver's words | same as SQLite |
 * | `where` `{ $not: { amount: { a: 1 } } }` | 200, **every row** | 400, the driver's words | same |
 * | `aggregations[1].filter` `{ amount: { a: 1 } }` | 200, count 0 | 200, count 0 | 200, count 0 |
 * | `having` `{ total: { a: 1 } }` (a `sum`), `{ title: { a: 1 } }` (a groupBy) | 200, no group | 200, no group | 200, no group |
 *
 * One mistake, two answers at `where`, decided by the driver; a silent empty
 * at the two positions the engine evaluates itself.
 *
 * ## Which columns it judges — a closed definition, from the spec's classes
 *
 * A column is judged when its declared type stores SCALAR values: one scalar
 * ({@link SCALAR_FILTER_HEAD_TYPES}, `@objectstack/spec/data`'s published
 * "stores one scalar value" set, derived from the ADR-0104 value classes — the
 * #8371 dotted-head verdict reads the same set), or a list of scalar members
 * (the same set under `multiple: true`, and the inherently-multi option types,
 * {@link MULTI_OPTION_TYPES}). An object can never equal such a value, nor any
 * member of it, on any backend.
 *
 * - **Multi-value fields are judged, unlike the dotted-head verdict's
 *   carve-out.** That carve-out exists because a numeric-index DOTTED path
 *   (`'tags.0'`) reaches an array member on two backends. The nested-object
 *   spelling does not: `{ tags: { 0: 'x' } }` over a `multiple: true` select
 *   answered 200 with no rows on InMemoryDriver and 400 on both SQL dialects,
 *   the same split as the scalar case (measured on the base above).
 * - **The accepted side, never judged:** a relation (`lookup`,
 *   `master_detail`, `user`, `tree`, single or multiple) — `{ owner: { region:
 *   'NA' } }` is a nested-relation condition, the form `FilterCondition`
 *   declares; a structured-JSON type (`json`, `composite`, `address`, …) — an
 *   object comparand is a whole-value match; a file or media type (a legacy
 *   stored value is an inline metadata object); `formula` (refused one door
 *   earlier, `INVALID_FIELD`); and a type this module has not met. That is
 *   the fail-open direction every neighbour takes: a hole, not a false 400.
 * - **A `{ $field }` reference is never this arm's**: it carries a `$` key. So
 *   does every operator bag, however malformed — the drivers and the
 *   comparand doors answer those.
 * - **`{}` is judged too** under a judged column. It has no `$` key, and at the
 *   two engine-evaluated positions it counted no row and kept no group on every
 *   driver; at `where` the drivers already refused it, and now the engine does,
 *   first.
 *
 * ## Structure test
 *
 * A PLAIN object only — prototype `Object.prototype` or `null`. A `Map` or a
 * class instance is a comparand the comparand-type door refuses in its own
 * words one call later, and a `Date` or an array is a comparand too: none of
 * them is filter structure.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/20546
 */

import { MULTI_OPTION_TYPES, SCALAR_FILTER_HEAD_TYPES } from '@objectstack/spec/data';

/**
 * Does a column of this declared type hold scalar values — one, or a list of
 * scalar members — so that an object beneath it can match nothing? The arm's
 * one classification; see the module header for the closed definition and the
 * accepted side.
 */
export function holdsScalarValues(type: string): boolean {
  return SCALAR_FILTER_HEAD_TYPES.has(type) || MULTI_OPTION_TYPES.has(type);
}

/**
 * Is this field spec a PLAIN object with no `$`-operator key — filter
 * structure where a value belongs? `{}` included; a `Map`, a class instance, a
 * `Date` and an array are comparands, not structure (see the module header).
 */
export function isNoOperatorObject(spec: unknown): spec is Record<string, unknown> {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return !Object.keys(spec).some((key) => key.startsWith('$'));
}

/** What the arm found: the column, its declaration, where it sits, and the object's keys. */
export interface NoOperatorObjectRefusal {
  /** The filter key, which names the column. */
  readonly field: string;
  /** Its declared `FieldType` — for `having`, the type the aggregated column carries. */
  readonly declaredType: string;
  /** The key path the object sits at (`where.amount`, `having.total`, …). */
  readonly path: string;
  /** The object's own keys, in order — `[]` for `{}`. */
  readonly keys: readonly string[];
  /** `having`: the column is an aggregated row's, not a declared field of the object. */
  readonly aggregated: boolean;
}

/** How the object is named in the words: its keys, never its values. */
function describeObject(keys: readonly string[]): string {
  if (keys.length === 0) return 'an empty object {}';
  const shown = keys.slice(0, 3).map((key) => JSON.stringify(key)).join(', ');
  const more = keys.length > 3 ? `, and ${keys.length - 3} more` : '';
  return `an object with no operator key (keys ${shown}${more})`;
}

/**
 * The refusal's words. Every position reads the same, less the subject: a
 * declared field at `where` and `aggregations[i].filter`, an aggregated column
 * at `having`. No tracker id: the lesson is in the sentence.
 */
export function noOperatorObjectRefusalMessage(refusal: NoOperatorObjectRefusal, context: string): string {
  const subject = refusal.aggregated
    ? `the aggregated column '${refusal.field}', which carries a ${refusal.declaredType} value`
    : `the declared ${refusal.declaredType} field '${refusal.field}'`;
  return (
    `${context}: filter on '${refusal.field}' puts ${describeObject(refusal.keys)} at ${refusal.path}, `
    + `where a value of ${subject} belongs. An object with no "$" operator is filter structure, not `
    + 'a value: beneath a field it is a nested-relation condition, which only a relation field (lookup, '
    + 'master-detail, user, tree) can carry, or a whole-value match, which only a JSON-bearing field '
    + `can hold. A ${refusal.declaredType} column holds scalar values — one, or a list of them — so no `
    + 'record can match an object there, and an empty answer would read exactly like a real one. The '
    + `filter was NOT applied. Compare '${refusal.field}' with a value ({ "${refusal.field}": VALUE }) `
    + `or an operator ({ "${refusal.field}": { "$eq": VALUE } }).`
  );
}
