---
'@objectstack/spec': minor
---

feat(spec): an object declares when a whole record is read-only by hand (`uiReadonlyWhen` on the object)

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

A confirmed order, a posted invoice or a closed ticket is locked as a whole, and writing a `uiReadonlyWhen` on every field was both tedious and easy to get wrong by missing one. The object now carries the hand lock's object level:

- **`ObjectSchema.uiReadonlyWhen`** (CEL over the record's own columns, the same scope as a field's `readonlyWhen`), e.g. `uiReadonlyWhen: P\`record.status in ['confirmed', 'done']\``. While TRUE no person edits any field of an existing record on the console surfaces a field's own `uiReadonlyWhen` locks. A create is not judged.
- **A field's own declaration wins.** A field that declares `uiReadonly: true` or its own `uiReadonlyWhen` is judged by that instead of the object default, in both directions: `uiReadonlyWhen: P\`false\`` keeps a field (notes, internal tags) editable inside a locked record, and a field's own predicate can lock it where the object does not. `uiReadonly: false` is NOT a declaration of its own — it is that key's default, and a Studio switch turned on and off stores it — so such a field follows the object lock; the one opt-out spelling is `uiReadonlyWhen: P\`false\``. A field's server lock (`readonly`, `readonlyWhen`) is not a hand-lock declaration and keeps locking on its own.
- **Every write keeps every field.** The engine never reads the key: REST, import, declarative and script actions and flows write a locked record, judged by the object's validations, and nothing is dropped from the write (`X-ObjectStack-Dropped-Fields` stays absent).
- A predicate the console cannot evaluate locks every field that inherits it, as at the field level; `os validate` checks it. Liveness row `object.uiReadonlyWhen` (live), the Studio object form's Advanced section offers it as a CEL row, and the reference docs, authorable-surface record and state counts are regenerated.
