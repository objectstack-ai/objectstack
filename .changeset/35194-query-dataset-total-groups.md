---
'@objectstack/spec': patch
'@objectstack/service-analytics': patch
---

feat(service-analytics): `query_dataset` says how many groups existed before the `limit` cut (`totalGroups`), as `aggregate_records` does

Clause-②: yes (widening: QueryDatasetOutputSchema gains totalGroups)
Metadata-protocol: none

`QueryDatasetOutputSchema` gains an optional `totalGroups`: how many groups the selection formed before `offset` and `limit` cut them, the same name and meaning as `aggregate_records`' `totalGroups`. A client asked "how many are there" after a top-N cut can now answer it: a grouped `query_dataset` whose `limit` is below the group count answers `truncated: true` and the full count, and an answer that was not cut answers `totalGroups` equal to `rowCount`.

The count is the database's. The one SQL statement that groups and cuts the answer carries a window count over its groups (`COUNT(*) OVER ()`, after the `GROUP BY` and ahead of the `ORDER BY` and `LIMIT`), so it costs no second read and no group is fetched to be counted. Where no such statement ran, `totalGroups` is absent rather than computed some slower way: a grid the executor assembles from several queries (a measure with its own filter, a derived measure, `compareTo`) or orders by a display label, a query served by the engine's aggregate (a date bucket, a field-to-field filter, an external object, a driver with no raw SQL), and a SQL dialect the analytics strategy does not know. Read `totalGroups` as optional.

Only the AI tool asks for the count. The REST dataset door, dashboards and reports run the statement they ran before.
