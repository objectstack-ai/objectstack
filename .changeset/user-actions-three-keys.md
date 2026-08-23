---
'@objectstack/spec': minor
---

`UserActionsConfigSchema` adopts `group`, `hideFields` and `rowColor` (ruled Option A on objectui#5435): the three toolbar affordances ListView already honours become authorable in a spec-valid document, so the runtime fold of legacy `showGroup`/`showHideFields`/`showColor` flags now passes the save gate instead of being rejected by name. All three are booleans; the defaults copy the renderer's reads — `group` defaults on, `hideFields`/`rowColor` default off. Accept-set widening only: no existing document changes meaning, and the object-level `userActions` block (create/import/edit/delete/exportCsv) still rejects all view-vocabulary keys by name.
