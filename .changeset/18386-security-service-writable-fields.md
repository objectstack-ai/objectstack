---
'@objectstack/spec': minor
---

`ISecurityService` (`@objectstack/spec/contracts`) gains an optional `getWritableFields(object, context)`: the field names field-level security lets the caller write on the object, the write-side twin of `getReadableFields` (#18386).

Clause-②: yes (widening)

- It is the exact complement of the fields the write path's field-level-security gate refuses when a payload names them. Neither the object permission nor a field's own rules (`readonly`, `system`, a `formula`, `summary` or `autonumber` type) are part of the answer.
- It fails soft like `getReadableFields`: `undefined` means no answer, `[]` means no field is writable. A system context gets every field.
- It is optional. A consumer checks `typeof svc.getWritableFields === 'function'`. When the method is missing, the consumer may narrow by `getReadableFields` instead, and must say in its response that it did.
