---
'@objectstack/driver-sql': patch
---

fix(driver-sql): on SQLite, a boolean field retyped from text stores `1` / `0`, so a saved `false` no longer reads as `true`

Clause-②: no
Metadata-protocol: none

On SQLite, a field whose type changed from `text` to `boolean` keeps its TEXT column. Every write of that field (create, update, upsert, bulk create, bulk update, update-many) stored `false` as the text `'0.0'` and `true` as `'1.0'`, because the JS number a boolean was bound as reached SQLite as a REAL. Reads then answered `true` for both, `distinct()` and group keys counted every row as `true`, and an `= false` filter disagreed with what the rows showed.

- **Writes.** A declared scalar `boolean` / `toggle` value is now bound as the text `'1'` / `'0'`. A column the driver created still stores the integer `1` / `0`, so its stored form does not change; a retyped TEXT column stores `'1'` / `'0'`, which reads back as the boolean that was written.
- **Filters.** A boolean comparand on such a field is bound the same way, so `= false`, `= true` and `in [false]` select exactly the rows that read as that boolean.
- **Existing rows.** The boot's boolean storage convergence now also rewrites the `'1.0'` / `'0.0'` that earlier writes left, the same as it rewrites `'true'` / `'false'`; `os migrate plan` counts them under `normalize_boolean_storage`. Nothing to run by hand: the next start converges them.
