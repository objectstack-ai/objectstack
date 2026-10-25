/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The key a HOST writes onto a long-text widget's `field` carrier at runtime —
 * wider than the shape an author may WRITE, on purpose (objectui#12242,
 * maintainer ruling A, under AGENTS.md #0.1 and the objectui#6356 pattern).
 *
 * `mobile_fullscreen` is a projection of the FORM-level setting
 * `ObjectFormSchema.mobile.fullscreenLongText`. Its one producer is
 * `ObjectForm` (`@object-ui/plugin-form`), which stamps it onto the carrier
 * the form renderer hands each long-text widget (`f.field || f`) while it
 * builds the form. Its consumers are `TextAreaField` and `RichTextField` here,
 * which read it off `field` and nowhere else (objectui#3245), and the form
 * renderer's built-in `textarea` branch in `@object-ui/components`, which
 * reads it off its own props. Nobody authors it: `@objectstack/spec`'s
 * `FieldSchema` refuses the key by name, so no published object can carry it,
 * and `@object-ui/types`' field metadata types no longer declare it.
 *
 * ⛔ Deliberately NOT exported from this package's index, and ⛔ never to be
 * added back to `@object-ui/types`: the authoring face refuses the key, and a
 * public type naming it would invite the spelling that face refuses.
 */
export interface LongTextCarrierHandoff {
  /**
   * Draw the fullscreen-edit affordance (an "expand" button opening a
   * full-height dialog) beside the inline editor. Absent when the form did
   * not opt in.
   */
  mobile_fullscreen?: boolean;
}
