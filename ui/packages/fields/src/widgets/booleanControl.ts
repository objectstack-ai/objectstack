/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which two-state control a boolean field draws: the ONE type-to-widget map
 * every surface reads, so the Studio canvas and the runtime form cannot
 * disagree about the same field.
 *
 * `@objectstack/spec` declares `boolean` and `toggle` as two field types
 * ("Toggle is a distinct UI from checkbox", `FieldType` in
 * `data/field.zod.ts`), and Studio's type picker promises the difference:
 * "Yes or no, shown as a checkbox." for `boolean`, "Yes or no, shown as a
 * switch." for `toggle`. Both resolve to the one `field:boolean` widget
 * (`mapFieldTypeToFormType`), which used to draw a switch unless the field
 * carried `widget: 'checkbox'`, so the authored `boolean` was dropped on
 * every form, and the canvas drew its own pill for `boolean` and a text box
 * for `toggle`.
 *
 * The answer, in precedence order:
 *
 *  1. an explicit `widget` naming a boolean face wins over the type default:
 *     `checkbox` / `boolean` draw a checkbox, `switch` / `toggle` a switch.
 *     `checkbox` and `switch` are the form's two built-in control names
 *     (`renderFieldComponent`'s own arms, and the spelling `paramToField` and
 *     `ScreenView` stamp); the two spec type names read the same way, so a
 *     widget naming a type means that type's face;
 *  2. otherwise the field's `type`, read through the same four names: `toggle`
 *     draws a switch, `boolean` a checkbox;
 *  3. anything else that reaches a boolean widget (the bare `field:boolean` id
 *     of a hand-authored form entry, a missing type) draws a checkbox, the
 *     `boolean` type's own face.
 *
 * Any other `widget` value is not a boolean face and does not decide here: a
 * widget the form cannot draw degrades to the `type` renderer (the spec's
 * `FieldSchema.widget` contract), so the type answers.
 */
export type BooleanControl = 'checkbox' | 'switch';

const BOOLEAN_FACES: Readonly<Record<string, BooleanControl>> = {
  checkbox: 'checkbox',
  boolean: 'checkbox',
  switch: 'switch',
  toggle: 'switch',
};

function faceOf(name: unknown): BooleanControl | undefined {
  if (typeof name !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(BOOLEAN_FACES, name) ? BOOLEAN_FACES[name] : undefined;
}

export function resolveBooleanControl(
  field: { type?: unknown; widget?: unknown } | null | undefined,
): BooleanControl {
  return faceOf(field?.widget) ?? faceOf(field?.type) ?? 'checkbox';
}
