---
'@object-ui/plugin-calendar': patch
---

feat(plugin-calendar): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: an event drag judges the start and end fields against the object's whole-record lock at the drop, through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
