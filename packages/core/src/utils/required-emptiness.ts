// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24131] THE emptiness rule a `required` declaration is judged by — one rule,
 * read by every door that refuses a missing required value.
 *
 * ## Two faces, one rule
 *
 * - `@objectstack/objectql`'s record validator judges an object field's
 *   `required` with it on every insert, and a PATCH that clears a required
 *   field (`required_cleared`).
 * - `@objectstack/rest`'s anonymous public-form submit door judges the FORM's
 *   own `required` (a form-field entry's `required: true`) with it before the
 *   write, so a field the form requires and the object does not is refused in
 *   the same words the object-level refusal uses.
 *
 * `@objectstack/rest` does not depend on the engine at runtime (the
 * `check:undeclared-dep-imports` ledger records why), and a copy each is how
 * one value comes to be "missing" at one door and "present" at the other — the
 * whitespace-only string and the empty list are the two cells a hand-written
 * check drops. So the rule lives here, where both already depend, beside the
 * other value-level rules those two packages share
 * (`multi-value-storage-form.ts`). It moved out of `record-validator.ts`
 * unchanged.
 *
 * ## The rule
 *
 * - {@link isMissing}: `undefined`, `null`, and a string that is empty or only
 *   whitespace. Def-free.
 * - {@link isEmptyForRequired}: everything {@link isMissing} calls missing, and
 *   — only where the DECLARED value is a set (`@objectstack/spec/data`'s
 *   `isMultiValueField`, ADR-0104 D1) — an empty list. The #9447 maintainer
 *   ruling sets that half: `required` on a multi-value field means a NON-EMPTY
 *   list, because the empty set is representable (it reads back as `[]`, never
 *   `null`), so an explicit `[]` is an empty value exactly as `null` / `''`
 *   are. A structured-JSON field's `[]` is a legitimate document, not an
 *   emptied set, and is NOT empty here.
 *
 * ⛔ What a door does with "missing" is the door's: the engine skips a
 * runtime-owned `autonumber`, the form door judges only the entries the visitor
 * is asked to fill. Neither belongs in this rule, and neither is a reason for a
 * second copy of it.
 */

import { isMultiValueField, type ValueShapeFieldDef } from '@objectstack/spec/data';

/**
 * Whether a value is missing: `undefined`, `null`, or a string that is empty
 * or only whitespace. The def-free half of {@link isEmptyForRequired}.
 */
export function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * Whether a value leaves a `required` field empty — {@link isMissing}, plus an
 * empty list on a field whose declared value is a set. Judged against the
 * field's DECLARATION (`type`, `multiple`), never against the value's shape.
 */
export function isEmptyForRequired(def: ValueShapeFieldDef, value: unknown): boolean {
  if (isMissing(value)) return true;
  return isMultiValueField(def) && Array.isArray(value) && value.length === 0;
}
