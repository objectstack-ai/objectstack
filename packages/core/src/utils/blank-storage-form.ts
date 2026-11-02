// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE blank-as-null rule — which columns of an object store a blank as
 * `null`, and which blanks — read by the write door that stores it and by the
 * seed loader's replay, which must compare a seed value in the form the door
 * stores it.
 *
 * ## Two faces, one rule
 *
 * - `@objectstack/objectql`'s write door (`normalizeBlankTypedValues`) applies
 *   it to every insert and update payload before anything else reads it.
 * - `@objectstack/metadata-protocol`'s seed loader asks it in `isNoOpReplay`
 *   (the `blankAsNull` replay comparand): a seed writing `''` on such a column
 *   lands as `null`, and compared as written it read the row as changed and
 *   rewrote it on every boot (#29277; the #20308 and #29176 arms churned the
 *   same way before it).
 *
 * The two packages do not depend on each other, and a copy each is how a
 * replay comes to disagree with the store. So the rule lives here, beside
 * `multiValueStorageForm` and `temporalStorageForm`, which are shared for the
 * same reason. The type classes and the `$empty` table it reads are the
 * spec's, never re-listed.
 *
 * ## The rule — four arms
 *
 * - [#20308] `'blank'`: a column whose type is non-string-typed
 *   (`NON_TEXT_STORED_VALUE_TYPES`: numeric, boolean, `date`, `datetime`,
 *   `time`) stores any blank (`isMissing`: `''` or whitespace) as `null` —
 *   required or not, lifecycle or not: a blank is never a value of its type.
 * - [#29176] `'empty'`: exactly `''` on an optional text-like column
 *   (`STRING_VALUE_TYPES` minus `password` / `secret`) a unique constraint
 *   covers — its own `unique`, or a unique `indexes[]` entry, both read through
 *   `isUniqueDeclared`, the drivers' own predicate.
 * - [#29277] `'empty'`: exactly `''` on an optional column on the `$empty`
 *   table's `null_only` row (`expandEmptyOperator`) whose value is ONE string
 *   ({@link ONE_STRING_STORED_TYPES}), unique or not (maintainer ruling B on
 *   #29346, record 6579813296).
 * - [#29343] `'emptyList'`: the empty list `[]`, or exactly `''`, on an
 *   optional column on the `$empty` table's `multi_value` row (a list-valued
 *   column: `isMultiValueField`, read through `expandEmptyOperator`), unique
 *   or not — the same ruling's execution step 2, which has this row follow
 *   the table for `[]` the way the `null_only` arm follows it for `''`. A
 *   stored `[]` collided under every NULL-distinct unique constraint as the
 *   JSON text `'[]'`, and `''` (never a member: `multiValueStorageForm` leaves
 *   a blank unwrapped) as the JSON text `'""'`.
 *
 * The `'empty'` and `'emptyList'` arms never reach a `required: true` column
 * (there the blank is refused `required`, and must not first become a `null`
 * a `defaultValue` would fill) nor a lifecycle column the engine owns
 * ({@link ENGINE_LIFECYCLE_COLUMNS}), and never whitespace (a value on every
 * row of the `$empty` table they touch). A non-empty list is never touched.
 */

import {
  NON_TEXT_STORED_VALUE_TYPES,
  STRING_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  REFERENCE_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  expandEmptyOperator,
  isUniqueDeclared,
  type ValueShapeFieldDef,
} from '@objectstack/spec/data';
import { isMissing } from './required-emptiness.js';

/**
 * Lifecycle columns the engine always owns and the client never supplies,
 * skipped by NAME because they are not author-declared business fields. The
 * write door's validator skips the same names (its `SKIP_FIELDS` is this list).
 */
export const ENGINE_LIFECYCLE_COLUMNS: readonly string[] = Object.freeze([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
]);
const LIFECYCLE: ReadonlySet<string> = new Set(ENGINE_LIFECYCLE_COLUMNS);

/**
 * [#29176] The text-like types of the unique arm: the spec's
 * `STRING_VALUE_TYPES` — exactly the "text-like" row of the `$empty` table,
 * where `''` and `null` already answer as one — minus the two credential
 * types. ⛔ `password` and `secret` stay out: a maintainer ruling refuses `''`
 * on them (`EmptyCredentialWriteError`) while `null` means "clear", so
 * rewriting the blank would turn that refusal into a silent clear.
 */
const UNIQUE_BLANK_TEXT_TYPES: ReadonlySet<string> = new Set(
  [...STRING_VALUE_TYPES].filter((t) => t !== 'password' && t !== 'secret'),
);

/**
 * [#29277] The storage-shape half of the `null_only` arm: the spec's value
 * classes whose single value IS one string — an option code
 * (`SINGLE_OPTION_TYPES`), a record id (`REFERENCE_VALUE_TYPES`), an opaque
 * `sys_file` id (`FILE_REFERENCE_TYPES`; SQL stores it JSON-encoded, still one
 * string to every reader). Read as the spec's constants, never re-listed. The
 * spec has no predicate for "stores one string", so this set is stated here,
 * and `record-validator.single-value-blank.test.ts` (`@objectstack/objectql`)
 * ties it to the table: every type on the `null_only` row that is not typed
 * must be in this set or in one of the two classes left out below, so a type
 * that joins the row unclassified turns that pin red.
 *
 * Left out, each measured on SQLite through the engine:
 *
 *  - `STRUCTURED_JSON_TYPES` (`json`, `composite`, `record`, `location`,
 *    `address`, `repeater`, `vector`): the value is an object or an array, so
 *    `''` is not a blank of its shape. What empty means for them is a
 *    separate question.
 *  - `COMPUTED_VALUE_TYPES` (`formula`, `autonumber`; `summary` is typed): the
 *    engine owns the value — a formula is never stored, an autonumber is
 *    issued on insert whatever the caller sent, `''` included.
 */
const ONE_STRING_STORED_TYPES: ReadonlySet<string> = new Set([
  ...SINGLE_OPTION_TYPES,
  ...REFERENCE_VALUE_TYPES,
  ...FILE_REFERENCE_TYPES,
]);

/**
 * Which blanks a column stores as `null`: `'blank'` — any blank string
 * (`isMissing`); `'empty'` — exactly `''`; `'emptyList'` — the empty list
 * `[]` or exactly `''` (a list-valued column).
 */
export type BlankAsNullReach = 'blank' | 'empty' | 'emptyList';

/** The field shape the rule reads. */
export interface BlankAsNullFieldDef extends ValueShapeFieldDef {
  required?: boolean;
  unique?: unknown;
}

/**
 * The columns of one object whose blank the write door stores as `null`, each
 * with its reach. A column not in the map keeps every blank as written.
 */
export function blankAsNullColumns(
  objectSchema: { fields?: Record<string, BlankAsNullFieldDef | undefined>; indexes?: unknown } | undefined | null,
): ReadonlyMap<string, BlankAsNullReach> {
  const out = new Map<string, BlankAsNullReach>();
  const fields = objectSchema?.fields;
  if (!fields || typeof fields !== 'object') return out;
  let covered: Set<string> | undefined;
  const isCovered = (name: string) => (covered ??= uniqueCoveredColumns(fields, objectSchema?.indexes)).has(name);
  for (const [name, def] of Object.entries(fields)) {
    if (!def || typeof def.type !== 'string') continue;
    if (NON_TEXT_STORED_VALUE_TYPES.has(def.type)) {
      out.set(name, 'blank');
      continue;
    }
    if (LIFECYCLE.has(name) || def.required === true) continue;
    const { arm } = expandEmptyOperator(def);
    if (arm === 'multi_value') {
      out.set(name, 'emptyList');
      continue;
    }
    const empty = UNIQUE_BLANK_TEXT_TYPES.has(def.type)
      ? isCovered(name)
      : arm === 'null_only' && ONE_STRING_STORED_TYPES.has(def.type);
    if (empty) out.set(name, 'empty');
  }
  return out;
}

/**
 * The form a value written to a column of the given reach is stored in:
 * `null` when the value is a blank that reach takes, else the value itself
 * (the same reference). `reach` `undefined` — a column not in
 * {@link blankAsNullColumns} — keeps every value.
 */
export function blankStorageForm(value: unknown, reach: BlankAsNullReach | undefined): unknown {
  if (reach === 'emptyList') return value === '' || (Array.isArray(value) && value.length === 0) ? null : value;
  if (reach === undefined || typeof value !== 'string') return value;
  if (reach === 'empty') return value === '' ? null : value;
  return isMissing(value) ? null : value;
}

function uniqueCoveredColumns(fields: Record<string, BlankAsNullFieldDef | undefined>, indexes: unknown): Set<string> {
  const covered = new Set<string>();
  for (const [name, def] of Object.entries(fields)) {
    if (def && isUniqueDeclared(def.unique)) covered.add(name);
  }
  if (Array.isArray(indexes)) {
    for (const idx of indexes) {
      if (!idx || typeof idx !== 'object' || Array.isArray(idx)) continue;
      const { unique, fields: members } = idx as { unique?: unknown; fields?: unknown };
      if (!isUniqueDeclared(unique) || !Array.isArray(members)) continue;
      for (const name of members) if (typeof name === 'string') covered.add(name);
    }
  }
  return covered;
}
