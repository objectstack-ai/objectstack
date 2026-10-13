---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

A file field whose `sys_file` read was refused to the reader reads as refused, not as "no file"

Clause-②: yes

The engine expands a stored file id (`file` / `image` / `avatar` / `video` / `audio`) by reading `sys_file` as the caller. A reader who may read the record but not `sys_file` (the default for any member whose application grants no `sys_file` read) is refused that read, and the field used to come back as the bare id: the same value an id with no committed file row produces. A refused file and an absent one were one answer, and the server logged a `warn` per read telling the operator to check storage availability.

- **From.** `{ "attachment": "f_7cQx2Lm90a" }` for a reader refused `sys_file`, plus `warn: sys_file lookup failed; file fields keep their raw ids and will render as "no file"`.
- **To.** `{ "attachment": { "id": "f_7cQx2Lm90a", "metadataRefused": true } }`. Multi-value fields mark each id. Nothing else is served, because nothing else was read: no `name`, `size`, `mimeType` or `url`. A consumer that needs the download link derives the stable `/api/v1/storage/files/:fileId` endpoint from the id, as it does for a bare id; the download door judges access by the record that owns the file. The refusal is logged at `debug` only, because the reader is told in the value.
- **Unchanged.** A reader allowed to read `sys_file` gets the hydrated `{ id, name, size, mimeType, url }`. An empty field reads empty. A missing `sys_file` table still leaves the bare id, silently. Any other read failure (connection, timeout, a database-level ACL fault such as `42501`) still leaves the bare id with the `warn`. Only the security layer's `PERMISSION_DENIED` refusal takes the new form.

`@objectstack/spec` declares the shape: `FileRefusedValueSchema` / `FileRefusedValue` (`{ id, metadataRefused: true }`, closed), and `valueSchemaFor(def, 'expanded')` for the file types admits it beside the bare id and `FileValueSchema`. It is a read form only. The stored form stays the bare id.

**For consumers.** Code that reads a file field's expanded value as `string | FileValue` should handle the third form: an object with `metadataRefused: true` and no `url` is a file this reader may not see the details of, not an empty field.
