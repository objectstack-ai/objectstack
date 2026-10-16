---
'@objectstack/spec': minor
'@objectstack/metadata-core': patch
'@objectstack/driver-sql': patch
'@objectstack/platform-objects': patch
---

feat(spec): `referenceDeletedWhen` beside `referenceVia` marks a polymorphic pointer's target as platform-deleted

Clause-②: yes

`FieldSchema` gains one optional key beside `referenceVia`: `referenceDeletedWhen: { field, value }`. On rows where the sibling `select` field `field` holds the option `value`, the record the pointer names was deleted by the platform's own assertion, and a renderer draws a tombstone from that option's own label instead of a link. Example: `record_id: Field.text({ referenceVia: 'object_name', referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' } })`.

Any other shape is refused at parse, naming the field and the option:

- the key on a field that declares no `referenceVia` (`FieldSchema`), or an unknown key inside it;
- a `field` that is the declaring field itself, is not declared on the object, is not a `select`, is a `multiple: true` select, or declares no inline `options` (a `picklist`-backed select); a `value` that is not one of the sibling's option values (`ObjectSchema`, at every door: `ObjectSchema.create()`, `defineStack`, raw `.parse()` and the metadata save door).

Nothing that parsed before is refused: the key is new. Its liveness row is `planned` until the renderer that reads it ships.

The other packages classify the new key where every field key is classified:

- **`@objectstack/metadata-core`.** `FIELD_REFERENCE_POSITIONS` deletes a served field's `referenceDeletedWhen` when its `field` names a field the caller cannot read (field-level security); `value` is an option value and never a field name.
- **`@objectstack/driver-sql`.** `FIELD_KEY_STORAGE_CLASS` classifies it `presentation`: no DDL reads it.
- **`@objectstack/platform-objects`.** The field form's new `referenceDeletedWhen` row carries its labels and help text in zh-CN, ja-JP and es-ES.
