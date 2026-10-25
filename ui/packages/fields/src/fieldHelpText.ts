/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BaseFieldMetadata } from '@object-ui/types';

/**
 * The help line a field draws under its control: the ONE read of a field
 * definition's help text (objectui#12213). The order lives here and nowhere
 * else, and both of its readers call this function:
 *
 *   - `@object-ui/plugin-form`, for the record form's help line. `ObjectForm`'s
 *     field builder and `fromObjectSchema` both call it, so the flat, sectioned
 *     and tabbed forms cannot drift apart.
 *   - `resolveActionParam` in this package, for a field-backed action param
 *     that declares no `helpText` of its own.
 *
 * First non-empty value wins:
 *
 *   1. `inlineHelpText`, `@objectstack/spec`'s `FieldSchema.inlineHelpText`
 *      ("Help text displayed below the field in forms"). Studio's object field
 *      inspector writes it, and flow screens draw it in the same place.
 *   2. `description`, the fallback the form always had. An objectstack server
 *      on `@objectstack/spec` 17.7.0 or later serves a field's translated help
 *      text here.
 *
 * ## `||`, not `??`
 *
 * An empty string reads as absent, so `inlineHelpText: ''` falls back to the
 * description instead of hiding it. The spec declares no setting that hides
 * the help line, and Studio's inspector stores a cleared box as no key at all
 * (`inlineHelpText: v || undefined`). With `??`, an empty string would become
 * a second, undeclared way to suppress the description.
 *
 * ## `help` is not read
 *
 * `FieldSchema` refuses `help` by name and suggests `inlineHelpText`, so no
 * document that passes the write door carries it. Its one producer was an
 * objectstack server older than `@objectstack/spec` 17.7.0, whose translator
 * put a field's translated description on the served field's `help` key;
 * 17.7.0 serves that text on `description`. The read of that served leg is
 * retired (the ruling on objectui#12213): translated field help needs an
 * objectstack server on spec 17.7.0 or later. A definition that still carries
 * `help` draws its `inlineHelpText`, else its `description`, else nothing.
 */
export function fieldHelpText(
  field: Pick<BaseFieldMetadata, 'inlineHelpText' | 'description'>,
): string | undefined {
  return field.inlineHelpText || field.description || undefined;
}
