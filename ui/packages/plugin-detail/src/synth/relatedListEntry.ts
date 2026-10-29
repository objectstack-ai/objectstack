/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Does one related-list entry name this list (objectstack#27069)? The entry
 * is an `ObjectSchema.relatedLists` item or a field group's `relatedList`, as
 * `@objectstack/spec` spells both: a bare child object name names every list
 * of that child; `object.field` names the one FK.
 *
 * The ONE reading of an entry. It lives here, below the console, because the
 * synthesized record page reads it (`bodyTablePlacement`, the field group
 * that places a body table); app-shell's related-list order and the Studio
 * editors that author entries import it from this package.
 */
export function relatedListEntryNames(
  entry: string,
  list: { childObject: string; referenceField: string },
): boolean {
  const dot = entry.indexOf('.');
  if (dot === -1) return list.childObject === entry;
  return list.childObject === entry.slice(0, dot) && list.referenceField === entry.slice(dot + 1);
}
