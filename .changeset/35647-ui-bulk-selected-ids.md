---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-ui` actions rule: a bulk action is wired by the list view (`bulkActions`, or a `bulkActionDefs` entry with `execution: 'aggregate'`) and its body reads `input._selectedIds`, not `input.selectedIds`; the new-tab example's `target` uses `${ctx.recordId}` on `record_header`.
