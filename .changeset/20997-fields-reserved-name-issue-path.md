---
'@objectstack/spec': patch
---

fix(spec): `ObjectSchema.fields` refuses `constructor` and `prototype` at the offending key (`fields.constructor`, `fields.prototype`), not at the `fields` slot

Clause-②: no

A field map carrying a key named `constructor` or `prototype` is refused, as before. The
refusal used to be reported at the path `fields`, which names no field, so a form reading the
structured issues of a refused save could not point at the field that caused it. It is now
reported at that key, like the `__proto__` refusal (`fields.__proto__`) and the key grammar's
`invalid_key` refusal (`fields.Bad Name`) already are. A document carrying both names gets two
issues, one at each key, where it used to get one at the slot.

Nothing else moves. The same keys are refused and the same documents are accepted. The issue
code (`custom`) and the message are unchanged. The published JSON Schema states the same ban:
it is now written as one `propertyNames` clause per name inside `allOf` instead of one clause
naming both, which accepts and refuses exactly the same documents.
