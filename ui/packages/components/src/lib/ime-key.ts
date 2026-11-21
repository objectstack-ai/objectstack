/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A key the input method owns: pressed while a composition is open
 * (`isComposing`, keyCode 229), or the 229 a browser reports for the key that
 * ends one (Safari raises the candidate-picking Enter AFTER `compositionend`,
 * with `isComposing` already false and keyCode 229). Enter, Esc, Tab, the
 * comma, the arrows and Backspace pressed then pick, type or move a candidate
 * inside the input method; a control that reads those keys itself must leave
 * them alone and act on the next key after the composition ends.
 *
 * The ONE definition of this question (objectstack#35996). The list grid
 * (`data-table`) and every widget in `@object-ui/fields` that reads its own
 * keys ask it, so a fix to it reaches all of them at once.
 */
export function isImeKey(e: { nativeEvent: KeyboardEvent; keyCode?: number }): boolean {
  return e.nativeEvent.isComposing === true || e.nativeEvent.keyCode === 229 || e.keyCode === 229;
}
