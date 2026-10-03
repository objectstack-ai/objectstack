// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21333] The BOOLEAN-comparand **declared-type door** — which comparands a
 * field whose declared type is boolean may be compared against, and the one
 * boolean the door narrows each accepted spelling to. The boolean twin of
 * `filter-number-comparand-declared-type.ts` (#20336), in the same two lanes:
 * this module is lane (1), the CONTRACT — the accepted spellings, the pure
 * verdict, the refusal words, a fixture and the derived case table. Lane (2),
 * the door, is `@objectstack/objectql`'s, an arm of the one filter walk the
 * engine runs at its field-aware seam. THIS MODULE WRITES NO DOOR, and
 * `packages/spec` carries no runtime logic (Prime Directive #2).
 *
 * ## The direction this encodes (triage's ruling, recorded on #21333)
 *
 * > - A comparand against a declared `boolean` field accepts the values the
 * >   door already answers correctly (`true` / `false`, `1` / `0`, `"1"` /
 * >   `"0"`), plus the canonical strings `"true"` / `"false"`.
 * > - Those strings coerce at the door, because bare query parameters are
 * >   always strings. Any other string (`"yes"`) is refused 400 with the
 * >   declared type named.
 * > - It is one door for every surface: query `where`, `filter` in its three
 * >   spellings, and bare query parameters. ⛔ No per-door coercion.
 *
 * ## What the door closes, measured on the card's base (`6c5bef5f4`)
 *
 * Two rows of a `boolean` field (one `true`, one `false`), through
 * `engine.find`, `engine.aggregate` and every spelling the REST doors hand the
 * protocol's `findData`:
 *
 * | comparand | InMemoryDriver | SqlDriver, SQLite |
 * |:--|:--|:--|
 * | `"true"` / `"false"` (implicit, `$eq`, `$in`) | 0 rows | 0 rows |
 * | `$ne "true"` / `$nin ["true"]` | **2 rows** | **2 rows** |
 * | `"yes"` | 0 rows (`$ne`: 2) | 0 rows (`$ne`: 2) |
 * | `1` / `"1"` / `0` / `"0"` | **0 rows** (`$ne 1`: 2) | 1 row |
 * | `true` / `false` | 1 row | 1 row |
 *
 * Every answer a 200. The per-aggregation `filter` and `having` (the engine's
 * own evaluator) answered `"true"` with no row and no group and `$ne "true"`
 * with every one, on both drivers. So the ruling's "already answers correctly"
 * holds for `1` / `0` / `"1"` / `"0"` on SQLite alone: InMemoryDriver compares
 * a stored `true` with `1` strictly, and answers it with no row.
 *
 * ## The door's answers — NARROW every accepted spelling to its boolean
 *
 * - **A boolean** passes, as written.
 * - **`1` / `0`, `"1"` / `"0"`, `"true"` / `"false"`** narrow to `true` /
 *   `false`, copy-on-write, so every backend receives the one value each
 *   spelling names — the number door's answer for a numeric string, and the
 *   reason the narrowing covers the numbers too: left as written, a number is
 *   read two ways (the SQL backends bind `1` against a stored 1; the memory
 *   matcher compares it with a stored `true` and matches nothing). The set is
 *   exactly the one the record validator's boolean arm admits on WRITE
 *   (`@objectstack/objectql`'s `record-validator.ts`), so a value a record may
 *   be written with is a value a filter may compare it with.
 * - **Any other string** is refused, `INVALID_FILTER` / 400, naming the field
 *   and its declared type ({@link NonBooleanStringForm}): `"yes"`, `"TRUE"`,
 *   `" true "`, `""`, a `{placeholder}` (every filter token resolves to an id
 *   or a date, never a boolean — the number door argues the same), and so on.
 *   ⛔ No case folding and no trimming: one spelling per value, the write
 *   side's.
 * - **A number other than `1` / `0`, a `Date`, an array** — refused the same
 *   way ({@link NonBooleanValueForm}); see the next section.
 * - **A `bigint`** is read as the number it names: `1n` / `0n` narrow like
 *   `1` / `0`, and any other `bigint` is refused as a number. That is the
 *   number the comparand-type door (`filter-comparand-type.ts`) rewrites it to,
 *   and that door runs BEFORE this one on the `FilterArray` spelling and at
 *   `having` but AFTER it on the object spelling of `where` and on a
 *   per-aggregation `filter` — so only reading a `bigint` as its number gives
 *   one answer at every position. Passed as written, `1n` reached the drivers
 *   as `1` from the object spelling, unnarrowed (no row on InMemoryDriver, the
 *   true row on SQLite), and `2n` as `2` (PostgreSQL's server error).
 * - **`null`** passes: it is the null test (`{ flag: null }`, `{ $ne: null }`).
 * - **Everything else passes this verdict** — `undefined`, a plain object, a
 *   `{ $field }` reference, a `Map` or class instance. A `{ $field }` reference
 *   is not a literal. The rest are outside the comparand-type door's accepted
 *   set, and that door refuses them with `INVALID_FILTER` / 400 on every field,
 *   at every position and on both filter spellings, in words that name the
 *   set; the engine runs the two doors in a different order per position, so a
 *   second refusal here would answer one mistake in two sets of words
 *   depending on where it was written. The number door argues the same.
 *
 * ## [#21382] The non-string comparands: refused, not answered as written
 *
 * Triage's direction (recorded on #21382, inheriting #20502's for the number
 * door): *the published verdict refuses, with `INVALID_FILTER` / 400 naming
 * the field, any comparand against a declared boolean field that is outside
 * its accepted set — another number, a `Date`, an object, and an array at a
 * scalar slot or as a list member; the engine door consumes that verdict and
 * nothing else; `null` keeps its meaning.* Until then the verdict judged
 * strings only, and a non-string outside the accepted set reached the backends
 * as written. Measured on `69a12a0952` through `engine.find` /
 * `engine.aggregate`, two rows (one `true`, one `false`); a `where` cell reads
 * implicit, `$eq`, `$ne`, and a `$in` member beside `false`:
 *
 * | comparand, position | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `2`, `-1`, `0.5`, a `Date`, `where` | no row, no row, both, the false row | the same | **500 `DATABASE_ERROR`** at every slot |
 * | the same, per-aggregation `filter` / `having` | count 0, 0, 2, 1 / the groups alike | the same | the same |
 * | an array `[true]` as a `$in` member, `where` | **the false row (200)** | 400, the driver's | 400, the driver's |
 * | the same, per-aggregation `filter` / `having` | count 1 / the false group: the member dropped | the same | the same |
 *
 * So one client mistake was a server fault on PostgreSQL and an empty 200
 * elsewhere, and an array member split 200 / 400 across drivers. Each is now
 * refused before any read, on every driver and at every position. An array
 * at an EQUALITY slot (implicit, `$eq`, `$ne`) is refused one door earlier
 * still, by the comparand-shape door, whose remedy is the one for that slot;
 * the verdict answers `door-refusal` for it too, and the case table places its
 * array rows where the shape door does not speak. [#21448] That door now
 * refuses a list at every other scalar operator as well, whatever the column
 * type, so the rows sit at the list members alone. An object is the
 * comparand-type door's refusal, as above: refused before this change, and
 * still refused, in that door's words.
 *
 * ## Which fields, which positions
 *
 * A field whose declared type is a member of `BOOLEAN_VALUE_TYPES`
 * (`field-value.zod.ts` — `boolean`, `toggle`), by reference; a `formula`
 * whose `returnType` is `boolean`, read through the text door's
 * `FORMULA_RETURN_TYPE_AS_FIELD_TYPE`, and deferred without a readable one.
 * As with the number door, no formula filter reaches the engine seam today:
 * the unmaterializable-field door refuses every one first (#8296).
 *
 * The positions are the number door's, BY IDENTITY
 * ({@link BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS},
 * {@link BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS}): the implicit comparand, the
 * scalar operators and every member of the list operators. The engine judges
 * both arms in one walk, so the two doors cannot disagree about where a value
 * sits. Not judged: the flags (`$null` / `$exists` / `$empty`), the text
 * operators, a `{ $field }` reference and a dotted key.
 *
 * ## The refusal words live here — {@link booleanComparandRefusalMessage}
 *
 * `INVALID_FILTER` / 400, the existing filter envelope (ADR-0112 class 1); no
 * code is minted, and the code is spelled as a literal for the reason
 * `filter-comparand-type.ts` records. The message names the field, its declared
 * type, the comparand, its position and what is wrong, ahead of the remedy —
 * the REST layer truncates a 4xx message at 500 characters.
 *
 * ## How the engine suite consumes {@link BOOLEAN_COMPARAND_DOOR_CASES}
 *
 * Register {@link BOOLEAN_COMPARAND_DOOR_FIXTURE} against a recording driver
 * and run each case through `find`: a `door-refusal` rejects with `code` AND
 * `status` and no driver read runs; a `narrows` case hands the driver
 * `c.expectedFilter()`; a `passes` / `deferred` case hands it the filter as
 * written. The `formula` rows are refused one door earlier, as noted above.
 * Every comparand in the table survives `JSON.stringify` (no `bigint` row), so
 * a suite may print or send any filter it builds.
 *
 * @see NUMBER_COMPARAND_DOOR_CASES — the twin this module is shaped after.
 * @see https://github.com/objectstack-ai/objectstack/issues/21333 (this door)
 * @see https://github.com/objectstack-ai/objectstack/issues/21382 (the non-string comparands)
 */

import type { FilterCondition } from './filter.zod';
import { BOOLEAN_VALUE_TYPES } from './field-value.zod';
import { FORMULA_RETURN_TYPE_AS_FIELD_TYPE } from './filter-text-operator-declared-type';
import {
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
} from './filter-number-comparand-declared-type';
import { classifyFilterToken } from './context-tokens.zod';
import { shapePreview } from './filter-comparand-refusal-text';

/* ────────────────────────────────────────────────────────────────────────────
 * The accepted spellings
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every non-boolean spelling the door accepts, and the boolean it narrows to —
 * the record validator's write-side set, exactly. A boolean itself is accepted
 * as written and is not listed.
 */
export const BOOLEAN_COMPARAND_SPELLINGS: ReadonlyMap<string | number, boolean> = new Map<string | number, boolean>([
  [1, true],
  [0, false],
  ['1', true],
  ['0', false],
  ['true', true],
  ['false', false],
]);

/**
 * Why a string is not a boolean spelling — the forms
 * {@link readBooleanComparand} tells apart, so a refusal can say what to fix.
 *
 * - `empty` — empty or whitespace only.
 * - `padded` — an accepted spelling with surrounding whitespace.
 * - `letter-case` — `"TRUE"`, `"False"`: an accepted spelling in another case.
 * - `placeholder` — a `{token}`; no filter token resolves to a boolean.
 * - `not-a-boolean` — no boolean reading at all (`"yes"`, `"on"`, `"2"`).
 */
export const NON_BOOLEAN_STRING_FORMS = [
  'empty',
  'padded',
  'letter-case',
  'placeholder',
  'not-a-boolean',
] as const;

export type NonBooleanStringForm = (typeof NON_BOOLEAN_STRING_FORMS)[number];

/**
 * What {@link readBooleanComparand} answers: the boolean a comparand names, why
 * a string names none, or `null` for a comparand that is not this reading's
 * subject (a non-string outside the accepted set, which the verdict judges by
 * what it IS — {@link NonBooleanValueForm}; see the module header).
 */
export type BooleanComparandReading =
  | { readonly boolean: true; readonly value: boolean }
  | { readonly boolean: false; readonly form: NonBooleanStringForm }
  | null;

/**
 * Read `comparand` by the accepted spellings. Pure. [#21382] A `bigint` is read
 * as the number it names (`1n` as `1`), the number the comparand-type door
 * rewrites it to — see the module header.
 */
export function readBooleanComparand(comparand: unknown): BooleanComparandReading {
  if (typeof comparand === 'boolean') return { boolean: true, value: comparand };
  if (typeof comparand === 'bigint') return readBooleanComparand(Number(comparand));
  if (typeof comparand !== 'string' && typeof comparand !== 'number') return null;
  const value = BOOLEAN_COMPARAND_SPELLINGS.get(comparand);
  if (value !== undefined) return { boolean: true, value };
  if (typeof comparand === 'number') return null;
  const trimmed = comparand.trim();
  if (trimmed === '') return { boolean: false, form: 'empty' };
  if (trimmed !== comparand) {
    return BOOLEAN_COMPARAND_SPELLINGS.has(trimmed) || BOOLEAN_COMPARAND_SPELLINGS.has(trimmed.toLowerCase())
      ? { boolean: false, form: 'padded' }
      : readBooleanComparand(trimmed);
  }
  if (classifyFilterToken(comparand) !== null) return { boolean: false, form: 'placeholder' };
  if (BOOLEAN_COMPARAND_SPELLINGS.has(comparand.toLowerCase())) return { boolean: false, form: 'letter-case' };
  return { boolean: false, form: 'not-a-boolean' };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The comparands that are not strings
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * [#21382] The NON-string comparands the verdict refuses against a judged
 * field, by what they are — the module header says why each is here and why
 * nothing else is:
 *
 * - `number` — a number other than `1` / `0` (`2`, `-1`, `0.5`, `NaN`), or a
 *   `bigint` naming one.
 * - `date` — a `Date` instance, valid or not.
 * - `array` — a list where one value belongs (a scalar operator's comparand,
 *   or a member of a list operator's list).
 */
export const NON_BOOLEAN_VALUE_FORMS = ['number', 'date', 'array'] as const;

export type NonBooleanValueForm = (typeof NON_BOOLEAN_VALUE_FORMS)[number];

/** Every reason the verdict refuses a comparand: a string's form, or a non-string's. */
export type NonBooleanComparandForm = NonBooleanStringForm | NonBooleanValueForm;

/**
 * The {@link NonBooleanValueForm} a comparand the reading does not read is, or
 * `null` for one the verdict passes (`null`, and everything outside the
 * comparand-type door's accepted set, which that door refuses itself). Asked
 * only after {@link readBooleanComparand} answered `null`, so a number here is
 * never `1` / `0`.
 */
function nonBooleanValueForm(comparand: unknown): NonBooleanValueForm | null {
  if (typeof comparand === 'number' || typeof comparand === 'bigint') return 'number';
  if (comparand instanceof Date) return 'date';
  if (Array.isArray(comparand)) return 'array';
  return null;
}

/**
 * The comparand as a refusal renders it: {@link shapePreview}, except that a
 * `Date` is named as one (its JSON form is a quoted string, which would read as
 * a string the door refuses rather than the instant it is), and a non-finite
 * number by its own name (its JSON form is `null`, the null test).
 */
function comparandPreview(comparand: unknown): string {
  if (typeof comparand === 'number' && !Number.isFinite(comparand)) return String(comparand);
  if (!(comparand instanceof Date)) return shapePreview(comparand);
  const time = comparand.getTime();
  return `Date(${Number.isNaN(time) ? 'Invalid Date' : comparand.toISOString()})`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The fields and positions the door judges
 * ──────────────────────────────────────────────────────────────────────────── */

/** The declared types the door judges — `BOOLEAN_VALUE_TYPES` itself, by identity. */
export const BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES: ReadonlySet<string> = BOOLEAN_VALUE_TYPES;

/** The operators whose single comparand the door judges — the number door's list, by identity. */
export const BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS = NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS;

/** The list operators each of whose MEMBERS the door judges — the number door's list, by identity. */
export const BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS = NUMBER_COMPARAND_DOOR_LIST_OPERATORS;

/** The slice of a field definition the door reads. */
export interface BooleanComparandDoorFieldMeta {
  type: string;
  /** `formula` only — the declared return type, when authoring could prove one. */
  returnType?: string | undefined;
}

/**
 * Is the field one the door judges? `judged` for the boolean class (and a
 * `formula` returning `boolean`), `deferred` for a `formula` whose
 * `returnType` is unreadable, `not-judged` for everything else.
 */
export function booleanComparandFieldVerdict(
  field: BooleanComparandDoorFieldMeta,
): 'judged' | 'not-judged' | 'deferred' {
  if (field.type === 'formula') {
    const asFieldType = typeof field.returnType === 'string'
      ? FORMULA_RETURN_TYPE_AS_FIELD_TYPE.get(field.returnType)
      : undefined;
    if (asFieldType === undefined) return 'deferred';
    return booleanComparandFieldVerdict({ type: asFieldType });
  }
  return BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES.has(field.type) ? 'judged' : 'not-judged';
}

/**
 * The door's four answers for ONE comparand at a judged position.
 *
 * - `door-refusal` — refused before any driver runs (`INVALID_FILTER` / 400):
 *   a string that is not an accepted spelling, a number other than `1` / `0`,
 *   a `Date` or an array ({@link NonBooleanComparandForm}).
 * - `narrows` — an accepted non-boolean spelling (or a `bigint` naming `1` /
 *   `0`); the door replaces it with `value`.
 * - `passes` — not this door's subject (the field is not boolean, or the
 *   comparand is a boolean, `null`, or a value the comparand-type door refuses
 *   itself — see the module header); nothing changes.
 * - `deferred` — a `formula` whose `returnType` is unreadable; nothing changes.
 */
export type BooleanComparandDoorVerdict =
  | {
      readonly verdict: 'door-refusal';
      readonly form: NonBooleanComparandForm;
      readonly code: 'INVALID_FILTER';
      readonly status: 400;
    }
  | { readonly verdict: 'narrows'; readonly value: boolean }
  | { readonly verdict: 'passes' }
  | { readonly verdict: 'deferred' };

/**
 * The door's verdict for `comparand` at a judged position of a filter on
 * `field` (an UNDOTTED key naming a declared field). Pure: two inputs, no I/O.
 */
export function booleanComparandDoorVerdict(
  field: BooleanComparandDoorFieldMeta,
  comparand: unknown,
): BooleanComparandDoorVerdict {
  const judged = booleanComparandFieldVerdict(field);
  if (judged === 'deferred') return { verdict: 'deferred' };
  if (judged === 'not-judged') return { verdict: 'passes' };
  if (typeof comparand === 'boolean') return { verdict: 'passes' };
  const reading = readBooleanComparand(comparand);
  if (reading === null) {
    // [#21382] Not a spelling: judged by what it IS.
    const form = nonBooleanValueForm(comparand);
    if (form === null) return { verdict: 'passes' };
    return { verdict: 'door-refusal', form, code: 'INVALID_FILTER', status: 400 };
  }
  if (reading.boolean) return { verdict: 'narrows', value: reading.value };
  return { verdict: 'door-refusal', form: reading.form, code: 'INVALID_FILTER', status: 400 };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The refusal words
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What is wrong with the comparand, per form — the clause after "which is not
 * a boolean:". [#21382] Each non-string clause states only what holds at every
 * position: PostgreSQL's server error was measured at `where` alone (the
 * engine evaluates the per-aggregation `filter` and `having` itself), so no
 * clause names a backend.
 */
const FORM_SENTENCE: Readonly<Record<NonBooleanComparandForm, string>> = {
  'empty': 'a blank string names no boolean (to match a missing value, write {"$eq": null}).',
  'padded': 'it carries surrounding whitespace.',
  'letter-case': 'only the lower-case spellings "true" and "false" are read as a boolean.',
  'placeholder': 'a {placeholder} resolves to an id or a date, never to a boolean.',
  'not-a-boolean': 'it has no boolean reading.',
  'number': 'only the numbers 1 and 0 are read as a boolean; no other number names one.',
  'date': 'a Date is an instant, not a boolean; compare a Date with a date or datetime field.',
  'array': 'a list is not one boolean; to match either value use $in, each member a boolean.',
};

/** The consequence and the remedy, after the load-bearing head. */
const BOOLEAN_COMPARAND_REFUSAL_TAIL =
  ' The filter was NOT applied. Write true or false; the strings "true" / "false", 1 / 0 and '
  + '"1" / "0" are read the same.';

/** Where the refused comparand sits, and what the door read there. */
export interface BooleanComparandRefusalSite {
  /** The filter key — a declared field of the object, or (`aggregated`) an aggregated-row column. */
  readonly field: string;
  /**
   * Its declared `type` — or, when {@link BooleanComparandRefusalSite.aggregated}
   * is set, the type the engine derived for the column; the message does not
   * print it for one.
   */
  readonly declaredType: string;
  /** `formula` only — its declared `returnType`. */
  readonly returnType?: string;
  /** The key path of the comparand, e.g. `where.active.$ne` or `where.active.$in[1]`. */
  readonly path: string;
  /** The refused comparand — a string, a number, a `Date` or an array ({@link NonBooleanComparandForm}). */
  readonly value: unknown;
  /** Why it is not a boolean — `door-refusal`'s `form`. */
  readonly form: NonBooleanComparandForm;
  /**
   * `true` when `field` names an AGGREGATED-row column (`having`) rather than a
   * declared field of the object: the message then reads "a boolean aggregated
   * column", never "a declared … field". Default `false`.
   */
  readonly aggregated?: boolean;
}

/**
 * The refusal the door prints, in one place: the field, its declared type, the
 * comparand (bounded), its position, what is wrong with it and the remedy.
 * `context` is the caller prefix the engine's refusals carry (`find('task')`).
 */
export function booleanComparandRefusalMessage(site: BooleanComparandRefusalSite, context?: string): string {
  const subject = site.aggregated
    ? 'a boolean aggregated column'
    : `a declared ${site.returnType === undefined ? `${site.declaredType} field` : `${site.declaredType} field returning ${site.returnType}`}`;
  return (
    `${context ? `${context}: ` : ''}filter on '${site.field}' compares ${subject} against `
    + `${comparandPreview(site.value)} at ${site.path}, which is not a boolean: ${FORM_SENTENCE[site.form]}`
    + BOOLEAN_COMPARAND_REFUSAL_TAIL
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The readings' case table
 * ──────────────────────────────────────────────────────────────────────────── */

/** One row of {@link BOOLEAN_COMPARAND_READING_CASES}. */
export type BooleanComparandReadingCase =
  | { readonly input: unknown; readonly boolean: true; readonly value: boolean; readonly why: string }
  | { readonly input: string; readonly boolean: false; readonly form: NonBooleanStringForm; readonly why: string }
  | { readonly input: unknown; readonly boolean: null; readonly why: string };

const reads = (input: unknown, value: boolean, why: string): BooleanComparandReadingCase =>
  ({ input, boolean: true, value, why });
const refused = (input: string, form: NonBooleanStringForm, why: string): BooleanComparandReadingCase =>
  ({ input, boolean: false, form, why });
const unread = (input: unknown, why: string): BooleanComparandReadingCase =>
  ({ input, boolean: null, why });

/**
 * The readings, row by row — the table the door's suites drive. Each row says
 * why; the module header argues the set.
 */
export const BOOLEAN_COMPARAND_READING_CASES: readonly BooleanComparandReadingCase[] = [
  reads(true, true, 'A boolean is the canonical comparand.'),
  reads(false, false, 'A boolean is the canonical comparand.'),
  reads('true', true, 'The canonical string — a bare query parameter is always a string.'),
  reads('false', false, 'The canonical string — `?flag=false`.'),
  reads(1, true, 'The SQL storage form; the write side admits it.'),
  reads(0, false, 'The SQL storage form; the write side admits it.'),
  reads('1', true, '`?flag=1` — a stringified storage form.'),
  reads('0', false, '`?flag=0` — a stringified storage form.'),
  refused('yes', 'not-a-boolean', 'The card\'s own comparand: no boolean reading.'),
  refused('no', 'not-a-boolean', 'No boolean reading.'),
  refused('on', 'not-a-boolean', 'An HTML checkbox value, not a boolean spelling.'),
  refused('t', 'not-a-boolean', 'A PostgreSQL text form, not one of the accepted spellings.'),
  refused('2', 'not-a-boolean', 'A numeric string other than "1" / "0".'),
  refused('1.0', 'not-a-boolean', 'Only the exact spelling "1" is accepted.'),
  refused('TRUE', 'letter-case', 'One spelling per value: lower case.'),
  refused('False', 'letter-case', 'One spelling per value: lower case.'),
  refused(' true ', 'padded', 'Padding is refused, as the number grammar refuses it.'),
  refused('1\n', 'padded', 'A trailing line break is padding too.'),
  refused('', 'empty', 'A blank names no boolean; the null test is {"$eq": null}.'),
  refused('   ', 'empty', 'Whitespace only.'),
  refused('{current_user_id}', 'placeholder', 'Resolves to a user id, never a boolean.'),
  refused('{today}', 'placeholder', 'Resolves to a YYYY-MM-DD day, never a boolean.'),
  unread(null, 'The null test, not a value to read as a boolean.'),
  unread(2, 'A number other than 1 / 0 is no spelling; the verdict refuses it as a number.'),
  unread(-1, 'A number other than 1 / 0 is no spelling; the verdict refuses it as a number.'),
  unread(0.5, 'A fraction is no spelling; the verdict refuses it as a number.'),
];

/* ────────────────────────────────────────────────────────────────────────────
 * The fixture and the door's derived case table
 * ──────────────────────────────────────────────────────────────────────────── */

/** A field of {@link BOOLEAN_COMPARAND_DOOR_FIXTURE} — a legal `FieldSchema` input. */
export interface BooleanComparandDoorFixtureField {
  readonly name: string;
  readonly type: string;
  /** `formula` — a CEL expression, present so the field is a legal declaration. */
  readonly expression?: string;
  /** `formula` — the declared return type under test, or absent for the deferred row. */
  readonly returnType?: 'boolean' | 'text';
}

/** The fixture object's name. */
export const BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT = 'boolean_door_probe';

/**
 * The fixture: each judged type, a `text` field the door must pass, and a
 * `formula` returning `boolean`, one returning `text` and one with none. Each
 * is a legal `FieldSchema` input (pinned). The neighbour is a class no other
 * field-aware door judges, so a `passes` row is observable at the engine as
 * "the filter reached the driver unchanged" — a `number` or `date` field
 * would be refused `"yes"` by the number or temporal door instead.
 */
export const BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS: readonly BooleanComparandDoorFixtureField[] = [
  ...[...BOOLEAN_VALUE_TYPES].map((type) => ({ name: `f_${type}`, type })),
  { name: 'f_text', type: 'text' },
  { name: 'f_formula_boolean', type: 'formula', expression: 'true', returnType: 'boolean' },
  { name: 'f_formula_text', type: 'formula', expression: '"a"', returnType: 'text' },
  { name: 'f_formula_untyped', type: 'formula', expression: 'true' },
];

/** The fixture object, in the `{ name, fields }` shape `registerObject` takes. */
export const BOOLEAN_COMPARAND_DOOR_FIXTURE = {
  name: BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT,
  label: 'Boolean-comparand door probe',
  fields: Object.fromEntries([
    ['id', { name: 'id', type: 'text' }],
    ...BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS.map((f) => [f.name, f] as const),
  ]) as Readonly<Record<string, BooleanComparandDoorFixtureField>>,
} as const;

interface BooleanComparandDoorCaseBase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /** The filter key under test — a fixture field. */
  readonly key: string;
  /** The field's declared type. */
  readonly declaredType: string;
  /** `formula` only — the declared return type, when present. */
  readonly returnType?: string;
  /** The comparand's position below the key: `f_boolean.$ne`, `f_boolean.$in[1]`, or `f_boolean` (implicit). */
  readonly position: string;
  /** The comparand at that position. */
  readonly comparand: unknown;
  /** Builds the filter under test — a factory, so no suite can edit what another judges. */
  readonly filter: () => FilterCondition;
}

/** A case the door must refuse — before any driver runs. */
export interface BooleanComparandDoorRefusalCase extends BooleanComparandDoorCaseBase {
  readonly verdict: 'door-refusal';
  readonly form: NonBooleanComparandForm;
  /** The ADR-0112 code the refusal must carry … */
  readonly code: 'INVALID_FILTER';
  /** … beside this status. */
  readonly status: 400;
  /** Substrings the message must contain: the key, the declared type, the comparand and its position. */
  readonly mustMention: readonly string[];
}

/** A case the door must rewrite — the accepted spelling replaced by its boolean. */
export interface BooleanComparandDoorNarrowsCase extends BooleanComparandDoorCaseBase {
  readonly verdict: 'narrows';
  readonly value: boolean;
  /** The filter the driver must receive. */
  readonly expectedFilter: () => FilterCondition;
}

/** A case the door neither refuses nor rewrites. */
export interface BooleanComparandDoorPassesCase extends BooleanComparandDoorCaseBase {
  readonly verdict: 'passes';
}

/** A case the door records NO verdict for — a `formula` whose return type is unreadable. */
export interface BooleanComparandDoorDeferredCase extends BooleanComparandDoorCaseBase {
  readonly verdict: 'deferred';
}

export type BooleanComparandDoorCase =
  | BooleanComparandDoorRefusalCase
  | BooleanComparandDoorNarrowsCase
  | BooleanComparandDoorPassesCase
  | BooleanComparandDoorDeferredCase;

/** Where a comparand sits under a key: implicit, one operator, or one member of a list operator. */
type Slot =
  | { readonly kind: 'implicit' }
  | { readonly kind: 'scalar'; readonly op: string }
  | { readonly kind: 'list'; readonly op: string; readonly index: 0 | 1 };

/** The boolean beside the comparand under test in a list operator — always a legal member. */
const LIST_NEIGHBOUR = false;

function slotPosition(key: string, slot: Slot): string {
  if (slot.kind === 'implicit') return key;
  if (slot.kind === 'scalar') return `${key}.${slot.op}`;
  return `${key}.${slot.op}[${slot.index}]`;
}

/**
 * A `{ $field }` reference, a `Date` and an array are mutable: every filter
 * gets its own, so no suite can move another's.
 */
function freshComparand(comparand: unknown): unknown {
  if (comparand instanceof Date) return new Date(comparand.getTime());
  if (Array.isArray(comparand)) return comparand.map(freshComparand);
  if (typeof comparand === 'object' && comparand !== null) return { ...comparand };
  return comparand;
}

function filterAt(key: string, slot: Slot, given: unknown): FilterCondition {
  const comparand = freshComparand(given);
  if (slot.kind === 'implicit') return { [key]: comparand } as FilterCondition;
  if (slot.kind === 'scalar') return { [key]: { [slot.op]: comparand } } as FilterCondition;
  const list = slot.index === 0 ? [comparand, LIST_NEIGHBOUR] : [LIST_NEIGHBOUR, comparand];
  return { [key]: { [slot.op]: list } } as FilterCondition;
}

/** Does the door judge this slot at all? A flag operator's comparand is never handed to it. */
function isJudgedSlot(slot: Slot): boolean {
  if (slot.kind !== 'scalar') return true;
  return (BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS as readonly string[]).includes(slot.op);
}

/** The five groups of {@link BOOLEAN_COMPARAND_DOOR_CASES}, which also prefix each case name. */
type CaseGroup = 'census' | 'position' | 'reading' | 'unjudged' | 'value';

function caseFor(
  group: CaseGroup,
  field: BooleanComparandDoorFixtureField,
  slot: Slot,
  comparand: unknown,
): BooleanComparandDoorCase {
  const verdict: BooleanComparandDoorVerdict = isJudgedSlot(slot)
    ? booleanComparandDoorVerdict(field, comparand)
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

const fixtureField = (name: string): BooleanComparandDoorFixtureField =>
  BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS.find((f) => f.name === name)!;

/** Every position the door judges: implicit, each scalar operator, each list operator's two members. */
const JUDGED_SLOTS: readonly Slot[] = [
  { kind: 'implicit' },
  ...BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS.map((op): Slot => ({ kind: 'scalar', op })),
  ...BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS.flatMap((op): Slot[] => [
    { kind: 'list', op, index: 0 },
    { kind: 'list', op, index: 1 },
  ]),
];

/** The `Date` the `value` rows compare with — any instant; a filter holds a copy of it. */
const VALUE_DATE = new Date(Date.UTC(2026, 0, 1));

/** The list the `value` rows put where one value belongs — itself a list of a legal member. */
const VALUE_LIST: readonly boolean[] = [true];

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
 * 1. **The type census** — every fixture field, `$eq` against `"yes"` and
 *    against `"true"`: refused and narrowed on the boolean class (and `formula`
 *    returning `boolean`), passed everywhere else, deferred on the untyped
 *    `formula`.
 * 2. **The positions** — every judged position on `f_boolean`, four ways: a
 *    refused string, the canonical string, a stringified storage form, and a
 *    boolean (passes).
 * 3. **The readings** — every {@link BOOLEAN_COMPARAND_READING_CASES} row at
 *    `$eq` on `f_boolean`.
 * 4. **The unjudged positions** — `$null`, `$exists`, `$empty` and a
 *    `{ $field }` reference on `f_boolean` pass.
 * 5. **The non-string comparands** ([#21382]) — `-1` at `$ne` on every judged
 *    field; `2` and a `Date` at every judged position on `f_boolean`, and an
 *    array at every list member (a one-value slot is the shape door's); all
 *    refused. Beside them, what passes: `null` as the null test, and a number
 *    or a `Date` against a field that is not boolean — not this door's subject.
 */
export const BOOLEAN_COMPARAND_DOOR_CASES: readonly BooleanComparandDoorCase[] = [
  ...BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS.flatMap((field) => [
    caseFor('census', field, { kind: 'scalar', op: '$eq' }, 'yes'),
    caseFor('census', field, { kind: 'scalar', op: '$eq' }, 'true'),
  ]),
  ...JUDGED_SLOTS.flatMap((slot) => [
    caseFor('position', fixtureField('f_boolean'), slot, 'yes'),
    caseFor('position', fixtureField('f_boolean'), slot, 'true'),
    caseFor('position', fixtureField('f_boolean'), slot, '0'),
    caseFor('position', fixtureField('f_boolean'), slot, true),
  ]),
  ...BOOLEAN_COMPARAND_READING_CASES.map((row) =>
    caseFor('reading', fixtureField('f_boolean'), { kind: 'scalar', op: '$eq' }, row.input)),
  caseFor('unjudged', fixtureField('f_boolean'), { kind: 'scalar', op: '$null' }, true),
  caseFor('unjudged', fixtureField('f_boolean'), { kind: 'scalar', op: '$exists' }, false),
  caseFor('unjudged', fixtureField('f_boolean'), { kind: 'scalar', op: '$empty' }, true),
  caseFor('unjudged', fixtureField('f_boolean'), { kind: 'scalar', op: '$eq' }, { $field: 'f_toggle' }),
  ...BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS
    .filter((field) => booleanComparandFieldVerdict(field) === 'judged')
    .map((field) => caseFor('value', field, { kind: 'scalar', op: '$ne' }, -1)),
  ...JUDGED_SLOTS.flatMap((slot) => [
    caseFor('value', fixtureField('f_boolean'), slot, 2),
    caseFor('value', fixtureField('f_boolean'), slot, VALUE_DATE),
    ...(isOneValueSlot(slot) ? [] : [caseFor('value', fixtureField('f_boolean'), slot, VALUE_LIST)]),
  ]),
  caseFor('value', fixtureField('f_boolean'), { kind: 'implicit' }, null),
  caseFor('value', fixtureField('f_boolean'), { kind: 'scalar', op: '$ne' }, null),
  caseFor('value', fixtureField('f_text'), { kind: 'scalar', op: '$eq' }, 2),
  caseFor('value', fixtureField('f_text'), { kind: 'scalar', op: '$ne' }, VALUE_DATE),
];
