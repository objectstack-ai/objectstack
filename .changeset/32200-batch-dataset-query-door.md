---
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(rest, client): `POST /analytics/dataset/query/batch` answers several dataset queries in one request, each judged by the single dataset door as the same caller (#32200)

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: none in this change — `content/docs/data-modeling/analytics.mdx` ("How it runs") gains the batch paragraph; no page under `skills/**` documents the dataset query door.

A dashboard render used to send one `POST /analytics/dataset/query` per widget (18 on Chart Gallery). The new batch door takes `{ queries: [...] }` (the contract `DatasetQueryBatchRequest` from `@objectstack/spec/api`, at most 50) and answers `{ success: true, data: { results } }`, one entry per query in request order: `{ data }` for an answered query, `{ status, error }` for a refused one, the refusal mapped into the house error envelope. One refused query never fails the others.

- Each query is judged by the single door's own judgment, now one shared function: the same body checks, the same dataset resolution by package (a name two packages hold answers that query's `409 RESOURCE_CONFLICT` naming both), the same per-caller draft admission and the same error classification. `?package=` and `?preview=draft` on the batch URL apply to every query; a repeated one refuses the batch.
- A malformed batch is refused whole with `400 VALIDATION_FAILED` and nothing runs. A refusal that depends on no query (not authenticated, no analytics service) answers the whole request with the single door's status, in the house error envelope.
- Queries run at most six at a time; the answer's order does not depend on it.
- `@objectstack/client` adds `client.analytics.queryDatasetBatch(queries)`, typed with the single door's body (`DatasetQueryBody`, now exported and also the parameter type of `queryDataset`). It resolves to `{ results }` and throws when the whole batch is refused.

The single dataset door's answers do not change: every arm was measured byte for byte before and after the move.
