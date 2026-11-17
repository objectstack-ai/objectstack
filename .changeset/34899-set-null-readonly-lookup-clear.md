---
'@objectstack/objectql': patch
---

fix(objectql): deleting a record clears a read-only lookup that points at it

Clause-②: no
Metadata-protocol: none

Deleting a record makes the engine clear every optional lookup that points at it (`deleteBehavior: 'set_null'`, the default). That clear is an update of the referencing row under the caller's context. When the lookup was declared `readonly: true`, or locked by `readonlyWhen`, the read-only rule treated the clear as a value the caller had forged: it logged `... is read-only: the caller-supplied value was DROPPED and the update is being COMMITTED WITHOUT IT`, the delete answered 200, and every referencing row kept the deleted record's id.

The read-only rule now leaves that one key to the engine: the lookup the delete is clearing on that row, at the value the delete writes (`null`, or on a `multiple: true` lookup the remaining ids). No read-only line is logged for it, and the row's `beforeUpdate` hook sees the clear it is about to store. The exemption travels on an engine-internal channel that only the delete holds. A caller update that carries the operation-private `__referentialFieldClear` marker on its context is still stripped, still logged and still refused under `strictReadonlyWrites`. Any other read-only key in the same write is judged as before. `isSystem` is not granted.

Nothing to change in your metadata. Rows that already hold the id of a deleted record keep it: this fix does not rewrite them, so clear them with a system-context update.
