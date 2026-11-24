---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
'@objectstack/spec': patch
'@object-ui/types': patch
---

feat(plugin-grid): an aggregate bulk action that resolves with a `BulkActionResult` is reported per row: the rows it moved, the rows it refused with its own reasons, and the rows it did not confirm

Clause-②: yes
Metadata-protocol: none

The grid's bulk executor now reads the resolve value of an `execution: 'aggregate'` bulk handler. When it is a `BulkActionResult` (`{ succeeded: string[], failed: { id, message }[] }`, `BulkActionResultSchema` in `@objectstack/spec/ui`), the result panel shows how many selected rows were moved, lists each refused row under its record with the handler's `message` (and in the error CSV), and lists every selected row the result names in neither list as "not confirmed", never as succeeded. Ids are read against the dispatched `params._selectedIds`: an id outside the selection is dropped, a duplicate counts once, an id in both lists counts as failed, and when one id is in `failed` twice the first entry's message wins. A rejection is unchanged: it stays one outcome for the whole selection.

A handler that partly succeeds no longer has to reject to avoid being reported as full success: resolve with the per-row answer instead. The `[PLANNED — not enforced]` marker is removed from `BulkActionResultSchema`'s description and its reference page, and the "all-or-nothing" wording is removed from the `bulkActionDefs` description (`@objectstack/spec`) and the `BulkActionDef.execution` TSDoc (`@object-ui/types`).

**Declared behaviour change.** An existing aggregate handler whose own return value carries a top-level `succeeded` or `failed` member in another form (for example counts, `{ succeeded: 2, failed: 1 }`, or only one of the two lists) was reported as full success and is now reported as "unreadable": the panel says the action finished but its result could not be read, prints no per-row count, and the grid re-reads its rows when the dialog closes. To keep the success report, return a value with neither member (a summary under another name), or return both lists in the `BulkActionResult` shape. A handler that returns nothing, or a value with neither member, keeps today's report.

The widening is additive: three new keys in every locale pack `@object-ui/i18n` publishes (`grid.bulk.resultNotConfirmed`, `grid.bulk.notConfirmedRecords`, `grid.bulk.aggregateUnreadable`). No metadata key, value or default changes.
