/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resolve the colour a record's value stands for, off the field's own metadata.
 *
 * ## Why this is shared (objectui#7243)
 *
 * `colorField` is one authored key — `gantt.colorField`, `calendar.colorField`,
 * `timeline.colorField` — and it used to mean three different things:
 *
 *   - `plugin-timeline` resolved the field's option `color` (correct);
 *   - `plugin-calendar` passed the raw value on to a deterministic hash, so the
 *     colour the author declared on the option was never consulted;
 *   - `plugin-gantt` passed the raw value straight into `backgroundColor`, so
 *     `colorField: 'status'` emitted `backgroundColor: "open"` — not a colour.
 *     The browser dropped the declaration and every bar rendered identically,
 *     which made DECLARING the documented key strictly worse than omitting it.
 *
 * The timeline's resolver is lifted here verbatim so all three answer the same
 * question the same way. What lives here is the part that is genuinely common —
 * the two rungs that depend only on the field metadata and the stored value:
 *
 *   1. the field's own option `color` for that value;
 *   2. the value itself when it already IS a CSS colour literal.
 *
 * The LAST rung deliberately stays with each caller, because each one has a
 * different right answer for "a value that is neither": the gantt derives a
 * semantic token hex (a bar must be painted), the calendar hashes onto its
 * theme-aware 8-stop class palette (a soft tint, not a solid fill), and the
 * timeline draws its default marker variant. Pulling those together would be a
 * repaint of existing views, not a bug fix.
 *
 * ## Keyed by option `value` only
 *
 * Deliberately NOT `buildOptionColorMap` (`./chart-series.ts`), which keys by
 * value AND display label: that one reads dataset ROWS, where the server may
 * have resolved a select dimension to its label. These callers read RECORDS,
 * where `record[colorField]` is the stored value. Keying by label as well would
 * colour a record whose stored value happens to collide with another option's
 * label — a tolerance nothing here needs, and one the timeline never had.
 */

/** One entry of a select-like field's `options`, as far as colour is concerned. */
export interface FieldColorOption {
  value?: unknown;
  color?: unknown;
}

/** The slice of a field definition this resolver reads. */
export interface FieldColorDefinition {
  options?: unknown;
}

/**
 * Colour literals the renderers accept as-is.
 *
 * Hex accepts 3, 6 and 8 digits. The timeline's private regex accepted 3 and 6;
 * `plugin-calendar`'s accepted 3, 6 and 8 — two in-repo spellings of the same
 * question, and the narrow one is the only one under which a VALID CSS colour
 * (`#rrggbbaa`) could fall past this rung and be replaced by a derived colour.
 * Widening can only turn "not recognised" into "the author's colour"; it can
 * never turn a colour into something else. So the wider spelling wins.
 */
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Does this string already name a colour the DOM can paint? */
export function isColorLiteral(value: string): boolean {
  return HEX_COLOR_RE.test(value) || value.startsWith('rgb') || value.startsWith('hsl');
}

/**
 * Build a `value -> option colour` lookup from a field definition's `options`.
 * Returns an empty map for a field with no options, so callers need no guard.
 */
export function buildFieldColorMap(fieldDef: FieldColorDefinition | undefined | null): Record<string, string> {
  const options = fieldDef?.options;
  if (!Array.isArray(options)) return {};
  const map: Record<string, string> = {};
  for (const opt of options as FieldColorOption[]) {
    if (!opt || typeof opt !== 'object') continue;
    if (opt.value == null) continue;
    if (typeof opt.color === 'string' && opt.color) map[String(opt.value)] = opt.color;
  }
  return map;
}

/**
 * Build the per-field colour resolver: rung 1 (option colour) then rung 2 (the
 * value is already a colour literal), else `undefined` so the caller runs its
 * own last rung.
 *
 * A factory rather than a plain function because callers resolve one field
 * across every row of a view — the option map is built once, not per record.
 *
 * @param fieldDef `objectSchema.fields[colorField]`, or `undefined` when the
 *   view has no schema in hand (an inline-data or `api`-provider view). With no
 *   options, rung 1 is a no-op and rung 2 still answers for literal colours.
 */
export function createFieldColorResolver(
  fieldDef: FieldColorDefinition | undefined | null,
): (value: unknown) => string | undefined {
  const colorByValue = buildFieldColorMap(fieldDef);
  return (value: unknown): string | undefined => {
    if (value == null || value === '') return undefined;
    const key = String(value);
    const optionColor = colorByValue[key];
    if (optionColor) return optionColor;
    return isColorLiteral(key) ? key : undefined;
  };
}
