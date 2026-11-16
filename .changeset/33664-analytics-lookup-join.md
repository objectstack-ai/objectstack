---
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/service-analytics': patch
---

fix(analytics): a dimension through a lookup is one `LEFT JOIN … GROUP BY` on SQL drivers, so it no longer answers 500 past the bind limit

Clause-②: no
Metadata-protocol: none

`POST /analytics/query` with a dimension through a lookup (`opportunity.stage` on a line-item cube) answered `500 DATABASE_ERROR` once the rows pointed at more distinct related records than the database binds parameters for: SQLite refused with `too many SQL variables`, PostgreSQL with a bind count overflow. The ObjectQL analytics path grouped the base rows by the foreign key, then read the related object with `id IN (every distinct key)` and re-bucketed the answer in the service.

On the SQL driver (every dialect, and the WASM SQLite driver) the same query is now one statement. The base aggregate `LEFT JOIN`s the related rows the caller may read and groups by the attribute in the database, with no id list and no bound-parameter ceiling. The related rows are the related object's own aggregate, planned as the caller, the read the old path ran without its id list. Its CRUD gate, read middlewares, row scope and field-level gate all apply, and the tenant wall bounds the joined table. A line whose related record is missing, unreadable, in another tenant or not set still counts under `(restricted)`, as before. Every bucket and measure is the one the old path answered.

The request is an engine-internal read option, so nothing a client sends changes and the public `groupBy` still refuses a dotted path. The in-memory driver, MongoDB, OData and Turso keep the old path for this dimension, unchanged.
