---
'@objectstack/core': patch
---

fix(core): an import row with several bad cells reports every one of them in `errors` (#25582)

Clause-②: yes (widening: a failed import row whose cells did not coerce gains the optional `errors` list, `ImportRowResultSchema.errors`; every existing key keeps its value)
Metadata-protocol: none
Ruling-ref: #25582 ruling `6377844879` letter A, proposal 4; the spec seat's fill rule `6434667735`

A row with several bad cells used to report only the first one, so an operator fixed one cell, imported again, and only then saw the next. The row now carries `errors`, one `{ field, code, message }` element per failed cell, in column order. The first-error keys `field`, `code` and `error` are unchanged and name element 0, so a reader of those keys sees the same answer as before.

- It reaches every path that reports rows: the dry run and the commit, on the synchronous `POST /api/v1/data/:object/import` and on the async import job's results.
- It is filled only from the import's cell-coercion errors (`invalid_date`, `invalid_number`, `invalid_option` and the rest). A row that failed for another reason omits it: the dry run's validate verdict, a refused write, a duplicate or ambiguous match key.
- `ImportRowResult` (`@objectstack/core`) gains the optional `errors?: ValidateDataIssue[]`.
