---
'@objectstack/spec': minor
---

`ISecurityService` (`@objectstack/spec/contracts`) gains an optional `getQueryableFields(object, context)`: the field names field-level security lets the caller filter, sort, group or aggregate by on the object, the query-side twin of `getReadableFields` (#20935).

Clause-②: yes (widening)

- It is the exact complement of the fields the engine's field guards refuse when a query names them as a filter, a sort key, a group key or an aggregate input. It is a subset of `getReadableFields`, and the two differ by exactly the fields the caller is served masked: a field whose `maskingRule` applies to the caller is readable (served, its value replaced) and not queryable.
- It fails soft like `getReadableFields`: `undefined` means no answer, `[]` means no field is queryable. A system context gets every field.
- It is optional. A consumer checks `typeof svc.getQueryableFields === 'function'`. When the method is missing, or answers `undefined`, the consumer must treat every field that declares a `maskingRule` as not queryable, whoever the caller is. Falling back to `getReadableFields` alone would admit exactly the masked fields.
