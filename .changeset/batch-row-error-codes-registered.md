---
"@objectstack/spec": minor
---

feat(spec): register `ROLLED_BACK` / `NOT_ATTEMPTED` batch-row error codes; record the batch-row shape migration (#4793)

Support for the `@objectstack/metadata-protocol` v17 batch-row migration
(#4793 — see its major changeset for the wire change itself):

- `ERROR_CODE_LEDGER` registers two codes under `@objectstack/metadata-protocol`:
  `ROLLED_BACK` (atomic data-batch row was written, then undone by the batch
  rollback) and `NOT_ATTEMPTED` (row never ran — an earlier row's failure
  aborted the batch). They are the structured, `ApiError.code`-level form of
  the message-string prefixes #4620 introduced; `ApiErrorSchema.code` now
  accepts them and clients branch on the code instead of regexing messages.
- The ADR-0087 migration registry gains the protocol-17 semantic entry
  `batch-row-result-schema-shape` (a RESPONSE surface — nothing stored to
  rewrite, so it is a documented TODO for readers of the legacy `row.error` /
  `row.record` keys), and `docs/protocol-upgrade-guide.md` is regenerated
  with it.
- `BatchOptionsSchema.atomic` / `BatchOperationResultSchema.errors` describe
  strings now document the code-based rollback marking (reference docs
  regenerated).

No schema *shape* changes: `BatchOperationResultSchema` already declared
`errors` / `data` / `index` — the runtime caught up to it.
