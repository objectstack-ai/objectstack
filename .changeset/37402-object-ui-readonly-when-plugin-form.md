---
'@object-ui/plugin-form': patch
---

feat(plugin-form): the object's whole-record hand lock (`uiReadonlyWhen`) holds here

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

An object's `uiReadonlyWhen` is the hand lock of every field that declares none of its own: the create and edit dialogs' form fields and the line-item grid's columns carry the EFFECTIVE hand-lock predicate (a field's own, else the object's; a child field's own, else the child object's), through the one verdict of `@object-ui/core`. The wizard's final-submit required re-check does not judge the hand lock on a CREATE wizard (as the form renderer does not), so an object lock TRUE over a new record's values cannot skip that check. Writes outside the console are unchanged.
