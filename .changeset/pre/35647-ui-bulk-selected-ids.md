---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-ui` actions rule: no bulk body receives `input.selectedIds`. A name in the list view's `bulkActions` runs the action once per ticked row, its body reading `ctx.recordId` (how the example now writes rows); only a `bulkActionDefs` entry with `operation: 'custom', execution: 'aggregate'` runs it once, the ids in `input._selectedIds`. Also: the new-tab example's `target` uses `${ctx.recordId}` on `record_header`.
