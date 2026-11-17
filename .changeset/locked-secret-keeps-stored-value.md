---
'@objectstack/objectql': patch
---

fix(objectql): a read-only secret field keeps its stored value on update

Clause-②: no
Metadata-protocol: none

A field the caller may not write keeps its stored value, whatever its type. This now holds for a `secret` field on both update paths, by id and by predicate (`multi: true`):

- A `secret` field locked by a TRUE `readonlyWhen`, or declared static `readonly`, takes no caller write. The stored reference is unchanged, and no `sys_secret` row is written for the value the caller sent.
- The read-only strip reports the field like any other: `onFieldsDropped` names it (`readonly_when` or `readonly`), and `strictReadonlyWrites` refuses the write with `ERR_READONLY_FIELD_REJECTED`.
- As for any `readonlyWhen` field, `isSystem` does not exempt a caller value on a locked `secret`; a system write still sets a static `readonly` one.

Unchanged: an unlocked `secret` is sealed and stored as a reference, and a value a `beforeUpdate` hook writes on a locked `secret` is kept.
