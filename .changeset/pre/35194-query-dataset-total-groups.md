---
'@objectstack/spec': minor
'@objectstack/service-analytics': patch
---

feat(service-analytics): `query_dataset` says how many groups existed before the `limit` cut (`totalGroups`), as `aggregate_records` does

Clause-②: yes (widening: QueryDatasetOutputSchema gains totalGroups)
Metadata-protocol: added
Skills-docs: follow-up #35203

`QueryDatasetOutputSchema` gains an optional `totalGroups`: how many groups the selection formed before `offset` and `limit` cut them, the same name and meaning as `aggregate_records`' `totalGroups`. A client asked "how many are there" after a top-N cut can now answer it: a grouped `query_dataset` whose `limit` is below the group count answers `truncated: true` and the full count, and an answer that was not cut answers `totalGroups` equal to `rowCount`.

The count never costs a read. Where the window is pushed into the one SQL statement that grouped the answer, the database counts the groups in that statement (`COUNT(*) OVER ()`, after the `GROUP BY` and ahead of the `ORDER BY` and `LIMIT`). Where the window is applied in memory, the count is the length of the grid before the window: an order by a display label (the tool's own order, used when none is sent, sorts every selected dimension, so grouping by any select or reference field brings this in; an order by measures alone does not), a grid assembled from several queries (a measure with its own filter, a derived measure, `compareTo`), and a query the engine's aggregate serves, such as a date bucket, a field-to-field filter, an external object or a driver with no raw SQL. That grid is counted only when every read that built it came back whole; a grid that a cap or row guard cut before the window answers no count.

`totalGroups` is absent when: the window was pushed down and the SQL dialect is not one the analytics strategy knows, or a selected member is itself named `__os_group_count`, or the page came back empty after an `offset`; a read was served by a strategy that does not vouch for its grid, such as one a host adds, or was cut by a cap under it; or the dataset's object is missing and the answer is the empty one served for it. Read `totalGroups` as optional.

Only the AI tool asks for the count. The REST dataset door, dashboards and reports run the statements they ran before.
