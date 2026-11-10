---
'@objectstack/spec': minor
---

feat(spec): a batch dataset-query request and answer beside the single `POST /analytics/dataset/query` shapes, each query answered or refused on its own (#32203)

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none in this change — `content/docs/data-modeling/analytics.mdx` ("How it runs") documents the single dataset door; its batch sentence is owed when the server mounts the batch door (#32200), and no page under `skills/**` documents the dataset query door.

`@objectstack/spec/api` exports the contract of a batch dataset query, for the server door and the console client that follow it:

- `DatasetQueryBatchRequestSchema`: `{ queries: [...] }`, an ordered list of one to `DATASET_QUERY_BATCH_MAX_QUERIES` (50) single-door bodies (`{ dataset | datasetName, selection, previewDrafts? }`). A query is named by its position. The batch does not parse a query's members: each is judged by the single door, as the same caller.
- `DatasetQueryBatchEntrySchema`: one answer entry, either `{ data }` (the single door's `AnalyticsResult`) or `{ status, error }` (the single door's HTTP status and its refusal in the house error envelope, `ApiErrorSchema`).
- `DatasetQueryBatchResponseSchema`: the house success envelope around `data.results`, one entry per query in request order. One refused query never fails the others; only a malformed batch (empty, over 50, a query that is not an object) is refused whole, `400 VALIDATION_FAILED`.

Their `z.input` types and `Parsed` aliases are exported beside them. The single dataset door's request and answer shapes do not change.
