---
"@objectstack/driver-sql": patch
---

fix(driver-sql): an unknown `$select` column must not zero the result set

`find()` swallowed any "no such column" error into an empty array. A projected
`$select` naming a column the table lacks (e.g. a generic list view
auto-requesting `status`/`due_date`/`image` on an object without them) then made
the WHOLE query return zero rows — reading to the UI as "no records exist" while
the data was actually there: a silent data-loss footgun.

When the failure comes from the projection, retry once with `SELECT *` so the
real rows still come back (the phantom field is simply absent from each row).
Non-projection errors (unknown table, etc.) still surface as before. This driver
backstop holds even when the engine's unknown-field filter cannot fire because
the object's schema is not populated in the registry (notably the cloud
multi-tenant runtime).
