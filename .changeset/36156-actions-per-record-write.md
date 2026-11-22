---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The `objectstack-ui` actions rule teaches the per-record form for a bulk body that writes rows, now that the action doors read a selection in the caller's scope before the action runs:

- A body that writes each selected row is declared `execution: 'perRecord'`, wired by the list view's `bulkActions: ['<name>']`, and writes the row it is handed (`ctx.record`, `ctx.recordId`); a row whose run throws is listed with its message. The rule no longer teaches an `execution: 'aggregate'` handler that writes rows one by one and resolves with `{ succeeded, failed }`.
- On an aggregate dispatch (one run for the selection) a script body or a flow receives the ids under the built-in key `params._selectedIds`, at most 5000 and only ids the caller can read: one the caller cannot read refuses the whole call with `404 RECORD_NOT_FOUND` before it starts.
- What stays of `BulkActionResult` is how an aggregate return value is read: one with a top-level `succeeded` or `failed` is read as a `BulkActionResult`, and any other form of those members is reported as unreadable.
- Eval `views-apps-actions-pages` case 23 (a bulk archive where some rows refuse) expects the per-record form: it requires `perRecord`, `bulkActions: [` and `ctx.record`, and forbids a returned `succeeded` member in either spelling (`succeeded:`, `succeeded,`). The case has a new hash, so `skill-evals --regrade` sets it apart from a round recorded before this change.
