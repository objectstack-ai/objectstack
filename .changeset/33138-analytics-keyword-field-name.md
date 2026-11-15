---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a dataset over a field named after a SQL keyword answers rows instead of 500

Clause-②: yes (widening) — `POST /api/v1/analytics/dataset/query`, the `query_dataset` tool and `/api/v1/analytics/query` answer rows for a dimension, measure or filter on a base-table field whose name is a SQL keyword (`order`, `group`, `select`, …), where they answered `500 DATABASE_ERROR`. Every other statement answers the same rows; its text now writes base-table columns quoted (`"stage" = $1`), as it already did when the statement joined another table.
Metadata-protocol: none

The native SQL compiler wrote a base-table column bare whenever the statement joined nothing, so a lookup dimension on a relationship field named `order` reached the database as the keyword (`near "order": syntax error`). On PostgreSQL a bare `user` is `CURRENT_USER`, so a field named `user` would have grouped every row under the database role. A plain identifier in a cube member's `sql` is now always read as a column of the base table, in every statement.
