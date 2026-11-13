---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a `date` field still on a Postgres `timestamptz` column reads, writes, filters and buckets the same day

Clause-②: no
Metadata-protocol: none

Publishing a field changed from `datetime` to `date` keeps its `timestamptz` column on Postgres. The driver then wrote a bare day into that column, and Postgres stored it as midnight in the server's time zone; the read folds the stored instant by its UTC day, so with the server ahead of UTC (`Asia/Shanghai`) a date written as `2026-11-12` read back `2026-11-11`. A filter by the day and the date bucket also read the column in the server's zone, so the four doors gave three answers. SQLite and MySQL were not affected.

Every door now uses UTC, the zone the read already used: the write binds the day's UTC midnight, and a filter and a date bucket read the column as its UTC calendar day. The schema sync records which `date` fields sit on a `timestamptz` column from the column catalog it already reads. Nothing a `datetime` field reads changes, the column type is not changed, and no stored value is rewritten. A day written before this fix on such a server keeps the earlier day it was stored as.
