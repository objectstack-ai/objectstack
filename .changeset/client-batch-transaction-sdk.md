---
'@objectstack/client': minor
---

feat(client): typed `data.batchTransaction()` for the atomic cross-object batch (#1604 / ADR-0034 item 4)

Adds `client.data.batchTransaction(operations)` (and the environment-scoped
`client.project(id).data.batchTransaction`) — a typed SDK surface for
`POST {basePath}/batch`, the all-or-nothing cross-object transactional batch
that master-detail saves go through. Reuses `CrossObjectBatchOperation` /
`CrossObjectBatchRequest` / `CrossObjectBatchResponse` from
`@objectstack/spec/api` (also re-exported from the client for convenience);
supports `{ $ref: <opIndex> }` intra-batch parent references.

The method is always atomic and deliberately exposes no `atomic` flag — the
endpoint rejects `atomic: false` with `400 BATCH_NOT_ATOMIC`. Non-atomic
per-object bulk writes stay on `data.batch()` / `createMany` / `updateMany`,
so any best-effort fallback is isolated in the caller's adapter (the ObjectUI
`masterDetailTx` adapter), not in the SDK.
