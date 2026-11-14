---
'@objectstack/driver-sql': patch
---

fix(driver-sql): on SQLite and MySQL, a `date` field whose column a `datetime` → `date` publish left as a date-time column now filters as its calendar day, so a row written while the field was a `datetime` is matched by a filter on the day it reads as

Clause-②: no
Metadata-protocol: none

After a field is published from `datetime` to `date`, the column keeps its date-time type (SQLite `datetime`, MySQL `DATETIME`), and rows written before the publish still hold a time of day. They already read back as their day (`2026-11-12`), but an equality filter on that day (`where: { due: '2026-11-12' }`) compared the bare day against the whole stored instant and missed them, while `$gt` on that day matched them. The schema sync now records such a column on SQLite and MySQL as it already did for a Postgres `timestamptz` column, and every filter door (the query builder and the analytics native-SQL door) reads it as its calendar day: SQLite by the first ten characters of its canonical UTC text, MySQL by `date()` under its UTC session. Writes, reads and the day bucket are unchanged. As with Postgres, an index on such a column no longer serves a filter on the field; only columns a `datetime` → `date` publish left behind are affected.
