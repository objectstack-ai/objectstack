---
'@object-ui/types': minor
'@object-ui/core': minor
'@object-ui/data-objectstack': minor
'@object-ui/plugin-grid': minor
---

Clause-②: yes
Metadata-protocol: none

A list bulk action keeps each failed record's id and the server's reason, and a bulk run refreshes the bound list once instead of once per row (objectui#13442).

A 100-row bulk update took about 100 s in the console for about 19 s of server work. `bulkUpdate` read only the server's `succeeded` count, so a partial failure reached the result dialog and the error CSV as one `batch_0: N records failed` entry with no record id or reason. Apps that needed the reason ran `batchSize: 1`, and on that per-row path every write refetched and re-rendered the whole list.

- `DataSource.bulkUpdate` / `bulkDelete` (`@object-ui/types`) may now resolve to a `BulkWriteResult`, `{ succeeded, errors: [{ id, error }] }`, as well as to a plain count. Both new types are exported. An adapter that returns a number keeps working unchanged. A caller that reads the result must now handle both shapes; the bulk executor does.
- `ObjectStackAdapter.bulkUpdate` / `bulkDelete` (`@object-ui/data-objectstack`) resolve to a `BulkWriteResult` built from the `results[].errors[]` that `updateMany` / `deleteMany` already answer, and the per-id fallback loop keeps each row's reason instead of discarding it. Breaking for direct callers: these two methods used to resolve to a number. Code that calls them directly and reads the result as a count must read `.succeeded`.
- `executeBulkBatch` (`@object-ui/core`) reports each failure the bulk call names under its own id and reason. Only failures it does not name still fold into one `batch_${offset}` entry. So the result dialog, the error CSV and Retry work per record whatever the `batchSize`, and Undo skips the failed rows.
- New optional `DataSource.batchMutationEvents(work)`: runs `work` with `onMutation` events held, then delivers them when it settles, one per resource and mutation type. `ObjectStackAdapter` implements it. `useBulkExecutor` (`@object-ui/plugin-grid`) runs each bulk run and each undo inside it, so ListView, ObjectView, kanban, calendar and the console's invalidation bridge refetch once per run, not once per row. The executor's `dataSource` face gains the matching optional member.
