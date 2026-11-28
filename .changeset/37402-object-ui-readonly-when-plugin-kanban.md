---
'@object-ui/plugin-kanban': patch
---

feat(plugin-kanban): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: a card drag judges the lane field against the object's whole-record lock at the drop, through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
