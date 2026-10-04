// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20336] The NUMBER-comparand **declared-type door** — which STRING
 * comparands a field whose declared type is numeric may be compared against,
 * and the one numeric grammar the platform reads a string by, on the read side
 * (this door) and the write side (the record validator's number arm, #20309).
 *
 * ## The direction this encodes (triage, recorded on #20336)
 *
 * > **Direction, decided here:** the door refuses a non-numeric string against
 * > a number field with `INVALID_FILTER` / 400, naming the field, on every
 * > driver and position, before any bind. That is the loud answer the charter
 * > prefers, and the one the temporal door already gives. ⛔ Not a driver-side
 * > catch that turns PostgreSQL's 500 into a 200.
 *
 * Routed on #15661's precedent as two lanes: this module is lane (1), the
 * CONTRACT — the grammar, the pure verdict, the refusal words, a fixture and
 * the derived case table. Lane (2), the door at the engine's field-aware seam
 * that consults it (with the three-driver and REST pins and the per-aggregation
 * `filter` position), is #20351's. THIS MODULE WRITES NO DOOR, and
 * `packages/spec` carries no runtime logic (Prime Directive #2).
 *
 * ## What the door closes, measured on the card
 *
 * `where { amount: { $gt: "abc" } }` over a `number` field answered three ways:
 * 200 with no rows on InMemoryDriver and SQLite, and `DATABASE_ERROR` / 500 on
 * PostgreSQL, which refuses to bind a non-numeric text to a numeric column. The
 * same string under a per-aggregation `filter` answered a count of 0 on all
 * three. One client mistake, three answers, one of them a server fault.
 *
 * ## The grammar — {@link NUMERIC_STRING_PATTERN}
 *
 * A string is numeric when its WHOLE content is a JSON number literal (RFC 8259
 * §6: `-?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?`) that names a FINITE
 * double. It then means exactly the number those same characters would mean as
 * a JSON number — {@link parseNumericString} returns `Number(s)`, which equals
 * `JSON.parse(s)` for every string the pattern admits.
 *
 * Why this set, form by form (the census the card asked for — every row is in
 * {@link NUMERIC_STRING_GRAMMAR_CASES}, and `Number()` is the reading the write
 * door used before this grammar existed):
 *
 * - **Admitted: `"12"`, `"-3"`, `"12.5"`, `"0.10"`, `"1e3"`, `"2.5E+3"`,
 *   `"1e-7"`.** Every string `String(n)` produces for a finite JS number is in
 *   the set and parses back to `n` (pinned as a round-trip property), so a
 *   caller who stringifies a number — a URL query (`?amount=5` is lowered to an
 *   implicit `{ amount: "5" }` filter), `URLSearchParams`, a CSV cell holding a
 *   plain number — is never refused. That is why the exponent form is IN:
 *   `String(1e-7)` is `"1e-7"` and `String(1e21)` is `"1e+21"`, and a grammar
 *   without it refuses the platform's own stringification of a legal number.
 *   Exponent strings are also read alike beneath the door: JS `Number()`,
 *   SQLite's numeric affinity (#20309's report measured `'1e3'` stored as the
 *   real 1000) and PostgreSQL's `numeric` input, which documents the form (not
 *   measured live in this change).
 * - **Refused: whitespace — `""`, `"  "`, `" 12 "`.** `Number()` reads `""` and
 *   `"  "` as 0 and trims padding; the write side's triage direction on #20309
 *   refuses whitespace-padded strings by name, and one grammar serves both
 *   sides. A blank comparand on a number field has no numeric reading: the
 *   write side turns a blank into `null` BEFORE the number arm (#20308), and
 *   on the read side the emptiness operator is the null test on a number field
 *   (`is_empty` → `$empty`, whose number row is null alone — #20311's ruling
 *   B) — neither hands this grammar a blank, so a blank that
 *   reaches it is a mistake, and on PostgreSQL a 500.
 * - **Refused: `"0x10"`, `"0o17"`, `"0b101"`.** `Number()` reads them; SQLite
 *   stores `'0x10'` as TEXT (measured on #20309); the write side's direction
 *   refuses hex by name.
 * - **Refused: `"Infinity"`, `"NaN"`, `"1e400"`.** No finite number — the
 *   write door already refused them (`Number.isFinite`), and the value
 *   contract for the class is `z.number().finite()`.
 * - **Refused: `"1,000"`, `"1.000,5"`, `"1_000"`, `"1 000"`.** Locale digit
 *   grouping is a presentation, not a number; `Number()` reads none of them.
 *   (The CSV import route's own cell reader strips such punctuation before it
 *   parses — an import-specific tolerance, deliberately not this grammar.)
 * - **Refused: `"+5"`, `".5"`, `"5."`, `"007"`.** `Number()` reads them, but
 *   none is a JSON number spelling and no measured producer writes one —
 *   `String(n)` never does. They are refused for their spelling, not for a
 *   divergence: the stricter set costs nothing measured and keeps the grammar
 *   one sentence long.
 * - **Refused: a `{placeholder}`** — see below.
 *
 * ## The door's answer for a numeric string: NARROW it to its number
 *
 * An admitted string is rewritten to the number it denotes, copy-on-write —
 * the declared-conversion pattern the comparand-type door already applies to
 * an exact-range `bigint` (`filter-comparand-type.ts`), and the write side's
 * "store the parsed number" (#20309's census answer). Left as a string it is
 * read three ways again: JS equality and ordering coerce it (`12 == "12"`),
 * SQLite applies numeric affinity, and `driver-mongodb` compares by BSON type,
 * so `"12"` never equals a stored `12` there (read at source: its filter
 * compiler coerces temporal comparands only; not measured live in this
 * change).
 *
 * ## Which fields: the numeric class, by REFERENCE
 *
 * The door judges a field whose declared type is a member of
 * `NUMERIC_VALUE_TYPES` (`field-value.zod.ts`) — the set itself, so a type
 * that joins it is judged with no change here — and a `formula` whose declared
 * `returnType` names a member, read through the text door's
 * `FORMULA_RETURN_TYPE_AS_FIELD_TYPE` rather than a second map.
 *
 * - **`summary` is judged.** Its COLUMN is numeric on every SQL dialect
 *   (`numericColumnFor`, pinned for every judged type), so a non-numeric
 *   string against it is the same PostgreSQL 500. The write door's exemption
 *   of `summary` is a different axis — `COMPUTED_VALUE_TYPES`, *who may write*
 *   the value — and says nothing about what a caller may compare the column
 *   with.
 * - **`formula`** is judged as the type its `returnType` names (`number`
 *   judged; `text` / `boolean` / `date` not a number field); without a
 *   readable `returnType` it is deferred. ⚠️ As with the text door, NO formula
 *   filter reaches the engine seam: the earlier unmaterializable-field door
 *   refuses every one with `INVALID_FIELD` 400 (#8296). The formula rows state
 *   the contract's answer, not an observable one — a suite driving
 *   {@link NUMBER_COMPARAND_DOOR_CASES} at that seam partitions them out.
 *
 * ## Which positions: the value comparisons, never the flags or the text operators
 *
 * The implicit-equality comparand, `$eq` / `$ne` / `$gt` / `$gte` / `$lt` /
 * `$lte` ({@link NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS}), and every MEMBER of
 * `$in` / `$nin` / `$between` ({@link NUMBER_COMPARAND_DOOR_LIST_OPERATORS}).
 * Not judged: `$null` / `$exists` / `$empty` (a boolean flag, not a value of the field),
 * the text operators (their comparand is a substring or pattern, and over a
 * numeric field they are refused one door earlier by the text door, #15661),
 * a `{ $field }` reference (not a literal), and a DOTTED key (a dotted path
 * under a numeric head is `filter-dotted-head`'s refusal). The operator lists
 * are pinned to partition `FieldOperatorsSchema`'s keys, so an operator
 * declared later fails that pin instead of slipping past the door.
 *
 * ## Which comparands: a number passes, a string is read, a boolean, a `Date` and an array are refused
 *
 * [#20502] One verdict for every comparand at a judged position, widened from
 * strings alone. The direction (triage, recorded on #20502): *the published
 * contract refuses any comparand against a declared `number` field that is
 * neither a number nor a string the numeric grammar admits … with
 * `INVALID_FILTER` / 400 naming the field; the string rule stays exactly as it
 * was.* Split by what the comparand IS:
 *
 * - **A number** passes, and so does a `bigint` — a number too, which the
 *   comparand-type door (`filter-comparand-type.ts`) narrows to its exact JS
 *   number or refuses beyond ±2^53, one door later.
 * - **`null`** passes: it is the null test (`{ amount: null }`,
 *   `{ $ne: null }`), and its per-position legality is the comparand-shape
 *   door's (a `null` under `$gt` is refused there).
 * - **A string** is read by the grammar above: narrowed or refused.
 * - **A boolean, a `Date`, an array** — refused ({@link NonNumericValueForm}).
 *   Each is inside the comparand-type door's accepted set (an array outside
 *   the list operators is left to the layers beneath it), so without this door
 *   each reached the backends and was answered three ways. Measured on the
 *   card, over rows 5, 12 and 30 of a `number` field: `$gt true` matched no
 *   row on InMemoryDriver, every row on SQLite (numeric affinity reads `true`
 *   as 1), and was a `DATABASE_ERROR` / 500 on PostgreSQL, which refuses to
 *   bind a boolean or a timestamp against a numeric column; a `Date` matched
 *   no row on the first two and was the same 500 on the third. The
 *   per-aggregation `filter` and `having` are evaluated by the engine on every
 *   driver, where JS coercion read `true` and `[1]` as 1 (`$gt true` counted
 *   every row, and kept every group) and a `Date` matched nothing. ⛔ No
 *   driver-side coercion of `true` to 1 answers this: one refusal, before any
 *   read, on every driver and position.
 * - **Everything else passes this verdict** — `undefined`, a plain object, a
 *   `{ $field }` reference, a `Map` or class instance, a symbol, a function.
 *   A `{ $field }` reference is not a literal. The rest are outside the
 *   comparand-type door's accepted set, and that door refuses them with
 *   `INVALID_FILTER` / 400 on EVERY field, at every position and on both
 *   filter spellings, in words that name the set. The engine runs the two
 *   doors in a different order per position (this door first on the object
 *   spelling of `where` and on a per-aggregation `filter`, the comparand-type
 *   door first on the `FilterArray` spelling and on `having`), so a second
 *   refusal here would answer one mistake with two sets of words depending on
 *   where it was written; passing it keeps the one refusal it already had.
 *
 * An array at an EQUALITY slot (implicit, `$eq`, `$ne`) is refused one door
 * earlier still, by the comparand-shape door, whose remedy (`$in` /
 * `$contains` / `$nin`) is the one for that slot; the verdict still answers
 * `door-refusal` for it, and the case table places its array rows where the
 * shape door does not speak. [#21448] That door now refuses a list at every
 * other scalar operator too, the ordering operators included, whatever the
 * column type, so the rows sit at the list members alone.
 *
 * ## A `{placeholder}` against a number field is refused, not stepped around
 *
 * The temporal door steps around `{tokens}` because for a temporal field a
 * token IS the platform's correct spelling. For a numeric field none is: every
 * token in the filter vocabulary resolves to a user or organization id, a
 * `YYYY-MM-DD` day or an ISO instant (`resolveFilterToken`,
 * `@objectstack/core`), none of which is numeric — so a resolved token reaches
 * PostgreSQL as the same 500. The engine's field-aware doors run BEFORE the
 * token resolver (the temporal door records why), so this door meets the
 * placeholder unresolved and refuses it there, as a placeholder
 * ({@link NonNumericStringForm} `placeholder`).
 *
 * ## The refusal words live here — {@link numberComparandRefusalMessage}
 *
 * `INVALID_FILTER` / 400, the existing filter envelope (ADR-0112 class 1); no
 * code is minted. The code is spelled as a literal for the reason
 * `filter-comparand-type.ts` records (`api/` imports `data/`), and the test
 * pins it to `StandardErrorCode`. The message names the field, its declared
 * type, the offending comparand, its position and what is wrong with it, all
 * ahead of the remedy — the REST layer truncates a 4xx message at 500
 * characters, and every case in the table fits whole (pinned) — so the door
 * prints the spec's words rather than its own.
 *
 * ## How the engine suite consumes {@link NUMBER_COMPARAND_DOOR_CASES}
 *
 * Register {@link NUMBER_COMPARAND_DOOR_FIXTURE} against a recording driver,
 * then for every case run `find(NUMBER_COMPARAND_DOOR_FIXTURE.name, { where:
 * c.filter() })`:
 *
 * - `door-refusal`: the call rejects with `code` AND `status` (the ADR-0112
 *   envelope — `toThrow()` alone is not a pin), the message contains every
 *   {@link NumberComparandDoorRefusalCase.mustMention} substring, and NO driver
 *   read ran.
 * - `narrows`: the driver read ran and received `c.expectedFilter()` — the
 *   same filter with the one comparand replaced by its number.
 * - `passes` / `deferred`: the door neither refuses nor rewrites; the driver
 *   read ran and the comparand reached it as written.
 *
 * Every case passes the SYNTAX door (`parseFilterAST` accepts each filter —
 * pinned in this module's test), so a refusal can only be a field-aware
 * door's. The census rows' comparands are chosen so that no OTHER door on the
 * seam refuses them (a date-shaped string for the temporal fields); the
 * `formula` rows are the exception, refused one door earlier as noted above.
 *
 * Deliberately NOT a driver case-set (`*-conformance.ts`): drivers sit beneath
 * this door, so the file is named for the door it declares, as
 * `filter-text-operator-declared-type.ts` is.
 *
 * ## [#20510] A `having` column is not a declared field, and only `where` binds
 *
 * At `having` the door is handed the numeric CLASS the engine derived for an
 * aggregated-row column (#20127's `aggregatedRowColumnClasses`) — an
 * aggregation alias or a groupBy projection — never a real field declaration,
 * so `numberComparandRefusalMessage` names it "a numeric aggregated column"
 * when {@link NumberComparandRefusalSite.aggregated} is set. The
 * per-aggregation `filter` is NOT this case: it narrows the object's RAW rows
 * before any aggregation runs, against the object's real declared fields (the
 * engine door's own header records this), so it keeps "a declared … field".
 * And of the three positions this door judges, only `where` (both spellings)
 * ever reaches a live driver bind — `having` and the per-aggregation `filter`
 * are evaluated by the engine itself, on every driver, before any row is
 * read — so the `not-a-number` / `boolean` / `date` clauses name PostgreSQL's
 * server error only when {@link NumberComparandRefusalSite.boundByDriver} is
 * true (the default, so a `where` site is unaffected). Both flags are the
 * engine door's to set; this module only reads them.
 *
 * @see FILTER_COMPARAND_TYPE_CASES — the syntax door this one runs beside.
 * @see TEXT_OPERATOR_DOOR_CASES — the declared-type door this one is shaped after.
 * @see https://github.com/objectstack-ai/objectstack/issues/20336 (this contract)
 * @see https://github.com/objectstack-ai/objectstack/issues/20351 (the engine door)
 * @see https://github.com/objectstack-ai/objectstack/issues/20309 (the write side)
 */

import type { FilterCondition } from './filter.zod';
import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  FILE_REFERENCE_TYPES,
  INSTANT_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
} from './field-value.zod';
import { FORMULA_RETURN_TYPE_AS_FIELD_TYPE } from './filter-text-operator-declared-type';
import { classifyFilterToken } from './context-tokens.zod';
import { shapePreview } from './filter-comparand-refusal-text';

/* ────────────────────────────────────────────────────────────────────────────
 * The grammar
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The platform's numeric grammar for a STRING: the whole string is a JSON
 * number literal (RFC 8259 §6). Finiteness is the second half of the rule and
 * is not expressible here — read a string through {@link parseNumericString}.
 *
 * Linear by construction: each unbounded digit run is closed by a literal
 * (`.`, `e`) or the end anchor, so no two quantifiers compete for a digit.
 */
export const NUMERIC_STRING_PATTERN: RegExp = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Why a string is not numeric — the forms {@link readNumericString} tells
 * apart, so a refusal can say what to fix. Every form has at least one row in
 * {@link NUMERIC_STRING_GRAMMAR_CASES} (pinned).
 *
 * - `empty` — empty or whitespace only.
 * - `padded` — a numeric string with surrounding whitespace.
 * - `placeholder` — a `{token}`; no filter token resolves to a number.
 * - `radix-prefix` — `0x…` / `0o…` / `0b…`.
 * - `non-finite` — `Infinity`, `NaN`, or a literal beyond the double range.
 * - `digit-separator` — locale digit grouping or a decimal comma.
 * - `non-json-spelling` — `Number()` reads it, JSON does not: a leading `+`
 *   or zero, a bare leading or trailing `.`.
 * - `not-a-number` — no numeric reading at all.
 */
export const NON_NUMERIC_STRING_FORMS = [
  'empty',
  'padded',
  'placeholder',
  'radix-prefix',
  'non-finite',
  'digit-separator',
  'non-json-spelling',
  'not-a-number',
] as const;

export type NonNumericStringForm = (typeof NON_NUMERIC_STRING_FORMS)[number];

/** What {@link readNumericString} answers: the number, or why there is none. */
export type NumericStringReading =
  | { readonly numeric: true; readonly value: number }
  | { readonly numeric: false; readonly form: NonNumericStringForm };

/**
 * Every decimal spelling `Number()` accepts — sign, a leading or trailing `.`,
 * an exponent. Used only to NAME a refused form, never to admit one. The same
 * linear pattern `@objectstack/formula` uses for its numeric strings.
 */
const JS_DECIMAL_SPELLING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const RADIX_PREFIX = /^[+-]?0[xXoObB]/;
const NON_FINITE_WORD = /^[+-]?(?:infinity|inf|nan)$/i;
const DIGIT_GROUP_SEPARATOR = /[,_'\u00a0\u202f ]/g;

function hasDigitSeparator(s: string): boolean {
  if (!/\d[,_'\u00a0\u202f ]\d/.test(s)) return false;
  return JS_DECIMAL_SPELLING.test(s.replace(DIGIT_GROUP_SEPARATOR, ''));
}

/**
 * Read `value` by the platform's numeric grammar: the finite number it
 * denotes, or the {@link NonNumericStringForm} it is. Pure.
 */
export function readNumericString(value: string): NumericStringReading {
  if (NUMERIC_STRING_PATTERN.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? { numeric: true, value: n } : { numeric: false, form: 'non-finite' };
  }
  const trimmed = value.trim();
  if (trimmed === '') return { numeric: false, form: 'empty' };
  if (trimmed !== value) {
    const inner = readNumericString(trimmed);
    return inner.numeric ? { numeric: false, form: 'padded' } : inner;
  }
  if (classifyFilterToken(value) !== null) return { numeric: false, form: 'placeholder' };
  if (RADIX_PREFIX.test(value)) return { numeric: false, form: 'radix-prefix' };
  if (NON_FINITE_WORD.test(value)) return { numeric: false, form: 'non-finite' };
  if (hasDigitSeparator(value)) return { numeric: false, form: 'digit-separator' };
  if (JS_DECIMAL_SPELLING.test(value)) {
    return { numeric: false, form: Number.isFinite(Number(value)) ? 'non-json-spelling' : 'non-finite' };
  }
  return { numeric: false, form: 'not-a-number' };
}

/**
 * The finite number a string denotes by the platform's numeric grammar, or
 * `undefined` when it is not numeric. The one reading both doors share: the
 * read door narrows a comparand to it, the write door stores it.
 */
export function parseNumericString(value: string): number | undefined {
  const reading = readNumericString(value);
  return reading.numeric ? reading.value : undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The comparands that are not strings
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * [#20502] The NON-string comparands the verdict refuses against a judged
 * field, by what they are — the module header says why each is here and why
 * nothing else is:
 *
 * - `boolean` — `true` / `false`.
 * - `date` — a `Date` instance, valid or not.
 * - `array` — a list where one value belongs (a scalar operator's comparand,
 *   or a member of a list operator's list).
 */
export const NON_NUMERIC_VALUE_FORMS = ['boolean', 'date', 'array'] as const;

export type NonNumericValueForm = (typeof NON_NUMERIC_VALUE_FORMS)[number];

/** Every reason the verdict refuses a comparand: a string's form, or a non-string's. */
export type NonNumericComparandForm = NonNumericStringForm | NonNumericValueForm;

/**
 * The {@link NonNumericValueForm} a non-string comparand is, or `null` for one
 * the verdict passes (a number, a `bigint`, `null`, and everything outside the
 * comparand-type door's accepted set, which that door refuses itself).
 */
function nonNumericValueForm(comparand: unknown): NonNumericValueForm | null {
  if (typeof comparand === 'boolean') return 'boolean';
  if (comparand instanceof Date) return 'date';
  if (Array.isArray(comparand)) return 'array';
  return null;
}

/**
 * The comparand as a refusal renders it: {@link shapePreview}, except that a
 * `Date` is named as one — its JSON form is a quoted string, which would read
 * as the string the grammar refuses rather than the instant it is.
 */
function comparandPreview(comparand: unknown): string {
  if (!(comparand instanceof Date)) return shapePreview(comparand);
  const time = comparand.getTime();
  return `Date(${Number.isNaN(time) ? 'Invalid Date' : comparand.toISOString()})`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The fields and positions the door judges
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The declared types the door judges — `NUMERIC_VALUE_TYPES` itself, by
 * identity (pinned), never a re-listing.
 */
export const NUMBER_COMPARAND_DOOR_JUDGED_TYPES: ReadonlySet<string> = NUMERIC_VALUE_TYPES;

/** The operators whose single comparand the door judges. */
export const NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'] as const;

/** The list operators each of whose MEMBERS the door judges as a comparand in its own right. */
export const NUMBER_COMPARAND_DOOR_LIST_OPERATORS = ['$in', '$nin', '$between'] as const;

/** The slice of a field definition the door reads. */
export interface NumberComparandDoorFieldMeta {
  type: string;
  /** `formula` only — the declared return type, when authoring could prove one. */
  returnType?: string | undefined;
}

/**
 * Is the field one the door judges? `judged` for the numeric class (and a
 * `formula` returning a member of it), `deferred` for a `formula` whose
 * `returnType` is unreadable, `not-judged` for everything else.
 */
export function numberComparandFieldVerdict(
  field: NumberComparandDoorFieldMeta,
): 'judged' | 'not-judged' | 'deferred' {
  if (field.type === 'formula') {
    const asFieldType = typeof field.returnType === 'string'
      ? FORMULA_RETURN_TYPE_AS_FIELD_TYPE.get(field.returnType)
      : undefined;
    if (asFieldType === undefined) return 'deferred';
    return numberComparandFieldVerdict({ type: asFieldType });
  }
  return NUMBER_COMPARAND_DOOR_JUDGED_TYPES.has(field.type) ? 'judged' : 'not-judged';
}

/**
 * The door's four answers for ONE comparand at a judged position.
 *
 * - `door-refusal` — refused before any driver runs (`INVALID_FILTER` / 400):
 *   a string the grammar does not read as a number, a boolean, a `Date` or an
 *   array ({@link NonNumericComparandForm}).
 * - `narrows` — a numeric string; the door replaces it with `value`.
 * - `passes` — not this door's subject (the field is not numeric, or the
 *   comparand is a number, a `bigint`, `null`, or a value the comparand-type
 *   door refuses itself — see the module header); nothing changes.
 * - `deferred` — a `formula` whose `returnType` is unreadable; nothing changes.
 */
export type NumberComparandDoorVerdict =
  | {
      readonly verdict: 'door-refusal';
      readonly form: NonNumericComparandForm;
      readonly code: 'INVALID_FILTER';
      readonly status: 400;
    }
  | { readonly verdict: 'narrows'; readonly value: number }
  | { readonly verdict: 'passes' }
  | { readonly verdict: 'deferred' };

/**
 * The door's verdict for `comparand` at a judged position of a filter on
 * `field` (an UNDOTTED key naming a declared field). Pure: two inputs, no I/O.
 */
export function numberComparandDoorVerdict(
  field: NumberComparandDoorFieldMeta,
  comparand: unknown,
): NumberComparandDoorVerdict {
  const judged = numberComparandFieldVerdict(field);
  if (judged === 'deferred') return { verdict: 'deferred' };
  if (judged === 'not-judged') return { verdict: 'passes' };
  if (typeof comparand !== 'string') {
    const form = nonNumericValueForm(comparand);
    if (form === null) return { verdict: 'passes' };
    return { verdict: 'door-refusal', form, code: 'INVALID_FILTER', status: 400 };
  }
  const reading = readNumericString(comparand);
  if (reading.numeric) return { verdict: 'narrows', value: reading.value };
  return { verdict: 'door-refusal', form: reading.form, code: 'INVALID_FILTER', status: 400 };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The refusal words
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What is wrong with the comparand, per form — the clause after "which is not
 * a number:". Each clause states only what holds for its form: `"+5"` is
 * refused for its spelling alone, so its clause claims no divergence between
 * backends, while the card's `"abc"` names the one it measured, and so do the
 * boolean and `Date` clauses (#20502's measurement).
 *
 * [#20510] Three forms — `not-a-number`, `boolean`, `date` — name PostgreSQL's
 * own server error, which is a fact about a position the DRIVER binds
 * (`where`, on both spellings): the comparand reaches a live bind and
 * PostgreSQL refuses it there. At `having` and the per-aggregation `filter`
 * the engine evaluates the clause itself, in JS, on every driver, before any
 * row is read — no driver ever sees the comparand, so no driver ever answers
 * it, and naming PostgreSQL there would describe a bind that never happens.
 * Their entries are a function of {@link NumberComparandRefusalSite.boundByDriver}
 * so the one clause serves both kinds of position honestly.
 */
const FORM_SENTENCE: Readonly<Record<NonNumericComparandForm, string | ((boundByDriver: boolean) => string)>> = {
  'empty': 'a blank string names no number (to match a missing value, write {"$eq": null}).',
  'padded': 'it carries surrounding whitespace.',
  'placeholder': 'a {placeholder} resolves to an id or a date, never to a number.',
  'radix-prefix': 'a hex, octal or binary spelling is not read alike by every backend.',
  'non-finite': 'Infinity, NaN and out-of-range values name no finite number.',
  'digit-separator': 'digit grouping and decimal commas are a locale spelling, not a number.',
  'non-json-spelling': 'a leading "+" or zero, or a bare leading or trailing ".", is not a JSON number.',
  'not-a-number': (boundByDriver) =>
    `it has no numeric reading${boundByDriver ? ', and backends answer it differently (PostgreSQL with a server error).' : '.'}`,
  'boolean': (boundByDriver) =>
    `a boolean names no number (true is not 1)${boundByDriver ? ', and backends answer it differently (PostgreSQL with a server error).' : '.'}`,
  'date': (boundByDriver) =>
    `a Date is an instant, not a number${boundByDriver ? ', and backends answer it differently (PostgreSQL with a server error)' : ''}`
    + '; compare a Date with a date or datetime field.',
  'array': 'a list is not one number; to match any of several numbers use $in, and for a range $between, each member a number.',
};

/**
 * The consequence and the remedy, after the load-bearing head. Everything a
 * caller must read to act — field, type, comparand, position, what is wrong —
 * comes first, because the REST layer truncates a 4xx message at 500
 * characters; this tail is what a very long field name pushes off the wire.
 */
const NUMBER_COMPARAND_REFUSAL_TAIL =
  ' The filter was NOT applied. Write a number (12, -3.5, 1e3) or a string of exactly that JSON '
  + 'spelling ("12").';

/** Where the refused comparand sits, and what the door read there. */
export interface NumberComparandRefusalSite {
  /** The filter key — a declared field of the object, or (`aggregated`) an aggregated-row column. */
  readonly field: string;
  /**
   * Its declared `type` — or, when {@link NumberComparandRefusalSite.aggregated}
   * is set, the member of the numeric class the engine derived for the column
   * (`number`); an aggregated column has no declared `FieldType` of its own,
   * and the message does not print this value for one.
   */
  readonly declaredType: string;
  /** `formula` only — its declared `returnType`. */
  readonly returnType?: string;
  /** The key path of the comparand, e.g. `where.amount.$gt` or `where.amount.$in[1]`. */
  readonly path: string;
  /** The refused comparand — a string, a boolean, a `Date` or an array ({@link NonNumericComparandForm}). */
  readonly value: unknown;
  /** Why it is not numeric — `door-refusal`'s `form`. */
  readonly form: NonNumericComparandForm;
  /**
   * [#20510] `true` when `field` names an AGGREGATED-row column (`having`) —
   * an aggregation alias or a groupBy projection — rather than a declared
   * field of the object. The message then reads "a numeric aggregated
   * column", never "a declared … field": at `having` the column is the
   * engine's own projection, not the caller's record. Default `false`.
   */
  readonly aggregated?: boolean;
  /**
   * [#20510] `true` when this position is one the DRIVER binds directly
   * (`where`, both spellings) — the only place an unrefused comparand could
   * reach a live bind and provoke a driver's own error. `having` and the
   * per-aggregation `filter` are evaluated by the engine itself, before any
   * bind, on every driver alike, so the `not-a-number` / `boolean` / `date`
   * clauses name PostgreSQL's server error only when this is `true`. Default
   * `true`, so an existing `where` site (and a site built before this field
   * existed) renders byte-for-byte as before.
   */
  readonly boundByDriver?: boolean;
}

/**
 * The refusal the door prints, in one place: the field, its declared type, the
 * comparand (bounded), its position, what is wrong with it and the remedy.
 * `context` is the caller prefix the engine's refusals carry (`find('deal')`).
 */
export function numberComparandRefusalMessage(site: NumberComparandRefusalSite, context?: string): string {
  const subject = site.aggregated
    ? 'a numeric aggregated column'
    : `a declared ${site.returnType === undefined ? `${site.declaredType} field` : `${site.declaredType} field returning ${site.returnType}`}`;
  const clause = FORM_SENTENCE[site.form];
  const sentence = typeof clause === 'function' ? clause(site.boundByDriver ?? true) : clause;
  return (
    `${context ? `${context}: ` : ''}filter on '${site.field}' compares ${subject} against `
    + `${comparandPreview(site.value)} at ${site.path}, which is not a number: ${sentence}`
    + NUMBER_COMPARAND_REFUSAL_TAIL
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The grammar's case table
 * ──────────────────────────────────────────────────────────────────────────── */

/** One row of {@link NUMERIC_STRING_GRAMMAR_CASES}. */
export type NumericStringGrammarCase =
  | { readonly input: string; readonly numeric: true; readonly value: number; readonly why: string }
  | { readonly input: string; readonly numeric: false; readonly form: NonNumericStringForm; readonly why: string };

const admit = (input: string, value: number, why: string): NumericStringGrammarCase =>
  ({ input, numeric: true, value, why });
const refuse = (input: string, form: NonNumericStringForm, why: string): NumericStringGrammarCase =>
  ({ input, numeric: false, form, why });

/**
 * The grammar, form by form — the table both doors' suites drive (the read
 * door through {@link NUMBER_COMPARAND_DOOR_CASES}, the write door directly).
 * Each row says why; the module header argues the set.
 */
export const NUMERIC_STRING_GRAMMAR_CASES: readonly NumericStringGrammarCase[] = [
  admit('12', 12, 'An integer — the URL-query and CSV case.'),
  admit('-3', -3, 'A negative integer.'),
  admit('0', 0, 'Zero is the one integer that may start with 0.'),
  admit('-0', -0, 'JSON admits it; it means the number -0.'),
  admit('12.5', 12.5, 'A decimal fraction.'),
  admit('0.10', 0.1, 'Trailing fraction zeros are a JSON spelling (and PostgreSQL numeric\'s text form).'),
  admit('1e3', 1000, 'An exponent: `String(n)` emits this form, and the backends read it alike.'),
  admit('2.5E+3', 2500, 'Upper-case E and a signed exponent are JSON spellings.'),
  admit('1e-7', 1e-7, '`String(0.0000001)` is exactly this string.'),
  admit('1e+21', 1e21, '`String(1e21)` is exactly this string.'),
  refuse('', 'empty', '`Number("")` is 0; a blank names no number, and PostgreSQL refuses it.'),
  refuse('   ', 'empty', 'Whitespace only — `Number()` reads it as 0.'),
  refuse(' 12 ', 'padded', 'Refused by name in the write side\'s direction; `Number()` would trim it.'),
  refuse('12\n', 'padded', 'A trailing line break is padding too.'),
  refuse('\t-3', 'padded', 'Leading whitespace of any kind is padding.'),
  refuse('0x10', 'radix-prefix', 'Hex is refused by name in the write side\'s direction; SQLite stores it as TEXT.'),
  refuse('0X1A', 'radix-prefix', 'Either letter case.'),
  refuse('0o17', 'radix-prefix', 'Octal — `Number()` reads it as 15.'),
  refuse('0b101', 'radix-prefix', 'Binary — `Number()` reads it as 5.'),
  refuse('Infinity', 'non-finite', 'Not finite — the class\'s value contract is `z.number().finite()`.'),
  refuse('-Infinity', 'non-finite', 'Not finite.'),
  refuse('NaN', 'non-finite', 'Names no number.'),
  refuse('1e400', 'non-finite', 'A JSON spelling beyond the double range: `Number()` answers Infinity.'),
  refuse('1,000', 'digit-separator', 'A thousands separator — a locale presentation; `Number()` reads NaN.'),
  refuse('1.000,5', 'digit-separator', 'A decimal comma with dot grouping — a locale presentation.'),
  refuse('1_000', 'digit-separator', 'A JS source-code separator, not a number spelling.'),
  refuse('1 000', 'digit-separator', 'A space-grouped number.'),
  refuse('+5', 'non-json-spelling', 'A leading "+" is not a JSON number spelling.'),
  refuse('.5', 'non-json-spelling', 'A bare leading "." is not a JSON number spelling; write 0.5.'),
  refuse('5.', 'non-json-spelling', 'A bare trailing "." is not a JSON number spelling; write 5.'),
  refuse('007', 'non-json-spelling', 'A leading zero is not a JSON number spelling; write 7.'),
  refuse('{current_user_id}', 'placeholder', 'Resolves to a user id, never a number.'),
  refuse('{today}', 'placeholder', 'Resolves to a YYYY-MM-DD day, never a number.'),
  refuse('{not_a_token}', 'placeholder', 'An unknown token is still a placeholder, and no token is a number.'),
  refuse('abc', 'not-a-number', 'The card\'s own comparand.'),
  refuse('12abc', 'not-a-number', 'A numeric prefix does not make the string a number (no parseFloat reading).'),
  refuse('2026-01-01', 'not-a-number', 'A date is not a number.'),
  refuse('\uff11\uff12', 'not-a-number', 'Full-width digits are not ASCII digits.'),
  refuse('\u22123', 'not-a-number', 'U+2212 MINUS SIGN is not the ASCII hyphen-minus.'),
  refuse('1e', 'not-a-number', 'An exponent marker needs digits.'),
  refuse('-', 'not-a-number', 'A sign alone.'),
];

/* ────────────────────────────────────────────────────────────────────────────
 * The fixture and the door's derived case table
 * ──────────────────────────────────────────────────────────────────────────── */

/** A field of {@link NUMBER_COMPARAND_DOOR_FIXTURE} — a legal `FieldSchema` input. */
export interface NumberComparandDoorFixtureField {
  readonly name: string;
  readonly type: string;
  /** Reference types point back at the fixture object itself. */
  readonly reference?: string;
  /** `formula` — a CEL expression, present so the field is a legal declaration. */
  readonly expression?: string;
  /** `formula` — the declared return type under test, or absent for the deferred row. */
  readonly returnType?: 'number' | 'text' | 'boolean' | 'date';
  /** `summary` — a roll-up declaration, present so the field is a legal declaration. */
  readonly summaryOperations?: { readonly object: string; readonly field: string; readonly function: 'count' };
  /** Single-choice types (`select` / `radio`) — one option, present so the field is a legal declaration. */
  readonly options?: readonly { readonly label: string; readonly value: string }[];
}

/** The fixture object's name. */
export const NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT = 'number_door_probe';

/**
 * Every `FieldType` member but `formula`, class by class — the union is pinned
 * to equal `FieldType` minus `formula`, so a type added to the enum and to no
 * class fails that pin instead of going untested.
 */
const FIXTURE_FIELD_TYPES: readonly string[] = [
  ...NUMERIC_VALUE_TYPES,
  ...STRING_VALUE_TYPES,
  'autonumber',
  ...SINGLE_OPTION_TYPES,
  ...MULTI_OPTION_TYPES,
  ...REFERENCE_VALUE_TYPES,
  ...FILE_REFERENCE_TYPES,
  ...BOOLEAN_VALUE_TYPES,
  ...CALENDAR_DATE_TYPES,
  ...INSTANT_TYPES,
  ...CLOCK_TIME_TYPES,
  ...STRUCTURED_JSON_TYPES,
];

const fixtureFieldFor = (type: string): NumberComparandDoorFixtureField => {
  const name = `f_${type}`;
  if (REFERENCE_VALUE_TYPES.has(type) && type !== 'user') {
    return { name, type, reference: NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT };
  }
  if (type === 'summary') {
    return { name, type, summaryOperations: { object: NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT, field: 'id', function: 'count' } };
  }
  if (SINGLE_OPTION_TYPES.has(type)) return { name, type, options: [{ label: 'Open', value: 'open' }] };
  return { name, type };
};

/**
 * The fixture: one field per `FieldType` member (`f_<type>`), plus one
 * `formula` per declared return type and one with none. Each is a legal
 * `FieldSchema` input (pinned).
 */
export const NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS: readonly NumberComparandDoorFixtureField[] = [
  ...FIXTURE_FIELD_TYPES.map(fixtureFieldFor),
  ...[...FORMULA_RETURN_TYPE_AS_FIELD_TYPE.keys()].map((returnType) => ({
    name: `f_formula_${returnType}`,
    type: 'formula',
    expression: '1',
    returnType: returnType as 'number' | 'text' | 'boolean' | 'date',
  })),
  { name: 'f_formula_untyped', type: 'formula', expression: '1' },
];

/**
 * The fixture object, in the `{ name, fields }` shape `registerObject` takes —
 * a legal `ObjectSchema` input (pinned).
 */
export const NUMBER_COMPARAND_DOOR_FIXTURE = {
  name: NUMBER_COMPARAND_DOOR_FIXTURE_OBJECT,
  label: 'Number-comparand door probe',
  fields: Object.fromEntries([
    ['id', { name: 'id', type: 'text' }],
    ...NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.map((f) => [f.name, f] as const),
  ]) as Readonly<Record<string, NumberComparandDoorFixtureField>>,
} as const;

interface NumberComparandDoorCaseBase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /** The filter key under test — a fixture field. */
  readonly key: string;
  /** The field's declared type. */
  readonly declaredType: string;
  /** `formula` only — the declared return type, when present. */
  readonly returnType?: string;
  /** The comparand's position below the key: `f_number.$gt`, `f_number.$in[1]`, or `f_number` (implicit). */
  readonly position: string;
  /** The comparand at that position. */
  readonly comparand: unknown;
  /** Builds the filter under test — a factory, so no suite can edit what another judges. */
  readonly filter: () => FilterCondition;
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/** A case the door must refuse — before any driver runs. */
export interface NumberComparandDoorRefusalCase extends NumberComparandDoorCaseBase {
  readonly verdict: 'door-refusal';
  readonly form: NonNumericComparandForm;
  /** The ADR-0112 code the refusal must carry … */
  readonly code: 'INVALID_FILTER';
  /** … beside this status. */
  readonly status: 400;
  /** Substrings the message must contain: the key, the declared type, the comparand and its position. */
  readonly mustMention: readonly string[];
}

/** A case the door must rewrite — the numeric string replaced by its number. */
export interface NumberComparandDoorNarrowsCase extends NumberComparandDoorCaseBase {
  readonly verdict: 'narrows';
  readonly value: number;
  /** The filter the driver must receive. */
  readonly expectedFilter: () => FilterCondition;
}

/** A case the door neither refuses nor rewrites. */
export interface NumberComparandDoorPassesCase extends NumberComparandDoorCaseBase {
  readonly verdict: 'passes';
}

/** A case the door records NO verdict for — a `formula` whose return type is unreadable. */
export interface NumberComparandDoorDeferredCase extends NumberComparandDoorCaseBase {
  readonly verdict: 'deferred';
}

export type NumberComparandDoorCase =
  | NumberComparandDoorRefusalCase
  | NumberComparandDoorNarrowsCase
  | NumberComparandDoorPassesCase
  | NumberComparandDoorDeferredCase;

/** Where a comparand sits under a key: implicit, one operator, or one member of a list operator. */
type Slot =
  | { readonly kind: 'implicit' }
  | { readonly kind: 'scalar'; readonly op: string }
  | { readonly kind: 'list'; readonly op: '$in' | '$nin' | '$between'; readonly index: 0 | 1 };

/** The number beside the comparand under test in a list operator — always a legal member. */
const LIST_NEIGHBOUR = 10;

function slotPosition(key: string, slot: Slot): string {
  if (slot.kind === 'implicit') return key;
  if (slot.kind === 'scalar') return `${key}.${slot.op}`;
  return `${key}.${slot.op}[${slot.index}]`;
}

/** A `Date` or an array is mutable: every filter gets its own, so no suite can move another's. */
function freshComparand(comparand: unknown): unknown {
  if (comparand instanceof Date) return new Date(comparand.getTime());
  if (Array.isArray(comparand)) return comparand.map(freshComparand);
  return comparand;
}

function filterAt(key: string, slot: Slot, given: unknown): FilterCondition {
  const comparand = freshComparand(given);
  if (slot.kind === 'implicit') return { [key]: comparand } as FilterCondition;
  if (slot.kind === 'scalar') return { [key]: { [slot.op]: comparand } } as FilterCondition;
  const list = slot.index === 0 ? [comparand, LIST_NEIGHBOUR] : [LIST_NEIGHBOUR, comparand];
  return { [key]: { [slot.op]: list } } as FilterCondition;
}

/** The five groups of {@link NUMBER_COMPARAND_DOOR_CASES}, which also prefix each case name. */
type CaseGroup = 'census' | 'position' | 'grammar' | 'unjudged' | 'value';

/**
 * Does the door judge this slot at all? The verdict is defined for a JUDGED
 * position only; a flag operator's comparand (`$null: true`) is never handed
 * to it, so its row passes whatever the verdict would say of a boolean.
 */
function isJudgedSlot(slot: Slot): boolean {
  if (slot.kind !== 'scalar') return true;
  return (NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS as readonly string[]).includes(slot.op);
}

function caseFor(
  group: CaseGroup,
  field: NumberComparandDoorFixtureField,
  slot: Slot,
  comparand: unknown,
  note?: string,
): NumberComparandDoorCase {
  const verdict: NumberComparandDoorVerdict = isJudgedSlot(slot)
    ? numberComparandDoorVerdict(field, comparand)
    : { verdict: 'passes' };
  const position = slotPosition(field.name, slot);
  const declared = field.returnType ? `${field.type} returning ${field.returnType}` : field.type;
  const base = {
    name: `[${group}] ${position} = ${comparandPreview(comparand)} over ${declared} — ${verdict.verdict}`,
    key: field.name,
    declaredType: field.type,
    ...(field.returnType ? { returnType: field.returnType } : {}),
    position,
    comparand,
    filter: () => filterAt(field.name, slot, comparand),
    ...(note ? { note } : {}),
  };
  switch (verdict.verdict) {
    case 'door-refusal':
      return {
        ...base,
        verdict: 'door-refusal',
        form: verdict.form,
        code: verdict.code,
        status: verdict.status,
        mustMention: [field.name, field.type, comparandPreview(comparand), position],
      };
    case 'narrows':
      return { ...base, verdict: 'narrows', value: verdict.value, expectedFilter: () => filterAt(field.name, slot, verdict.value) };
    case 'passes':
      return { ...base, verdict: 'passes' };
    case 'deferred':
      return { ...base, verdict: 'deferred' };
  }
}

/**
 * The census comparand: a string that is not numeric and that no OTHER door on
 * the engine seam refuses for the field's type — a calendar day for the
 * temporal classes (a wall clock for `time`), the card's `"abc"` otherwise.
 */
const censusComparandFor = (type: string): string => {
  if (CLOCK_TIME_TYPES.has(type)) return '12:00';
  if (CALENDAR_DATE_TYPES.has(type) || INSTANT_TYPES.has(type)) return '2026-01-01';
  return 'abc';
};

const fixtureField = (name: string): NumberComparandDoorFixtureField =>
  NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.find((f) => f.name === name)!;

/** Every position the door judges, in the order the module header names them. */
const JUDGED_SLOTS: readonly Slot[] = [
  { kind: 'implicit' },
  ...NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS.map((op): Slot => ({ kind: 'scalar', op })),
  ...NUMBER_COMPARAND_DOOR_LIST_OPERATORS.flatMap((op): Slot[] => [
    { kind: 'list', op, index: 0 },
    { kind: 'list', op, index: 1 },
  ]),
];

/** The `Date` the `value` rows compare with — any instant; a filter holds a copy of it. */
const VALUE_DATE = new Date(Date.UTC(2026, 0, 1));

/**
 * The one-value slots — implicit and every scalar operator — where an array is
 * the comparand-SHAPE door's refusal, one door before this one (module
 * header). [#21448] It was the equality slots alone until that door refused a
 * list at every other scalar operator too.
 */
const isOneValueSlot = (slot: Slot): boolean => slot.kind === 'implicit' || slot.kind === 'scalar';

/**
 * The cases, derived rather than hand-kept:
 *
 * 1. **The type census** — every fixture field, `$gt` against a non-numeric
 *    string: refused on the numeric class (and `formula` returning `number`),
 *    passed everywhere else, deferred on the untyped `formula`.
 * 2. **The positions** — every judged position on `f_number`, three ways: a
 *    refused string, a narrowed numeric string, and a number (passes).
 * 3. **The grammar** — every {@link NUMERIC_STRING_GRAMMAR_CASES} row at `$eq`
 *    on `f_number`.
 * 4. **The unjudged positions** — `$null`, `$exists`, `$empty` and a
 *    `{ $field }` reference on `f_number` pass.
 * 5. **The non-string comparands** ([#20502]) — `false` at `$gt` on every
 *    judged field; `true` and a `Date` at every judged position on
 *    `f_number`, and an array at every list member (a one-value slot is the
 *    shape door's); all refused. Beside them, what passes: `null` as the null test,
 *    and a boolean or a `Date` against the field classes that hold one (a
 *    `boolean` field, a `datetime` field) — not this door's subject.
 */
export const NUMBER_COMPARAND_DOOR_CASES: readonly NumberComparandDoorCase[] = [
  ...NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS.map((field) =>
    caseFor('census', field, { kind: 'scalar', op: '$gt' }, censusComparandFor(field.type))),
  ...JUDGED_SLOTS.flatMap((slot) => [
    caseFor('position', fixtureField('f_number'), slot, 'abc'),
    caseFor('position', fixtureField('f_number'), slot, '12'),
    caseFor('position', fixtureField('f_number'), slot, 12, 'A number is not this door\'s subject — the control.'),
  ]),
  ...NUMERIC_STRING_GRAMMAR_CASES.map((row) =>
    caseFor('grammar', fixtureField('f_number'), { kind: 'scalar', op: '$eq' }, row.input, row.why)),
  caseFor('unjudged', fixtureField('f_number'), { kind: 'scalar', op: '$null' }, true,
    'A null test takes a boolean flag, not a value of the field.'),
  caseFor('unjudged', fixtureField('f_number'), { kind: 'scalar', op: '$exists' }, false,
    'An existence test takes a boolean flag, not a value of the field.'),
  caseFor('unjudged', fixtureField('f_number'), { kind: 'scalar', op: '$empty' }, true,
    'An emptiness test takes a boolean flag, not a value of the field.'),
  caseFor('unjudged', fixtureField('f_number'), { kind: 'scalar', op: '$gt' }, { $field: 'f_currency' },
    'A field reference is not a literal.'),
  ...NUMBER_COMPARAND_DOOR_FIXTURE_FIELDS
    .filter((field) => numberComparandFieldVerdict(field) === 'judged')
    .map((field) => caseFor('value', field, { kind: 'scalar', op: '$gt' }, false,
      'A boolean names no number on any judged type.')),
  ...JUDGED_SLOTS.flatMap((slot) => [
    caseFor('value', fixtureField('f_number'), slot, true,
      'The card: SQLite read true as 1, PostgreSQL answered a server error, the in-process evaluator coerced it.'),
    caseFor('value', fixtureField('f_number'), slot, VALUE_DATE,
      'The card: no rows on memory and SQLite, a server error on PostgreSQL.'),
    ...(isOneValueSlot(slot) ? [] : [caseFor('value', fixtureField('f_number'), slot, [LIST_NEIGHBOUR],
      'A list where one value belongs; the in-process evaluator read [10] as 10.')]),
  ]),
  caseFor('value', fixtureField('f_number'), { kind: 'implicit' }, null,
    'A null comparand is the null test, not a value to read as a number.'),
  caseFor('value', fixtureField('f_number'), { kind: 'scalar', op: '$ne' }, null,
    'The negated null test.'),
  caseFor('value', fixtureField('f_boolean'), { kind: 'scalar', op: '$eq' }, true,
    'A boolean against a boolean field is not this door\'s subject.'),
  caseFor('value', fixtureField('f_datetime'), { kind: 'scalar', op: '$gt' }, VALUE_DATE,
    'A Date against a datetime field is the temporal door\'s subject, not this one\'s.'),
];
