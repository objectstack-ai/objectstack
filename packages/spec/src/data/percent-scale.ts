// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Percent SCALE — the single source of truth for "what magnitude is this
 * percentage stored at". A `%` display format says *how* to print a number, not
 * *what scale it is on*: `1` is "100%" when the value is a 0–1 ratio and "1%"
 * when it is already in percentage points. Nothing in the number itself tells
 * the two apart, so renderers were guessing from the value's magnitude — and a
 * ratio of exactly `1` (full compliance, the one value that matters most on an
 * SLA / pass-rate dashboard) guessed wrong and printed "1%" (objectui#3136).
 *
 * The scale is answerable from METADATA, so it is answered here and carried on
 * the wire (see `AnalyticsResult.fields[].percentScale`) rather than re-guessed
 * per surface. This mirrors the ADR-0053 currency chain: a monetary measure
 * resolves its display currency from the source field's metadata instead of a
 * "$" baked into the format string.
 */

/**
 * How a percentage's stored number relates to its displayed percentage:
 *
 * - `fraction` — a 0–1 ratio. Multiply by 100 to display: `0.75` ⇒ "75%",
 *   `1` ⇒ "100%". Every `derived: { op: 'ratio' }` measure is this by
 *   definition, as is a `percent` field written by the standard edit widget.
 * - `whole` — already in percentage points. Display verbatim: `75` ⇒ "75%",
 *   `1` ⇒ "1%". A `percent` field declaring a `max` above 1 (e.g. `max: 100`)
 *   is this — that bound is what the edit widget keys off when it stores the
 *   typed number unscaled.
 */
export type PercentScale = 'fraction' | 'whole';

/** The subset of field metadata the scale is resolvable from. */
export interface PercentScaleFieldMeta {
  type?: string;
  /** Declared upper bound; `> 1` marks whole-percent storage (see below). */
  max?: number;
}

/**
 * Resolve the storage scale of a `percent` field, or `undefined` when the field
 * is not a percentage (a plain `number` carries no percent semantics — a
 * measure over one keeps whatever the author's format string implies).
 *
 * A percent field stores a FRACTION unless it declares `max > 1`. That is not a
 * new convention invented here: it is the rule the percent EDIT widget already
 * writes by (it divides typed input by 100 unless `max > 1`), so reading it back
 * this way is what makes a value round-trip. Declaring `min: 0, max: 100` is
 * therefore a load-bearing statement about storage, not just validation.
 */
export function percentScaleOf(field: PercentScaleFieldMeta | undefined): PercentScale | undefined {
  if (field?.type !== 'percent') return undefined;
  return typeof field.max === 'number' && field.max > 1 ? 'whole' : 'fraction';
}
