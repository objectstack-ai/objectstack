---
'@object-ui/data-objectstack': patch
'@object-ui/plugin-dashboard': patch
---

feat(ui): a dashboard render sends its dataset queries as one batch request

Clause-②: no
Metadata-protocol: none

A dashboard used to send one `POST /api/v1/analytics/dataset/query` per dataset-bound widget. It now sends the queries one render asks as one `POST /api/v1/analytics/dataset/query/batch` per package, through the batch door `@objectstack/rest` serves. Nothing to author and nothing to change in a host.

- `@object-ui/data-objectstack`: `ObjectStackAdapter.queryDatasetBatch(queries, { packageId?, previewDrafts? })` runs several dataset queries and resolves to one outcome per query, in order, in `Promise.allSettled`'s shape. Each outcome is what `queryDataset` gives that query alone: its answer, or the error it throws for that query's refusal, classified by the same ladder. Queries are grouped by the package they are read from (an inline draft goes without one) and sent at most `DATASET_QUERY_BATCH_MAX_QUERIES` to a request; a lone query takes the single door. A batch refused whole for a reason that is no query's own (not signed in, no analytics service) refuses each query with the single door's error for that answer. A server that does not serve the batch door (`404 ROUTE_NOT_FOUND`, or a bare 404/501) has each query answered by the single door, and the adapter stops asking it for batches.
- `@object-ui/plugin-dashboard`: `DashboardRenderer` and `DashboardGridLayout` gather the dataset queries their widgets and filter bar ask in one render and hand them to the data source's `queryDatasetBatch`. Each widget keeps its own query, answer, refusal state and invalidation refetch. A query alone in its render window (a widget mounted alone, a one-widget refetch) and every query of a data source with no `queryDatasetBatch` take `queryDataset` unchanged.
