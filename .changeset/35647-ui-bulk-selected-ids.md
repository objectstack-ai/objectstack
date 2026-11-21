---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-ui` actions rule: a bulk action that writes rows is named in the list view's `bulkActions` and runs once per ticked row, its body reading `ctx.recordId`. Also: the new-tab example's `target` uses `${ctx.recordId}` on `record_header`.
