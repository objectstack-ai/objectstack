---
'@object-ui/core': patch
'@object-ui/data-objectstack': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-report': patch
---

fix(ui): dashboards, reports and dataset charts send their package on dataset queries (ADR-0150 D5)

Clause-②: yes (widening) — `@object-ui/data-objectstack`'s `queryDataset` accepts an optional `packageId` option, `@object-ui/core` exports `servedPackageId`, `DatasetWidget` (`@object-ui/plugin-dashboard`) and `ObjectChart` (`@object-ui/plugin-charts`) accept an optional `packageId` prop. Nothing an existing caller sends changes.
Metadata-protocol: none

`POST /api/v1/analytics/dataset/query` resolves a bare `datasetName` by ADR-0150 D3, and answers a name two packages hold with `409 RESOURCE_CONFLICT` naming both. A saved dataset is now read under the package of the item that references it, sent as the exact qualifier `?package=`:

- a dashboard's dataset widgets name the dashboard's own served package (`_packageId`), on both `DashboardRenderer` and `DashboardGridLayout`;
- a dataset-bound report names the report's own served package on every selection, the joined blocks' included;
- a dataset-bound list-view chart names the view's own served package.

An item authored in the environment (no `_packageId`, or the package-less `sys_metadata` sentinel) sends no `?package=`, so its read stays caller-less exactly as before. An inline dataset (the dashboard filter bar's option query, the Studio dataset preview) names no saved item and sends none. A `409` is shown as the server's sentence, naming every candidate, and is never retried with the bare name.
