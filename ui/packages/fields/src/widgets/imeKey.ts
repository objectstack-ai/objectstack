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
 * with `isComposing` already false and keyCode 229). Enter, the comma, the
 * arrows and Backspace pressed then pick, type or move a candidate inside the
 * input method; a widget that reads those keys itself must leave them alone
 * and act on the next key after the composition ends.
 *
 * The one predicate every widget in this package that reads its own keys asks
 * (`TagsField`, and the search boxes of `LookupField` and `PeoplePicker`), so
 * they cannot drift into three answers. It is package-internal on purpose:
 * nothing re-exports it from this package's entry.
 *
 * ⚠️ It has one twin outside this package: `isImeKey` in
 * `@object-ui/components` (`renderers/complex/dataTableCellSelection.ts`),
 * the list grid's own key guard. That one is not on the components entry,
 * and importing it here would add an export to a published entry, so this is
 * a second definition of the same question. A change to one is a change to
 * both; nothing checks that the two still agree.
 */
export function isImeKey(e: { nativeEvent: KeyboardEvent; keyCode?: number }): boolean {
  return e.nativeEvent.isComposing === true || e.nativeEvent.keyCode === 229 || e.keyCode === 229;
}
