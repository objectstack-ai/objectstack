---
'@objectstack/spec': minor
---

feat(spec): `BulkActionResultSchema`, the per-row outcome an `execution: 'aggregate'` bulk action handler may resolve with

Clause-②: yes (widening) — a new optional public shape and its three exports (`BulkActionResultSchema`, `BulkActionResult`, `BulkActionResultParsed`) from `@objectstack/spec/ui`; nothing an author writes is accepted or refused differently
Metadata-protocol: none

An aggregate bulk action is ONE dispatch for the whole selection, with every id in `params._selectedIds`. A handler that writes row by row can move some rows and fail on others, and until now the action contract had no declared way to say which: the grid could only report one outcome for the selection.

`BulkActionResultSchema` (`@objectstack/spec/ui`, beside `BulkActionExecutionSchema`) is that answer:

```ts
{ succeeded: string[]; failed: { id: string; message: string }[] }
```

- It is the handler's whole RESOLVE value. A run that wrote some rows and refused others still resolves, with a non-empty `failed`, the way `BatchUpdateResponseSchema` reports per-row results in the success body.
- A rejection stays one outcome for the selection. The `/actions` door carries no structured body on a script or flow handler's throw, so a per-row result is never attached to a rejection.
- It is optional. A handler that resolves with nothing, or with a value of its own, keeps today's one-outcome report; a reader parses the value only for an `execution: 'aggregate'` dispatch and falls back when it does not parse. Members beyond the two lists are tolerated and carry no meaning, so a handler may return a summary beside them.
- Every id must be one of the dispatched `params._selectedIds`. An id outside the selection is a handler bug: the reader drops it and counts it nowhere.

FROM no declared per-row answer for an aggregate handler TO an optional, exported `BulkActionResultSchema`. Nothing to migrate: a handler that does nothing keeps the behaviour it has. To report per row, catch each row's failure in the handler and resolve with `{ succeeded, failed }` instead of throwing after a partial move.
