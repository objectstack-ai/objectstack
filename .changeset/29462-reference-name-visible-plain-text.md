---
'@object-ui/fields': patch
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

feat(fields, spec): a `referenceNameVisible` lookup or user field shows the name of a record the reader may not open as plain text, and the field form offers the key

Clause-②: no
Metadata-protocol: none

The console half of `FieldSchema.referenceNameVisible`, after its server half began serving the name:

- **Lookup and user cells, and the record page.** When `$expand` answers a reference as `{ id, name, readRefused: true }` (the reader may read the record carrying the field, but not the record it points at), the lookup cell and the user cell draw `name` as plain text: no link to the record, no hover card, and no read of that record or of its object. A `multiple: true` field draws one text chip per such element, and its other elements keep their faces. The floor name `Record #` with the id is drawn exactly as served. The record page's field grid draws these values through the same cells.
- **Unchanged.** A field without the key, and a target the reader can read, keep today's faces: a readable record is a link, and a bare id the reader's own read answers "not found" for keeps the restricted-record placeholder.
- **Field form.** The `field` metadata form gains a `referenceNameVisible` switch ("Show Name When Unreadable"), shown on `lookup` and `user` fields only, the types the schema accepts the key on. Its label and help text are translated for `zh-CN`, `ja-JP` and `es-ES`.
