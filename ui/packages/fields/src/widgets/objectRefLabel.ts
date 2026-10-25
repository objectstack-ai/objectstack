/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An object's name as the `object-ref` picker spells it, `Label (name)`, or the
 * bare name when the object has no label (objectui#12613). `ObjectRefField`
 * labels each option with it, and the console's read face for the field
 * (`@object-ui/app-shell`'s widget reference cells) uses it for its tooltip, so
 * the two faces spell an object one way. Published from the package barrel for
 * that reader. No React here.
 */
export function objectRefOptionLabel(name: string, label: string | undefined): string {
  return label ? `${label} (${name})` : name;
}
