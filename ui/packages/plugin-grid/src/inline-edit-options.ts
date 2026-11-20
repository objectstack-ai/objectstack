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
import { isExpressionComputedField } from '@object-ui/core';

/**
 * For a field governed by a blocking `state_machine` validation, the values
 * reachable from the current one. The helper lives in `@object-ui/core` so the
 * record form and the board read the same transition map the same way
 * (#25933); it is re-exported here so the grid's import stays as it was.
 */
export { stateMachineNextValues } from '@object-ui/core';

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
const COMPUTED_FIELD_TYPES = new Set<string>(['formula', 'summary', 'rollup', 'autonumber', 'auto_number']);
const NON_EDITABLE_FIELD_TYPES = new Set<string>([
  // computed / system-generated
  ...COMPUTED_FIELD_TYPES,
  // binary / attachment
  'file', 'image', 'avatar', 'video', 'audio', 'signature',
]);

/**
 * Why a field is not edited in place (objectstack#35684), or `null` when it
 * is: `readonly` (declared so), `computed` (an expression, a formula, a
 * summary, an auto number) or `notInline` (a file, or a type the fields
 * package keeps out of a cell). The reasons {@link isFieldInlineEditable}
 * answers `false` for, told apart so a cell can say which.
 */
export function fieldInlineReadOnlyKind(
  fieldDef: { type?: unknown; readonly?: unknown } | null | undefined,
): 'readonly' | 'computed' | 'notInline' | null {
  if (!fieldDef) return null;
  if (fieldDef.readonly === true) return 'readonly';
  if (isExpressionComputedField(fieldDef)) return 'computed';
  if (typeof fieldDef.type !== 'string') return null;
  if (COMPUTED_FIELD_TYPES.has(fieldDef.type)) return 'computed';
  return NON_EDITABLE_FIELD_TYPES.has(fieldDef.type) || isInlineExcludedFieldType(fieldDef.type) ? 'notInline' : null;
}

/**
 * Whether a field may be edited in place in the grid. False for explicitly
 * `readonly` fields, for inherently computed / binary types (see
 * {@link NON_EDITABLE_FIELD_TYPES}), for a field of any type carrying an
 * `expression` (`isExpressionComputedField`: the engine computes and stores
 * it on every write, so a typed value never stands — objectstack#31759), and
 * for every type the fields package
 * excludes from inline editing (`isInlineExcludedFieldType` — alias-aware,
 * so `composite` → `object`, `repeater` → `grid` are read-only cells, never
 * a plain text box). A null/unknown field is treated as editable so the
 * grid's own `editable` flag still governs.
 */
export function isFieldInlineEditable(
  fieldDef: { type?: unknown; readonly?: unknown } | null | undefined,
): boolean {
  return fieldInlineReadOnlyKind(fieldDef) === null;
}
