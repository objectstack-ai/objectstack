---
"@objectstack/spec": minor
---

feat(spec): allow the aggregate bulk dispatch key `_selectedIds` through the action param gate (objectui#3139)

A list view's `bulkActionDefs` entry can now opt into an aggregate single-call
dispatch (`execution: 'aggregate'`, objectui 17.1): the renderer invokes the
named object action ONCE for the whole selection, injecting every selected
record id as `params._selectedIds: string[]`, so a single call can produce one
aggregate artifact (zip of QR codes, merged PDF, batch print job).

`ACTION_PARAM_BUILTIN_KEYS` gains `'_selectedIds'` so the ADR-0104 strict
param gate does not 400 an aggregate dispatch against an action that declares
params — like `recordId`/`objectName`, the key is dispatcher-injected and can
never be authored as a declared param. Pure widening: actions declaring no
params were never validated, and no authored bag legitimately carried this
key. The `bulkActionDefs` describe now documents the aggregate contract
(server reads `params._selectedIds`, results are all-or-nothing, `batchSize`
does not apply, set `maxRecords` for expensive aggregates, and toolbar
url/api actions can interpolate `${ctx.selection.ids}`).

The showcase's Task → Bulk Actions view carries the specimen:
`showcase_recalc_selection` dispatches the recalc endpoint once for the whole
selection via the endpoint's new `_selectedIds` batch branch, next to the
per-record fan-out fixtures.
