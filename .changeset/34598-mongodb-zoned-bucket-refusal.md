---
'@objectstack/driver-mongodb': patch
---

fix(driver-mongodb): refuse a non-UTC date-bucket timezone on a direct `aggregate()` call instead of answering UTC buckets

Clause-②: no
Metadata-protocol: none

`MongoDBDriver.aggregate()` now refuses a query that carries a non-UTC `timezone` (`DriverAggregateQuery.timezone`) together with a `dateGranularity` group-by item, answering `NOT_IMPLEMENTED` / 501 before anything is sent to the server. It used to ignore the zone and return UTC calendar buckets with no word. This driver does not declare `supports.zonedDateBucketing`, so `engine.aggregate` never sends it a zone and buckets such a query in memory; only a caller that goes around the engine is affected. No `timezone`, or `UTC`, buckets in UTC as before, and a `timezone` on a query with no date bucket is still ignored.

Fix for a direct caller: route the query through `engine.aggregate`, or drop the `timezone` and accept UTC buckets.
