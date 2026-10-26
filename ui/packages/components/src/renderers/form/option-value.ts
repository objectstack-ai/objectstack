/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Option-value round-trip helpers (#3090).
 *
 * The standalone form vocabulary has always ACCEPTED numeric/boolean option
 * values (`SelectOptionSchema.value` is `string | number | boolean`), but the
 * Radix controls underneath speak strings only: `onValueChange` hands back a
 * string no matter what the author wrote, so picking `{ value: 2 }` silently
 * submitted `"2"` — a type morph the server sees as a wrong-typed write, and
 * one nothing on the client ever reported. These helpers make the authored
 * type survive the control: values are stringified on the way INTO the
 * control and matched back to the authored option on the way OUT.
 */

export type OptionValue = string | number | boolean;

/** Stringify a value for a string-speaking control, preserving null/undefined
 * (an absent value must stay absent, not become `"undefined"`). */
export function toControlValue(
  value: OptionValue | null | undefined,
): string | undefined {
  return value == null ? undefined : String(value);
}

/**
 * Map a control's string back to the authored option value, so a
 * numeric/boolean option round-trips with its type intact. Falls back to the
 * raw string when nothing matches (free-text or a stale value) — the
 * pre-#3090 behavior, so unmatched paths change nothing.
 */
export function matchOptionValue(
  options: ReadonlyArray<{ value: OptionValue }> | undefined,
  raw: string,
): OptionValue {
  const hit = options?.find((o) => String(o.value) === raw);
  return hit ? hit.value : raw;
}
