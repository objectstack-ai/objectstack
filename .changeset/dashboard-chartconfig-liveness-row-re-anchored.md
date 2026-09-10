---
"@objectstack/spec": patch
---

docs(spec): the `dashboard.widgets[].chartConfig` liveness row is re-anchored to the current objectui pin — 12 of 14 keys reach the renderer, not 9 (#17385)

`packages/spec/liveness/dashboard.json` ships inside this package, so its rows are part of what an author reads. The `widgets.children.chartConfig` row was measured on 2026-08-09 against `objectui @230ffd875` and both halves of that reading are now superseded — re-measured by hand against this checkout's own `.objectui-sha` pin `53ded82bf7a4`.

**The citation moved repos-internally.** `chartConfigPresentation` was lifted out of `plugin-dashboard` into `@object-ui/core`'s `chart-presentation` module, so the old pointer at `packages/plugin-dashboard/src/DatasetWidget.tsx:380-429` — still byte-exact at the commit it names — lands on the re-export block at that range in the pinned tree, while the nine `if`s it describes are in another package. A foreign path is counted and never resolved by `check:liveness`, deliberately, so nothing mechanical could have caught this: only a hand re-measurement does.

**The count changed.** `xAxis` / `yAxis` / `series` were recorded as unforwarded on the grounds that they are derived from the dataset selection. They are forwarded today: the dataset keeps series MEMBERSHIP and the column each binding reads (`ChartSeries.name` and `ChartAxis.field`, dropped on the way through) while every other key on those objects merges onto the derived binding with the explicit binding winning. `type` and `aria` remain the two keys that do not reach this face.

Evidence text only — no verdict moves, no schema key changes, and the row still carries no per-key `children`. The per-key drill, the `type` / `aria` dispositions and the authored-versus-derived precedence the protocol does not yet state stay open on #17385.
