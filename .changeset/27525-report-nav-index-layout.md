---
'@object-ui/layout': minor
---

feat(layout): a `report` navigation entry with no `reportName` resolves to the app's report index

Clause-②: yes (widening)
Metadata-protocol: added

`resolveHref` answers `BASE/reports` for a `report` entry that names no report (it answered `#`), so the entry links, and is the active row, on the report index route. A label-less one asks the host's `NavTargetLabelResolver` for the new `{ kind: 'reportIndex' }` target, else shows its `id`.
