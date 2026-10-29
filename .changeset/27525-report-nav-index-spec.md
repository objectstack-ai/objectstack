---
'@objectstack/spec': minor
---

feat(spec): a `report` navigation item without `reportName` opens the app's report index

Clause-②: yes (widening)
Metadata-protocol: added

`ReportNavItemSchema.reportName` is optional. `{ type: 'report', reportName }` opens that report, as before; `{ type: 'report' }` with no `reportName` opens the app's report index (`/apps/APP/reports`), the list of the reports the app ships that the member may open. Before, an item with no `reportName` was refused (`navigation.N.reportName: expected string, received undefined`). Nothing that parsed before parses differently, and the stack's cross-check of a named `reportName` against `reports` is unchanged.
