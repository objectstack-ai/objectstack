---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `aggregate()` and `distinct()` honour `external.columnMap` on every dialect

Clause-②: no
Metadata-protocol: none

A federated object whose `external.columnMap` names a remote column different from the field could not be aggregated or listed for distinct values. `find()`, `count()` and every WHERE already read through the map, but `aggregate()` named the field verbatim in its GROUP BY, its date-bucket expression and its aggregand, and `distinct()` named it in `SELECT DISTINCT`. The remote table was asked for a column it does not have. On SQLite, PostgreSQL and MySQL that surfaced as the driver's unresolvable-column refusal.

Both doors now spell every identifier as the remote column and keep the field everywhere the caller reads: as the output key, in the presentation (`min`/`max` over a mapped date, a mapped boolean's distinct values) and in the per-field registries. An object without a `columnMap` compiles exactly the statement it compiled before.
