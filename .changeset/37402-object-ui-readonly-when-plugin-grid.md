---
'@object-ui/plugin-grid': patch
---

feat(plugin-grid): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: a grid cell judges its field against the object's whole-record lock, and the grid's own row load fetches that predicate's operands (`cellReadOnlyKind` takes a required `object`), through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
