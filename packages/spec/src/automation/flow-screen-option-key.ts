// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-screen-option-key
 *
 * **How a screen field's option is addressed as text** — the one key function
 * its translation face, its translator, its parse refusal, the reference lint
 * and the i18n extractor all read.
 *
 * A screen field's option declares `value: z.unknown()`
 * (`ScreenFieldConfigSchema.options[]`), so a value may be a string, a number,
 * a boolean or anything else the author wrote. Its label translation lives
 * under `flows.<flow>.screens.<node_id>.fields.<field>.options.<key>`, and a
 * JSON object key is text, so the option is addressed by its value COERCED TO
 * A STRING: `String(value)`. That is the console's own identity for the same
 * option — the screen dialog's select keys each item by `String(o.value)` —
 * and the coercion `translateAction` already applies to an action param's
 * inline options (`params.<name>.options.<value>`), so the face keeps one
 * convention rather than gaining a second.
 *
 * ⛔ Not by position. A positional key would silently re-point every
 * translation the day an author reorders or inserts an option: the bundle
 * still parses, and the wrong label renders.
 *
 * Coercion can make two options one key: `1` and `"1"`, `true` and `"true"`.
 * Such a field is refused at parse (`ScreenFieldConfigSchema`), at the second
 * of the pair, because neither its translation nor the console's select can
 * tell the two apart. So within one field this function is injective by
 * contract, and a translation names exactly one option.
 */

/**
 * The text an option of a screen field is addressed by — its value coerced to
 * a string (`String(value)`). See the module header for why, and for the parse
 * refusal that keeps two options of one field from sharing a key.
 */
export function flowScreenFieldOptionKey(value: unknown): string {
  return String(value);
}
