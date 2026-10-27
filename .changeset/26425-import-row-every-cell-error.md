---
'@objectstack/spec': patch
---

feat(spec): an import row result can report every cell error of a failed row in `errors`

Clause-②: yes (widening)
Metadata-protocol: none

`ImportRowResultSchema` (and so `ImportResponseSchema.results` and the async job's `results` sample) declares one optional member, `errors`: an array with one element per failed cell of a failed row, in the validate verdict's issue shape (`ValidateDataIssueSchema`: `field`, `code`, `message`), the same element the row's `warnings` already uses. It is present only on a failed row that has at least one cell error. The first-error keys `field`, `code` and `error` stay and keep naming element 0, so every current reader sees the same answer. Before, the schema had no such key, so `ImportRowResultSchema.parse` would strip one. This is the contract half: the import runner fills `errors` in a later change, and until then no server sends it.
