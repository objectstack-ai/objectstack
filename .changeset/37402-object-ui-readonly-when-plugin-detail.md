---
'@object-ui/plugin-detail': patch
---

feat(plugin-detail): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: the record page's inline edit, the highlight-strip chip, the save bar's fill-in and the stage path judge a field against its object's whole-record lock, through the one verdict of `@object-ui/core`. Writes outside the console are unchanged.
