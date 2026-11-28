---
'@objectstack/lint': patch
---

feat(lint): `os validate` checks an object's `uiReadonlyWhen` as it checks a field's

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

The whole-record hand lock has no server judge, so this pass is the only place an author hears about a broken one: it must parse, read the record's own columns as `record.FIELD` (never a bare field), name only declared fields, and read only the roots the field-rule slots bind — the same record-scoped check and root verdict a field's `uiReadonlyWhen` gets, reported at `object 'NAME' uiReadonlyWhen`.
