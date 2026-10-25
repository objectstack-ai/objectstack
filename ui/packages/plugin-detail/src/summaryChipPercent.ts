/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { percentDisplayValue, type PercentScale } from '@object-ui/core';

/**
 * The ONE rule the `summaryFields` chip scales a stored `percent` by — and it
 * is the repo's, not this file's (objectui#9071).
 *
 * ⭐ Since objectui#9167 this is the chip's BAR path only. The chip's TEXT goes
 * straight to `formatPercent` in `@object-ui/fields` — the list cell's own
 * body, which applies {@link percentDisplayValue} itself and then the locale's
 * percent affix at the field's precision. See "The half objectui#9071 did NOT
 * take" below, which objectui#9167 closed.
 *
 * ## Why this function exists at all (objectui#8728)
 *
 * The chip beside the record H1 draws a percent TWICE — as its text and as a
 * small bar — and the two halves scaled the same stored number by two
 * different rules:
 *
 *     display = `${num}%`;                            // the text: no scaling
 *     const normalized = num <= 1 ? num * 100 : num;  // the bar: ratio, scaled
 *
 * so a stored `0.123` labelled itself `0.123%` beside a bar filled to 12.3%.
 * One control, two percentages, and neither half told the reader which one was
 * right. Both halves read this function — which is why it is a named function
 * and not the same ternary written twice. The next reader cannot
 * re-desynchronise them without deleting a call site.
 *
 * ## What objectui#9071 DELETED, and why aligning it would not have done
 *
 * objectui#8728 converged the chip's two halves onto the BAR's rule and
 * recorded, rather than decided, that the rule was the chip's own. The census
 * it asked for answered the question: the predicate that stood here —
 * a pass-through spelled `if (raw > 1) return raw;`, i.e. the bar's original
 * `num <= 1` written the other way round — was the only spelling of its kind on
 * this side of the tree, and it disagreed with the declared single source of
 * truth at EXACTLY 1 and at every value AT OR BELOW -1:
 *
 * | stored | the deleted local rule | `percentDisplayValue`, and every other band |
 * |--------|------------------------|---------------------------------------------|
 * | `0.25` | `25%`                  | `25%`   (the band they always agreed on)     |
 * | `1`    | `100%`                 | `1%`                                         |
 * | `-1`   | `-100%`                | `-1%`                                        |
 * | `-5`   | `-500%`                | `-5%`                                        |
 *
 * ⛔ The repair is NOT to move the local predicate's boundary onto the shared
 * one. That would leave two rules agreeing by coincidence — the same shape
 * objectui#5607 removed one package over, and the shape that produced this
 * drift in the first place. The predicate is gone; the authority is
 * {@link percentDisplayValue} in `@object-ui/core`, whose own doc comment
 * requires exactly this of a third surface, and which the list cell
 * (`formatPercent` / `PercentCellRenderer`), the dashboard measure
 * (`formatMeasure`) and the grid column summary already read.
 *
 * ## The half objectui#9071 did NOT take — closed by objectui#9167
 *
 * That doc comment asks a third surface for BOTH halves — the scaling AND the
 * convention. objectui#9071 moved the SCALING only: the chip stated the full
 * JavaScript number with a bare `%` while the list cell rendered through the
 * locale's percent affix at the field's precision (`0` by default), so a stored
 * `12.3` read `12.3%` beside the H1 and `12%` in the list — two spellings of
 * one magnitude, with the two bars proving the magnitude was one. That card
 * stopped because its acceptance forbade moving values the chip rendered
 * correctly today, and the convention half moves several.
 *
 * objectui#9167 took it, value by value rather than by inspection: both
 * surfaces were driven in the same run, on the same field, for every stored
 * value below, and every row that MOVED moved onto the reading the list cell
 * was already giving. The chip's text is now the cell's own `formatPercent`
 * call, byte for byte, and this function is left
 * holding the BAR alone. The table and its `de-DE` leg are pinned in
 * `__tests__/summaryChip.percentConvention-9167.test.tsx`.
 *
 * ## The storage is the field's, stated by the caller (objectui#11475)
 *
 * `percentScale` is the storage the chip's field declares, which `DetailView`
 * reads with `percentCellScale` (`@object-ui/fields`): the spec's
 * `percentScaleOf`, the answer the list cell reads too. Until objectui#11475
 * the shared source guessed the storage from the value's magnitude, so the
 * table above, whose every row is that guess, no longer describes this
 * function: a fraction-stored `1` now fills the bar to 100%, and a
 * whole-stored `0.5` to half a percent.
 */
export function summaryChipPercentPoints(raw: number, percentScale: PercentScale): number {
  const points = percentDisplayValue(raw, percentScale);

  // A whole-stored value is already points; the source passed it through.
  if (percentScale === 'whole') return points;

  // A ratio the source scaled to points. `raw * 100` is binary floating-point
  // multiplication: 246 of the 999 three-decimal ratios (0.001 through 0.999)
  // carry residue — a stored `0.07` is `7.000000000000001`, a stored `0.29` is
  // `28.999999999999996`. 12 significant digits is far wider than any percent a
  // human authored and far narrower than the residue, and it rounds a MAGNITUDE
  // the source already chose, so it is a rendering step and not a percent
  // convention: the guard above keeps it off every whole-stored value, which
  // the source passed through, where trimming to 12 digits would move numbers
  // that render correctly today.
  //
  // ⚠️ Its ORIGINAL argument was that "it is the TEXT that reads the result" —
  // a CSS bar width absorbs the residue invisibly, a label cannot. objectui#9167
  // took the text away from here, so that argument no longer applies and only
  // the invisible half is left. It is kept rather than deleted because deleting
  // it is a change of its own: the drawn width would move from `7%` to
  // `7.000000000000001%` on the residue values, which is the direction the list
  // cell's own unrounded bar already takes — a tidy-up for whoever measures it,
  // ⛔ not something objectui#9167 changed on its way past.
  return Number(points.toPrecision(12));
}
