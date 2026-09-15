// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17751 — ADR-0049 enforce-or-remove (maintainer decision batch #118 item 2,
// 2026-09-12: recommendation C, judge the protocol wrong for this one key).
// The third and last member of the `aria` family retired on the same measured
// evidence: `dashboard.aria` at the #3896 close-out, `dashboard.widgets[].aria`
// at #5010, and now the block-local spelling one level further in, inside the
// widget's `chartConfig`. It outlived the first two sweeps by DEPTH, not by
// evidence — `widgets.chartConfig` was an undrilled container, so no key inside
// it had ever been classified until the per-key pass recorded in
// `liveness/dashboard.json` at the `.objectui-sha` pin 53ded82bf7a4. That pass
// found `aria` to be the one `ChartConfigSchema` key with no reader on EITHER
// face: `AdvancedChartImpl` declares no `aria` prop, `chartConfigPresentation`
// names it nowhere (its docblock calls it "the one declared key with no reader
// at all"), `SchemaRenderer`'s ARIA injection reads flat node props and never a
// nested `aria` object, and `ui/react-blocks.ts` omits it from `<ObjectChart>`'s
// thirteen `dataProps` — the one key of this shape missing from that list.
// Pinned as a negative from both spellings in objectui ("ignores
// chartConfig.aria", "ignores aria — nested and flattened").
//
// REMOVE rather than ENFORCE, which is the less usual ADR-0049 answer and is
// the whole of the ruling: this same chart config already carries a WORKING
// accessible-name channel in `description`, lowered onto the chart graphic as
// `role="img"` + `aria-label` and pinned in the DOM. Wiring `aria` too would
// put two accessible-name sources on one element and demand a precedence rule
// nobody has written. One node, one accessibility vocabulary — which on the
// surfaces that really render DOM is the shared `AriaProps` block, untouched
// and still live on `page.aria`, `page.components[].aria` and the list view
// `aria`.
//
// `retiredKey()` rather than a bare deletion even though `ChartConfigSchema` IS
// a `strictObject`: a bare delete would still be loud, but as a generic
// unrecognized-key rejection that cannot carry the prescription — the exact
// distinction `aria-carrier-tombstones.test.ts` asserts by name for the widget
// twin. Sources are rewritten by the D2 conversion `chart-config-aria-removed`.
//
// Registered under 18, not 17: v17 was cut before this landed, so the tombstone
// ships on the 17.x line (launch-window convention — accept-set narrowings ride
// minor releases) and the prescription lives at the major boundary where
// `migrate meta` users look.
export const entry = 'ui/ChartConfig:aria';
