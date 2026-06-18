---
"@objectstack/spec": patch
---

fix(spec): declare the extended Gantt config fields the renderer actually reads

`GanttConfigSchema` only declared the 5 core timeline fields as a plain
`z.object` (no passthrough), so every other field the Gantt renderer consumes —
`parentField`/`typeField` (two-level summary→step hierarchy), `colorField`,
`groupByField`, `tooltipFields`, `baselineStartField`/`baselineEndField`,
`resourceView`/`assigneeField`/`effortField`/`capacity`, `quickFilters`,
`autoZoomToFilter` — was silently stripped by `.parse()` on both the compile-time
protocol check and the runtime `GET /api/v1/meta/view/:object` re-validation. With
the keys gone before render, the Gantt degraded to a flat list (no parent/child
rows, no summary bars, no expand/collapse). These fields are now declared
explicitly (with descriptions), so the renderer contract round-trips through the
spec instead of requiring downstream patches.
