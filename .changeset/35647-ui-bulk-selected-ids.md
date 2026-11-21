---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-ui` actions rule: a bulk action is wired by the list view. Under `bulkActions` the body runs once per ticked row with `recordId`; only a `bulkActionDefs` entry with `operation: 'custom', execution: 'aggregate'` hands the body `input._selectedIds` (not `input.selectedIds`). Also: the new-tab example's `target` uses `${ctx.recordId}` on `record_header`.
