---
"@objectstack/example-showcase": patch
---

The showcase Chart Gallery now shows one widget per chart family the renderer
draws DISTINCTLY (27 → 17 widgets). Families that fell back to a near-relative
(grouped/stacked/bi-polar bars, stacked-area, step-line, spline, pyramid,
bubble) and the dial-less performance variants (kpi/gauge/solid-gauge/bullet,
identical to `metric`) were removed — advertising a type that renders as
something else is misleading. Bundles the objectui console build that routes
each widget to its true chart renderer (pie/donut/funnel/line/area/scatter/
radar/treemap/sankey/table/pivot).
