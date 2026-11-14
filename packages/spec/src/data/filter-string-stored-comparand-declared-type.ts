// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29486] The STRING-STORED comparand **declared-type door** — what a number
 * or boolean comparand means against a field whose stored value is a string:
 * the text family and the option family. The third twin of
 * `filter-number-comparand-declared-type.ts` (#20336) and
 * `filter-boolean-comparand-declared-type.ts` (#21333), in the same two lanes:
 * this module is lane (1), the CONTRACT — the judged types, the positions and
 * the pure verdict. Lane (2), the door, is `@objectstack/objectql`'s, an arm of
 * the one filter walk the engine runs at its field-aware seam. THIS MODULE
 * WRITES NO DOOR, and `packages/spec` carries no runtime logic (Prime
 * Directive #2).
 *
 * ## The direction this encodes (maintainer ruling A, recorded on #29486)
 *
 * A number or boolean comparand on a text- or option-family field compares as
 * `String(value)`, the same form the write side stores (#29241 for the text
 * family, #29562 for the option family) — the number and boolean doors' rule,
 * "narrow what unambiguously names a value". It is a widening: a filter that
 * matched nothing now matches what the write stored.
 *
 * ## What the door closes, measured before it (base `9499dcc53`)
 *
 * Three rows written through `engine.insert` — `42`, `"42"` and `true` on a
 * `text` field, `3`, `"3"` and `true` on a `select` — on InMemoryDriver and on
 * SqlDriver over SQLite. The write door stored `"42"`, `"42"`, `"true"` (and
 * `"3"`, `"3"`, `"true"`), so a number comparand compared a number with a
 * string:
 *
 * | filter | InMemoryDriver | SQLite | after the door |
 * |:--|:--|:--|:--|
 * | `{ title: 42 }`, `{ stage: 3 }` | no row | no row | the two rows written `42` / `3` and `"42"` / `"3"` |
 * | `{ title: true }`, `{ stage: { $eq: true } }` | no row | no row | the row written `true` |
 * | `{ title: { $in: [42, true] } }` | no row | no row | all three |
 * | `{ title: { $ne: 42 } }` | all three | all three | the row written `true` |
 *
 * Every answer a 200, no error; `{ title: "42" }` matched both `42` rows.
 *
 * The ranges, a `text` field holding `"10"`, `"5"`, `"42"`, `"alpha"`, measured
 * at the driver on the filter each received before the door (as written) and
 * after it (narrowed). A range bound is narrowed like any comparand, so a range
 * on a string-stored field is a STRING range, ordered as the column's strings:
 *
 * | filter | InMemoryDriver before | SQLite before | every driver after |
 * |:--|:--|:--|:--|
 * | `{ title: { $gt: 9 } }` | no row | `"alpha"` | `"alpha"` — `"10"` < `"9"` as strings |
 * | `{ title: { $between: [1, 10] } }` | no row | `"10"` | `"10"` — `"5"` > `"10"` as strings |
 * | `{ title: { $gt: 4, $lt: 5 } }` | no row | `"5"`, `"42"` | `"42"` |
 *
 * MongoDB orders a number and a string in different type brackets, so, like the
 * memory matcher, it matched no row for a number bound.
 * A multi-value option field (`multiselect`, …) is unchanged: both drivers
 * refuse a scalar comparison against one (`INVALID_FILTER`, "use $contains"),
 * whatever the comparand, before and after.
 *
 * ## The door's answers — NARROW a number or a boolean to its string reading
 *
 * - **A number or a boolean** narrows to `String(value)`, copy-on-write — the
 *   exact reading the record validator's string and option arms judge a
 *   written value by and the write door stores
 *   (`@objectstack/objectql`'s `record-validator.ts`): `42` → `"42"`,
 *   `true` → `"true"`, `false` → `"false"`, `0.5` → `"0.5"`.
 * - **A `bigint` within ±2^53** narrows to the string of the number it names,
 *   the number the comparand-type door (`filter-comparand-type.ts`) rewrites it
 *   to. That door runs BEFORE this one on the `FilterArray` spelling and at
 *   `having` but AFTER it on the object spelling of `where` and on a
 *   per-aggregation `filter` (the boolean door records the same order), so only
 *   reading a `bigint` as its number gives one answer at every position. A
 *   `bigint` beyond ±2^53 passes, and that door refuses it in its own words.
 * - **A string** passes, as written: it is already the stored form.
 * - **`null`** passes: it is the null test (`{ code: null }`), never `"null"`.
 * - **Everything else passes** — a `Date`, an array (the comparand-shape door's
 *   subject at a one-value slot), a `{ $field }` reference, and every value
 *   outside the comparand-type door's accepted set, which that door refuses.
 *
 * There is no refusal: every comparand this door judges names exactly one
 * stored string.
 *
 * ## Which fields, which positions
 *
 * The write side's two families, by reference and never re-listed:
 * `BOUNDED_STRING_FIELD_TYPES` (`field.zod.ts` — text, textarea, email, url,
 * phone, password, markdown, html, richtext, code, signature, qrcode) and the
 * option family, `SINGLE_OPTION_TYPES` and `MULTI_OPTION_TYPES`
 * (`field-value.zod.ts` — select, radio, multiselect, checkboxes, tags). A
 * multi-value option field stores an array of codes, and the write side reads
 * each number or boolean ELEMENT by the same `String(value)`; a scalar
 * comparand against one is such an element, so it is narrowed the same way.
 * What a driver does with a scalar against an array column is unchanged (both
 * measured drivers refuse it, as above); only the comparand it is handed is
 * now the code the write stored. A `formula` is
 * not judged: the write side stores no formula value, and the
 * unmaterializable-field door refuses every formula filter first (#8296).
 *
 * The positions are the number door's, BY IDENTITY
 * ({@link STRING_STORED_COMPARAND_DOOR_SCALAR_OPERATORS},
 * {@link STRING_STORED_COMPARAND_DOOR_LIST_OPERATORS}): the implicit
 * comparand, the scalar operators and every member of the list operators. Not
 * judged: the flags (`$null` / `$exists` / `$empty`), the text operators
 * (`$contains: 42` is the text-comparand door's refusal), a `{ $field }`
 * reference and a dotted key.
 *
 * ## Where the cases live
 *
 * The cross-driver cases are `FILTER_STRING_STORED_COMPARAND_CASES` in
 * `filter-comparand-type-conformance.ts`: each carries the filter as written
 * and the filter this door hands every driver, so the engine suite pins the
 * narrowing and each driver suite pins that the narrowed filter matches the
 * stored rows.
 *
 * @see NUMBER_COMPARAND_DOOR_CASES — the twin this module is shaped after.
 * @see https://github.com/objectstack-ai/objectstack/issues/29486 (this door)
 */

import { BOUNDED_STRING_FIELD_TYPES } from './field.zod';
import { MULTI_OPTION_TYPES, SINGLE_OPTION_TYPES } from './field-value.zod';
import {
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
} from './filter-number-comparand-declared-type';
import { FILTER_COMPARAND_BIGINT_EXACT_LIMIT } from './filter-comparand-type';

/**
 * The declared-type families the door judges — the write side's three sets, by
 * identity (pinned), never a re-listing: the text family and the single- and
 * multi-value option families.
 */
export const STRING_STORED_COMPARAND_DOOR_FAMILIES: readonly ReadonlySet<string>[] = [
  BOUNDED_STRING_FIELD_TYPES,
  SINGLE_OPTION_TYPES,
  MULTI_OPTION_TYPES,
];

/** The operators whose single comparand the door judges — the number door's list, by identity. */
export const STRING_STORED_COMPARAND_DOOR_SCALAR_OPERATORS = NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS;

/** The list operators each of whose MEMBERS the door judges — the number door's list, by identity. */
export const STRING_STORED_COMPARAND_DOOR_LIST_OPERATORS = NUMBER_COMPARAND_DOOR_LIST_OPERATORS;

/** The slice of a field definition the door reads. */
export interface StringStoredComparandDoorFieldMeta {
  type: string;
}

/** Is the field one the door judges? `judged` for a member of a {@link STRING_STORED_COMPARAND_DOOR_FAMILIES} set. */
export function stringStoredComparandFieldVerdict(
  field: StringStoredComparandDoorFieldMeta,
): 'judged' | 'not-judged' {
  return STRING_STORED_COMPARAND_DOOR_FAMILIES.some((family) => family.has(field.type)) ? 'judged' : 'not-judged';
}

/**
 * The door's two answers for ONE comparand at a judged position.
 *
 * - `narrows` — a number, a boolean, or a `bigint` within ±2^53; the door
 *   replaces it with `value`, its string reading.
 * - `passes` — not this door's subject (the field is not string-stored, or the
 *   comparand is a string, `null`, or anything else — see the module header);
 *   nothing changes.
 */
export type StringStoredComparandDoorVerdict =
  | { readonly verdict: 'narrows'; readonly value: string }
  | { readonly verdict: 'passes' };

/**
 * The door's verdict for `comparand` at a judged position of a filter on
 * `field` (an UNDOTTED key naming a declared field). Pure: two inputs, no I/O.
 */
export function stringStoredComparandDoorVerdict(
  field: StringStoredComparandDoorFieldMeta,
  comparand: unknown,
): StringStoredComparandDoorVerdict {
  if (stringStoredComparandFieldVerdict(field) !== 'judged') return { verdict: 'passes' };
  if (typeof comparand === 'number' || typeof comparand === 'boolean') {
    return { verdict: 'narrows', value: String(comparand) };
  }
  if (typeof comparand === 'bigint') {
    const magnitude = comparand < 0n ? -comparand : comparand;
    if (magnitude > FILTER_COMPARAND_BIGINT_EXACT_LIMIT) return { verdict: 'passes' };
    return { verdict: 'narrows', value: String(Number(comparand)) };
  }
  return { verdict: 'passes' };
}
