---
'@objectstack/service-analytics': patch
---

fix(analytics): a `where` key that names no field answers 400 INVALID_FIELD on every analytics door

Clause-②: no
Metadata-protocol: none

An empty filter key (`{"": "z"}`) on `POST /api/v1/analytics/query`, as a dataset's `runtimeFilter` on `POST /api/v1/analytics/dataset/query`, or through the MCP `query_dataset` tool reached the database as `WHERE  = ?` and answered `500 DATABASE_ERROR`. A blank key (`" "`) or a key with a space in it (`"foo bar"`) answered `403 PERMISSION_DENIED` from the field-read gate. All of them now answer `400 INVALID_FIELD` with `field` and `param: 'where'`, as `/data` answers the same body, and nothing reaches the database. A key is a field name when it is an identifier (`status`) or a relationship path ending in one (`account.name`). A cube member the cube declares over its own `sql` keeps working whatever its key is. Nothing to migrate.
