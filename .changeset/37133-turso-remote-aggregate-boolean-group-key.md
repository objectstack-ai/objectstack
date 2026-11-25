---
'@objectstack/driver-turso': patch
---

fix(driver-turso): remote aggregate group keys over a boolean answer true/false, as local mode does

Clause-②: no
Metadata-protocol: none

On the remote face of `TursoDriver` (a `libsql://`, `https://` or `http://` database, as hosted environments use), `aggregate()` returned group-key columns exactly as the libSQL client hands them back. A group over a declared boolean field came back as `1` / `0` (and `null`), where the local and replica faces answer `true` / `false` / `null`. Reports, charts and `aggregate_records` grouped by a field such as "done" showed `0` / `1` on a hosted environment.

Group-key columns now take the same read presentation `find()` applies to the column, keyed by the output column (`alias ?? field`), exactly as the local face does. Other declared kinds the shared presenter covers (date, time, datetime, audit timestamps, numbers) are presented the same way. Measures are unchanged: counts and totals are numbers as before, and `min` / `max` over a boolean still answer `0` / `1`.
