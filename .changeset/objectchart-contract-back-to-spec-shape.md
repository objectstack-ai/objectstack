---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

`<ObjectChart>`'s author contract is the spec `ChartConfig` shape again (issue #3729)

#3701 trimmed `xAxis`/`yAxis`/`series` out of the `<ObjectChart>` contract
because the renderer read `xAxisKey`/`series[].dataKey` and silently dropped the
ChartConfig shapes — an honest record of the runtime gap, not the target state.
objectui#2880 closed the gap the other way round (the renderer now honors
`ChartConfig` through one normalization boundary), so the contract follows the
protocol again (ADR-0082 D1: the spec schema IS the protocol).

**Contract.** `type`, `xAxis`, `yAxis`, `series`, `subtitle`, `showDataLabels`,
`annotations` and `interaction` are published from `ChartConfigSchema`; the
internal `chartType`/`xAxisKey`/`series[].dataKey` spellings leave the author
contract. `annotations` and `interaction` gained the `.describe()` they never
had, so the generated contract stops publishing bare `object[]` with no meaning.

**The `type` exception.** `ChartConfig.type` is the chart family, but on any
surface that flattens chart config into a props bag `type` is already the SDUI
envelope's component discriminator — an author writing `type="bar"` used to
replace `object-chart` and the block stopped resolving. The collision is created
by the flattening and is resolved there (objectui's react-page wrapper), so the
contract can publish `type` as the spec spells it. The contract generator's
blanket `type` skip is now overridable by an explicit `dataProps` allow-list,
since for this one block `type` is a real author prop.

**Lint.** `validate-react-page-props` reads the axes in the spec spelling —
`xAxis.field`, `yAxis[].field`, `series[].name` — and keeps accepting the
internal spellings silently, because dashboards and the console's own chart-view
wiring emit them. `react-chart-axis-inert` is retired: the props it warned about
are honored now, so the warning would be false. The three binding-integrity
rules from #3701 are unchanged.

**Spec.** `chart-aggregate.ts` records the constraint the whole result-column
convention rests on: an inline `aggregate` is SINGLE-MEASURE. Keying rows by the
raw field name only works because there is exactly one measure to key; two
measures over one field would collide, and resolving that needs an author-chosen
name per measure — which is what a dataset is. Widening `ChartAggregateSchema`
into a measures array would silently invalidate every axis binding these rules
validate, so the boundary is now written down rather than left to be rediscovered.

The chart taxonomy note is corrected too: grouped/stacked bar and stacked area
are absent from `ChartTypeSchema` not because they render as their base chart,
but because stacking is a property of the SERIES (`ChartSeries.stack`), not a
chart family — one `bar` family plus a series stack group expresses all three.
`ChartInteraction.zoom` is now marked declared-not-delivered in its own
description rather than reading as shipped.
