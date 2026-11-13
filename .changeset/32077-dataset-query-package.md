---
'@object-ui/core': patch
'@object-ui/data-objectstack': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-report': patch
---

fix(ui)!: dashboards, reports and dataset charts send their package on dataset queries (ADR-0150 D5)

Clause-②: yes (narrowing + widening) — a dashboard, report or list-view chart whose dataset only a dependency of its own package holds is refused where it was served (BREAKING below); and `@object-ui/data-objectstack`'s `queryDataset` accepts an optional `packageId` option, `@object-ui/core` exports `servedPackageId`, `DatasetWidget` (`@object-ui/plugin-dashboard`) and `ObjectChart` (`@object-ui/plugin-charts`) accept an optional `packageId` prop. Nothing an item with no package sends changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: what changes is which package a dataset query names, and the stored dashboard, report and dataset rows are read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`POST /api/v1/analytics/dataset/query` resolves a bare `datasetName` by ADR-0150 D3, and answers a name two packages hold with `409 RESOURCE_CONFLICT` naming both. A saved dataset is now read under the package of the item that references it, sent as the exact qualifier `?package=`:

- a dashboard's dataset widgets name the dashboard's own served package (`_packageId`), on both `DashboardRenderer` and `DashboardGridLayout`;
- a dataset-bound report names the report's own served package on every selection, the joined blocks' included;
- a dataset-bound list-view chart names the view's own served package.

An item authored in the environment (no `_packageId`, or the package-less `sys_metadata` sentinel) sends no `?package=`, so its read stays caller-less exactly as before. An inline dataset (the dashboard filter bar's option query, the Studio dataset preview) names no saved item and sends none. A `409` is shown as the server's sentence, naming every candidate, and is never retried with the bare name.

**BREAKING** (the dataset query of a package item, interim under the epic's ruling A): `?package=` is the exact qualifier (ADR-0150 D5), not the dependency-closure read of D3. **FROM:** a dashboard, report or list-view chart in package P, whose dataset only a dependency of P holds, is served by the bare read. **TO:** it is refused `409 RESOURCE_CONFLICT` (`not-held-by-qualifier`), naming the holder, and the item's widget or block shows that sentence. **The interim fix:** ship the dataset in the item's own package. No first-party package references a dataset across packages (read in this repository; **corrected by #32929:** one first-party app outside this repository does — HotCRM's CRM Overview dashboard, in its app package `app.objectstack.hotcrm`, binds the dataset `product_metrics` that its module package `app.objectstack.hotcrm.revenue` holds, so once the console sends the item's package the tile is refused where it drew on 18.3.0; the module depends on the app, so declaring the module from the app is a cycle the kernel refuses at boot. Other first-party apps outside this repository: not measured). Follow-ups #32310 (a caller-package arm on the dataset query door, with closure semantics) and #32311 (the console switches to it) restore the dependency case.
