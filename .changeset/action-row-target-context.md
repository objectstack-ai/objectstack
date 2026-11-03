---
'@object-ui/core': patch
---

fix(core): a row action's `${ctx.recordId}` and `${ctx.record.*}` target holes read the row it was opened on

Clause-②: no
Metadata-protocol: none

A `type: 'url'` action shown in a list view's row menu (`locations: ['list_item']`) interpolated `${ctx.recordId}` and `${ctx.record.*}` to empty, so a target such as `/apps/APP/OBJECT/record/${ctx.recordId}/page/PAGE` opened `/apps/APP/OBJECT/record/page/PAGE`. The same action in the record header worked. The row menu dispatches the clicked row under `params._rowRecord` through the page's action runner, and the runner built the `ctx` scope from its own context, which on a list page names no record.

Now a dispatch that carries a row binds `ctx.record` to that row and `ctx.recordId` to its `id` for target interpolation: `type: 'url'` targets, `type: 'api'` targets and the `onSuccess.navigate` hop. The row wins over a page-level record, so a related-list row on a record page reads the child row. This is the rule the runner already applied to a row action's copy templates. `${ctx.selection.ids}` and `${ctx.selection.count}` are unchanged: they stay the grid's checked selection, which opening a row menu does not change.
