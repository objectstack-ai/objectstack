---
'@object-ui/plugin-list': patch
---

feat(plugin-list): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: the list view's `$select` fetches the operands of the object's whole-record lock for every field it edits in place, through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
