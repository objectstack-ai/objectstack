---
'@object-ui/plugin-gantt': patch
---

feat(plugin-gantt): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: every Gantt write judges its fields against the object's whole-record lock (`ganttPatchByHand` takes the object definition), through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
