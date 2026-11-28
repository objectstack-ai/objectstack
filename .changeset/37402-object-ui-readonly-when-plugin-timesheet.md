---
'@object-ui/plugin-timesheet': patch
---

feat(plugin-timesheet): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: a timesheet cell edit judges the value field against the object's whole-record lock, through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
