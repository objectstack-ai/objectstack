---
'@objectstack/skills': patch
---

docs(skills): the query skill says where a zoned date bucket is computed

Clause-②: no
Metadata-protocol: none

objectstack-query's `rules/aggregation.md` no longer says a date bucket under a non-UTC `timezone` always keeps the whole aggregate call in memory. A driver that declares `supports.zonedDateBucketing` (PostgreSQL via `driver-sql`) buckets the date in the database when the zone resolves to an area/location (`Asia/Taipei`); on every other driver, and for a zone that resolves to none (`+08:00`, `EST5EDT`), the whole call still runs in memory. One eval case covers the sentence.
