---
"@objectstack/service-package": patch
---

Unwrap the mysql2 `[rows, fields]` tuple in the package service's row flattener

On a MySQL/MariaDB-backed deployment (`OS_DATABASE_URL=mysql://…`, which builds a
`SqlDriver` on the `mysql2` client as the default driver), `PackageService.get()` and
`PackageService.list()` reported **"this package is not installed"** and **"no packages
are installed"** over a database that had just returned the rows.

`ObjectQLEngine.execute()` and `SqlDriver.execute()` both pass the underlying client's
result through verbatim, so mysql2's `[rows, fields]` tuple reached the service's local
`normalizeRows` unflattened. The tuple is an array, so it was returned whole; `get()`
then read index 0 — the row *array* rather than a row — and `JSON.parse(undefined)` threw
into the method's own catch, which answers `null`. `list()` failed the same way into `[]`.
Boot-time package hydration read the same empty answer and silently installed nothing.

The flattener now unwraps the tuple, matching the three-dialect coverage its own docblock
already claimed and the `metadata-protocol` sibling already implemented. The bare row
array (better-sqlite3 through knex, Turso) and `{ rows, rowCount }` (pg) shapes are
unchanged, and an empty result in any of the three still answers "no rows" rather than
raising the seam refusal.
