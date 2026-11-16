---
'@objectstack/spec': minor
---

feat(spec): `BulkActionResultSchema`, the per-row outcome an `execution: 'aggregate'` bulk action handler may resolve with

Clause-②: yes (widening) — a new optional public shape and its three exports (`BulkActionResultSchema`, `BulkActionResult`, `BulkActionResultParsed`) from `@objectstack/spec/ui`; nothing an author writes is accepted or refused differently
Metadata-protocol: added

An aggregate bulk action is ONE dispatch for the whole selection, with every id in `params._selectedIds`. A handler that writes row by row can move some rows and fail on others, and the action contract had no declared way to say which: the grid can only report one outcome for the selection.

`BulkActionResultSchema` (`@objectstack/spec/ui`, beside `BulkActionExecutionSchema`) declares that answer, ahead of its reader:

```ts
{ succeeded: string[]; failed: { id: string; message: string }[] }
```

- **[PLANNED — not enforced].** The console does not read this value yet; its reader is the grid's bulk reader, objectstack#34269. Until that lands, a resolved aggregate call is counted as covering every selected row, so **a handler that cannot cover the whole selection must still reject.**
- It is declared as the handler's whole RESOLVE value, never attached to a rejection: a rejection stays one outcome for the selection, because the `/actions` door carries no structured body on a script or flow handler's throw.
- It is not the data plane's batch answer: here `succeeded` and `failed` are the row lists, not counts, and a failure's reason is `message`.
- Once read, only for an `execution: 'aggregate'` dispatch: a value with neither member keeps the one-outcome report; a value with either member that does not parse is reported as unreadable, never as full success; members beyond the two lists carry no meaning.
- Ids must be dispatched `params._selectedIds`: an id outside the selection is dropped, a duplicate counts once, an id in both lists counts as failed, and a selected id in neither list is reported as not confirmed, never as succeeded.

FROM no declared per-row answer for an aggregate handler TO a declared, exported `BulkActionResultSchema` whose reader is objectstack#34269. Nothing to migrate, and nothing to change in a handler today: until the reader lands, keep rejecting when the whole selection is not covered.
