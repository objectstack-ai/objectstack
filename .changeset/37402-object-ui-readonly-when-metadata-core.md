---
'@objectstack/metadata-core': patch
---

feat(metadata-core): the field-level-security scrub keeps an object's whole-record hand lock closed for a caller who cannot evaluate it

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

`uiReadonlyWhen` on the object is classified in the object-schema FLS reference table. Where its predicate reads a field denied to the caller, it is served as the constant predicate `true` instead of being deleted: the console fails the hand lock closed and no server judges it, so deleting the predicate would silently open every record for exactly that caller. A field's own `uiReadonlyWhen` still wins over it.
