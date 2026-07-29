---
"@objectstack/spec": patch
---

chore(liveness): `report.order` is live — objectui now lowers it onto the selection (#3916)

`ReportSchema.order` shipped as `planned` + `authorWarn`: the framework half was
complete (schema, `reportSelectionOrder`, executor), but objectui's
`DatasetReportRenderer` built the selection it posted and never carried the
declaration into it, so an authored ordering reached no query. Marking it `live`
then would have been the exact failure the gate exists to catch.

objectui#2964 landed that wiring — `useDatasetRows`, the single fetch choke point
behind every report path, now carries the lowered ordering across all four call
sites (grouped table, embedded chart, matrix cross-tab, each joined block), with
the ordering in the refetch signature and scoped per sub-selection so the
chart's narrower x/y query cannot post a key it never selected.

So the ledger entry flips to `live`, gains the framework evidence paths, and
drops `authorWarn` / `authorHint` — an authored `order` now does what it says,
and the advisory that it did not is no longer true.

No behaviour change in this repo; the ledger is the deliverable.
