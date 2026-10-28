---
'@objectstack/spec': minor
---

feat(spec): a record-scoped field projection, judged on the stored row by the write gate

Clause-②: yes (widening)
Metadata-protocol: added

`GetRecordFieldAccessResponseSchema` (`@objectstack/spec/api`) declares the answer of `GET /api/v1/data/{object}/{id}/field-access`: `{ object, recordId, readable, editable }`, the field projection of ONE record. `ISecurityService` declares its source as the optional `getRecordFieldAccess(object, recordId, context)`: `editable` is the write gate's own verdict on an update of the stored row, so a field permission whose `when` names only some rows locks the field only on those rows, and `readable` is the row-blind read projection. `null` means the caller has no row there (absent or unreadable, deliberately the same answer); `undefined` means no answer.

The `FieldPermissionSchema.when` description now names that reader: the row-less readers (`/auth/me/permissions`, the object-wide field projections, the write preview on an update) keep reporting a row-conditioned entry as its lock, and the record-scoped projection judges it on the row. Nothing an author writes changes meaning.
