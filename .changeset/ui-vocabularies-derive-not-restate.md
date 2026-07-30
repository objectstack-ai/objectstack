---
"@objectstack/spec": minor
"@objectstack/lint": patch
---

feat(spec,lint): the `ui` vocabularies admit what the renderers implement, and derive instead of restating (objectui#2945)

Additions-only follow-up to the vocabulary audit
(objectstack-ai/objectui#2901, #2945). Nothing here narrows a vocabulary, so no
already-stored metadata changes meaning — three of the four `ui/` enums that had
drifted from what is actually implemented, plus the fork that drift had made
invisible.

**`ChartTypeSchema` admits `combo`.** The taxonomy could not name the one chart
family the rest of `chart.zod.ts` is written for: `ChartSeriesSchema.type`
exists to override a series' type — its doc comment literally says *"combo
charts"* — and `ChartSeriesSchema.yAxis` binds a series to the left or right
axis, which is only meaningful for mixed marks. objectui's renderer draws it
distinctly (mixed bar/line/area on dual axes, per-series type) and had to carry
`combo` in a local fork of this list, whose own comment claimed to mirror it.

**`WidgetActionTypeSchema` is `ActionType`.** The two disagreed by one member,
`form`, and the disagreement was backwards: a dashboard header or widget action
button dispatches through the same `ActionRunner` that implements `form` —
objectui's `DashboardRenderer` deliberately routes everything except a raw `url`
into it, so a `flow` header action works (#3528). The narrower enum therefore
rejected at validation exactly what the shared dispatcher then executes.
Derived, so the next type the runner implements needs one edit, not two.

**`ListChartConfigSchema.chartType` is `ChartTypeSchema.extract([...])`.** Same
five members as before — a de-duplication, not a widening. A member renamed in
the taxonomy now fails at build time instead of leaving a second list quietly
disagreeing.

**`@objectstack/lint`'s chart-family set is derived from the taxonomy.**
`validate-widget-bindings` decides which widgets need a `chartConfig` measure
mapping from a hand-written list of families, and its omissions fail in the
worst direction: an unlisted family reads as *"not a chart"*, so a widget
missing its mapping **passes** validation. `combo` was exactly that case —
verified by pinning the old list back, where a `combo` widget with no
`chartConfig` produced zero findings. The set is now the taxonomy minus an
explicit `MEASURE_EXEMPT_CHART_TYPES` (single-value and tabular families), so a
family added to the spec is covered without editing the rule.

Guards: `packages/spec/src/ui/vocabulary-derivation.test.ts` asserts both
derivations still hold (a restated list fails silently — it keeps validating,
just not what the other list says), and the lint suite now walks every
multi-series family in the taxonomy rather than a list of its own.

A third ratchet already existed and did its job: `app-showcase`'s coverage test
requires a gallery widget for every distinctly-renderable `ChartType`, and it
failed the moment `combo` was admitted. The Chart Gallery dashboard now
demonstrates it — a task count as bars on the left axis, an average as a line on
the right, which is the configuration `series[].type` / `series[].yAxis` exist
for.

`ActionType` deliberately does **not** gain `navigation`, which the audit
suggested. `ActionRunner.executeNavigation` is a strictly weaker
`executeUrl` — no `${param.X}` interpolation, no `apiBase` promotion, no
`openIn` — differing only by a `replace` option, and its one live producer is
the SDUI `element:button` `action` prop, which `ElementButtonPropsSchema` does
not model at all. Promoting the name would add a second spelling of *navigate*
to a closed authorable vocabulary (members cannot be removed later) without
closing the gap that actually exists. Tracked separately.

Verified: `@objectstack/spec` **6944 tests / 267 files**, `@objectstack/lint`
**544 tests / 37 files**, both green; `tsc --noEmit` clean on both.
