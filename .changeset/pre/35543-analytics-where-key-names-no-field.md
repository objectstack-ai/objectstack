---
'@objectstack/service-analytics': patch
---

fix(analytics): an empty or blank `where` key answers 400 INVALID_FIELD on all three analytics doors

Clause-②: no
Metadata-protocol: none

An empty filter key (`{"": "z"}`) on `POST /api/v1/analytics/query`, as a dataset's `runtimeFilter` on `POST /api/v1/analytics/dataset/query`, or through the MCP `query_dataset` tool reached the database as `WHERE  = ?` and answered `500 DATABASE_ERROR`. A blank or whitespace-only key (`" "`, a tab) answered `403 PERMISSION_DENIED` from the field-read gate. Both now answer `400 INVALID_FIELD` with `field` and `param: 'where'` on those three doors, as `/data` answers the same body, and nothing reaches the database. A key that is text but no column reference, such as `amount + 1` or `foo bar`, is unchanged: it still answers `403 PERMISSION_DENIED` from the #21156 member-shape gate. Nothing to migrate.
