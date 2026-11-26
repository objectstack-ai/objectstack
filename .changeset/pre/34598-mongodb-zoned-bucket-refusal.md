---
'@objectstack/driver-mongodb': patch
---

fix(driver-mongodb): refuse a non-UTC date-bucket timezone on a direct `aggregate()` call instead of answering UTC buckets

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is one runtime answer of MongoDBDriver.aggregate() to a direct caller: a non-UTC timezone with a date bucket is refused instead of answered with UTC buckets. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a direct `MongoDBDriver.aggregate()` call that carries a non-UTC `timezone` with a `dateGranularity` group-by item: it used to answer UTC buckets and now answers `NOT_IMPLEMENTED` / 501. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): no metadata author writes a driver query, so `Metadata-protocol` is `none`, and the engine path never sends this driver a zone.

`MongoDBDriver.aggregate()` now refuses a query that carries a non-UTC `timezone` (`DriverAggregateQuery.timezone`) together with a `dateGranularity` group-by item, answering `NOT_IMPLEMENTED` / 501 before anything is sent to the server. It used to ignore the zone and return UTC calendar buckets with no word. This driver does not declare `supports.zonedDateBucketing`, so `engine.aggregate` never sends it a zone and buckets such a query in memory; only a caller that goes around the engine is affected. No `timezone`, or `UTC`, buckets in UTC as before, and a `timezone` on a query with no date bucket is still ignored.

Fix for a direct caller: route the query through `engine.aggregate`, or drop the `timezone` and accept UTC buckets.
