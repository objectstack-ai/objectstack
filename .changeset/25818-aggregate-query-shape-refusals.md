---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql,metadata-protocol): an aggregate query that would answer a wrong table is refused 400, and an empty aggregate list no longer answers "not registered"

Clause-②: no
Metadata-protocol: none

- **Date bucket on a non-date field.** `engine.aggregate` refuses a `groupBy` entry whose `dateGranularity` buckets a field the object declares neither a `date` nor a `datetime`: `INVALID_FIELD` / 400, `path: 'groupBy.N.dateGranularity'`. Before, every row fell into one `null` bucket (a `number` field into a `1970-01` bucket) under 200. A `formula` or undeclared field is not judged.
- **Two columns under one name.** `engine.aggregate` refuses a query whose aggregated row would carry two values under one column: an aggregation `alias` used twice, an alias equal to a group column (the field name, or the entry's own `alias`), or two group entries projecting one column. `INVALID_QUERY` / 400, `path` at the second position (`aggregations.1.alias`, `groupBy.1.field`). Before, the last value written won under 200: a count overwritten by a sum, or the group keys replaced by counts. Give the entry its own `alias`.
- Both refusals run at the engine's `aggregate` entry, before any driver is asked, so the REST query door, its dispatcher twin, the analytics ObjectQL strategy and the MCP data bridge answer alike.
- **Empty aggregate list.** `POST /data/:object/query` with `aggregations: []` (or `groupBy: []`, or both) and no non-empty axis beside it answers `400 INVALID_QUERY` naming `query.aggregations` (or `query.groupBy`) as empty. Before, it answered `404 OBJECT_NOT_FOUND`, "Object '…' is not registered", for a registered object. An empty list beside a non-empty axis is served as before.
