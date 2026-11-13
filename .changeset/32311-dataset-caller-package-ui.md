---
'@object-ui/data-objectstack': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-report': patch
---

fix(ui): dashboards, reports and dataset charts send their package as the reader's package (`?callerPackage=`) on dataset reads, so a package item reads a dependency's dataset (ADR-0150 D3)

Clause-②: yes (widening) — `@object-ui/data-objectstack`'s `queryDataset(dataset, selection, options)` and `queryDatasetBatch(queries, options)` accept an optional `callerPackage` option, sent as `?callerPackage=` with a saved dataset name. A dashboard, report or list-view chart in package P whose dataset only a dependency of P holds is now served where the exact qualifier refused it. Nothing an item with no package sends changes.
Metadata-protocol: none

A saved dataset is read for the package of the item that references it, sent as the reader's package `?callerPackage=` (ADR-0150 D3) instead of the exact qualifier `?package=` (ADR-0150 D5). The server reads that package's own dataset, else the one holder among its dependencies (transitively) plus `sys`, else refuses `409 RESOURCE_CONFLICT` naming the candidates:

- a dashboard's dataset widgets, on `DashboardRenderer` and `DashboardGridLayout`, and the batch request a dashboard render sends (one request per caller package: two packages' queries never share one);
- a dataset-bound report's selections, the joined blocks' included, and the definition read that finds the date dimension a `dateRange` with no `dimension` windows on;
- a dataset-bound list-view chart's query, and the definition read its option colours come from.

The package stays part of each query's signature, so a cached answer never crosses packages. An item authored in the environment (no `_packageId`, or the `sys_metadata` and `__runtime__` sentinels) sends no package, and its read stays caller-less exactly as before. An inline dataset names no saved item and sends none. A `409` is shown as the server's sentence on the widget and the report block, and as its status (`HTTP 409`) on the date range; the option-colour read keeps the theme palette. None of them is retried with the bare name. The `packageId` option (`?package=`) stays on both adapter methods for a caller that means the holder.

**What this does to the BREAKING note of the `?package=` change** (`32077-dataset-query-package`, the interim this follows up). That note refuses a dashboard, report or list-view chart in package P whose dataset only a dependency of P holds, with `409 RESOURCE_CONFLICT` (`not-held-by-qualifier`). After this change such an item is served again: the dependency's dataset, resolved for P. Two cases stay refused, now as `outside-closure`: a dataset held only by a package P does not declare in its `dependencies` (transitively), and a dataset authored in the environment rather than in a package. **The fix for those:** add the holder to P's `dependencies`, or ship the dataset in P. When the holder already depends on P (a module of the app that reads it), that dependency is a cycle: move the reading item into the holder instead. **First-party (corrected by #32929):** HotCRM's CRM Overview dashboard, in its app package `app.objectstack.hotcrm`, binds the dataset `product_metrics` that its module package `app.objectstack.hotcrm.revenue` holds; the module depends on the app, not the app on the module, so once the console sends the reader's package the tile answers `409 RESOURCE_CONFLICT` (`outside-closure`) where it drew on 18.3.0, and declaring the module from the app would be a dependency cycle the kernel refuses at boot. HotCRM fixes it in its own release, by moving the dashboard into the module or the dataset into the app package; the HotCRM lane chooses (#32929). Other first-party apps outside this repository: not measured.
