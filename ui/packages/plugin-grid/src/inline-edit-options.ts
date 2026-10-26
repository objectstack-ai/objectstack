/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Helpers for constraining an inline cell editor's choices to what the data
 * layer would actually accept — so the editor can't stage an edit the server
 * is bound to reject.
 */

import { isInlineExcludedFieldType } from '@object-ui/fields';

/**
 * For a field governed by a `state_machine` validation, the set of values
 * reachable from `currentValue` — the current value itself plus its declared
 * allowed transitions.
 *
 * Returns `null` (= "don't constrain the options") when:
 *  - the object has no `state_machine` validation for the field, or
 *  - the current state isn't declared in the transition map.
 *
 * The second case mirrors the validation engine's lenient "allow" for
 * undeclared from-states (an unconstrained state simply isn't policed), so the
 * editor stays permissive exactly where the server would.
 */
export function stateMachineNextValues(
  objectSchema: unknown,
  fieldName: string,
  currentValue: unknown,
): Set<string> | null {
  const rules = (objectSchema as { validations?: unknown })?.validations;
  if (!Array.isArray(rules)) return null;
  const sm = rules.find(
    (r): r is { transitions: Record<string, string[]> } =>
      !!r &&
      typeof r === 'object' &&
      (r as { type?: unknown }).type === 'state_machine' &&
      (r as { field?: unknown }).field === fieldName &&
      !!(r as { transitions?: unknown }).transitions,
  );
  if (!sm) return null;
  const from = currentValue == null ? '' : String(currentValue);
  const allowed = sm.transitions[from];
  if (!Array.isArray(allowed)) return null; // undeclared from-state → unconstrained
  return new Set<string>([from, ...allowed.map((s) => String(s))]);
}

/**
 * Field types that can never be edited as a value in an inline cell:
 *  - computed / system-generated — the value is derived, not authored, so an
 *    edit is meaningless (and would be discarded or rejected);
 *  - binary / attachment — there is no text/inline control for a file's bytes.
 *
 * Without this gate the grid falls back to a plain text box for these (you
 * could type into a Formula or File cell), which is wrong. Structured types
 * (`json`, `composite`, `record`, `repeater`, `tree`, …) are not listed here
 * because the FIELDS package owns their decision — `isFieldInlineEditable`
 * also consults its alias-aware exclusion contract below (#2942); before
 * that, a `composite` cell degraded to a plain text editor, a
 * value-corruption path.
 */
const NON_EDITABLE_FIELD_TYPES = new Set<string>([
  // computed / system-generated
  'formula', 'summary', 'rollup', 'autonumber', 'auto_number',
  // binary / attachment
  'file', 'image', 'avatar', 'video', 'audio', 'signature',
]);

/**
 * Whether a field may be edited in place in the grid. False for explicitly
 * `readonly` fields, for inherently computed / binary types (see
 * {@link NON_EDITABLE_FIELD_TYPES}), and for every type the fields package
 * excludes from inline editing (`isInlineExcludedFieldType` — alias-aware,
 * so `composite` → `object`, `repeater` → `grid` are read-only cells, never
 * a plain text box). A null/unknown field is treated as editable so the
 * grid's own `editable` flag still governs.
 */
export function isFieldInlineEditable(
  fieldDef: { type?: unknown; readonly?: unknown } | null | undefined,
): boolean {
  if (!fieldDef) return true;
  if (fieldDef.readonly === true) return false;
  if (typeof fieldDef.type !== 'string') return true;
  return !NON_EDITABLE_FIELD_TYPES.has(fieldDef.type) && !isInlineExcludedFieldType(fieldDef.type);
}
