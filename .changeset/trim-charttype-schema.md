---
"@objectstack/spec": major
---

BREAKING: `ChartTypeSchema` drops 8 variant types that only rendered as their
base chart, so the taxonomy now advertises only families the renderer draws
distinctly.

Removed: `grouped-bar`, `stacked-bar`, `bi-polar-bar` (→ bar — no multi-series
grouping/stacking), `stacked-area` (→ area), `step-line`, `spline` (→ line),
`pyramid` (→ funnel), `bubble` (→ scatter — no size encoding).

Kept: bar / horizontal-bar / column, line / area, pie / donut / funnel, scatter,
treemap / sankey, radar, table / pivot, and the single-value performance family
(metric / kpi / gauge / solid-gauge / bullet — these render an honest value
today and gain a dial when a gauge renderer lands).

Migration: a widget/series using a removed type should switch to its base
(`stacked-bar`→`bar`, `spline`→`line`, `pyramid`→`funnel`, `bubble`→`scatter`,
etc.). These can return via an opt-in renderer once a real renderer + data model
backs them.
