/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Relative dates on a filter row: the windows `between` offers and the points
 * `before` / `after` offer on a `date` or `datetime` column.
 *
 * A choice is STORED as the spec's date-macro placeholders, never as a date
 * and never as a preset name: `this_week` on `between` writes
 * `['{week_start}', '{week_end}']`, `today` on `before` writes `'{today}'`. The
 * rule stays an ordinary `ViewFilterRule`, and every reader resolves the
 * placeholders when the query runs (the server's `resolveFilterTokens`), so a
 * saved "this week" means this week on every later day.
 *
 * The windows are READ from `@objectstack/spec`'s
 * `DATE_RANGE_PRESET_MACRO_WINDOWS`, in `DATE_RANGE_PRESETS` order; this module
 * keeps no copy of either. What it adds is the reverse reading, stored pair to
 * preset, so a stored window shows its preset's label again.
 */

import {
  DATE_MACRO_ALIAS_TOKENS,
  DATE_MACRO_WRAPPED_RE,
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_MACRO_WINDOWS,
  isDateMacroToken,
  type DateRangePreset,
} from "@objectstack/spec/data"

/**
 * The relative points `before` / `after` offer, in display order. Each is a
 * fixed date-macro token of the spec's vocabulary (pinned by the tests), stored
 * wrapped: `'{today}'`.
 */
export const RELATIVE_DATE_POINTS = ["today", "yesterday", "tomorrow"] as const

export type RelativeDatePoint = (typeof RELATIVE_DATE_POINTS)[number]

const BARE_ALIASES: ReadonlySet<string> = new Set(DATE_MACRO_ALIAS_TOKENS)
const CURRENT_PREFIX = "current_"

/**
 * The token name a value names when it is one date-macro placeholder (`'{today}'`,
 * `'${30_days_ago}'`), with the spec's bare aliases folded: `{current_week_start}`
 * and `{week_start}` are one token (`DATE_MACRO_ALIAS_TOKENS`), and both answer
 * `week_start`. Anything else, a date included, answers `undefined`.
 */
export function dateMacroName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const match = DATE_MACRO_WRAPPED_RE.exec(value)
  if (!match || !isDateMacroToken(match[1])) return undefined
  const name = match[1]
  if (name.startsWith(CURRENT_PREFIX)) {
    const bare = name.slice(CURRENT_PREFIX.length)
    if (BARE_ALIASES.has(bare)) return bare
  }
  return name
}

/** Does this scalar, or any entry of this list, hold a date-macro placeholder? */
export function holdsDateMacro(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => dateMacroName(entry) !== undefined)
  return dateMacroName(value) !== undefined
}

/** The relative point a stored scalar names, or `undefined`. */
export function relativeDatePointOf(value: unknown): RelativeDatePoint | undefined {
  const name = dateMacroName(value)
  return RELATIVE_DATE_POINTS.find((point) => point === name)
}

/** The value a relative point is stored as. */
export function relativeDatePointValue(point: RelativeDatePoint): string {
  return `{${point}}`
}

/**
 * The preset a stored pair is the window of, or `undefined`: both bounds must
 * be placeholders, compared after the alias fold. A pair that matches no window
 * (`['{7_days_ago}', '{tomorrow}']`) answers `undefined` and is kept as it is.
 */
export function dateRangePresetOf(value: unknown): DateRangePreset | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const start = dateMacroName(value[0])
  const end = dateMacroName(value[1])
  if (start === undefined || end === undefined) return undefined
  return DATE_RANGE_PRESETS.find((preset) => {
    const [presetStart, presetEnd] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset]
    return dateMacroName(presetStart) === start && dateMacroName(presetEnd) === end
  })
}

/** The value a preset is stored as: the spec's macro window, as a fresh list. */
export function dateRangePresetValue(preset: DateRangePreset): string[] {
  const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset]
  return [start, end]
}
