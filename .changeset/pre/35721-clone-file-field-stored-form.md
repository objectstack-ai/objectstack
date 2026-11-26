---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): cloning a record whose file fields are set answers 201

Clause-②: no
Metadata-protocol: none

`POST /data/:object/:id/clone` with no `overrides` answered `400 VALIDATION_FAILED` ("… has an invalid file value: … expected string, received object") for any record holding a file in a `file`, `image`, `avatar`, `video` or `audio` field, single or `multiple`. The clone read the source the way the caller reads it, with each file expanded to its `{ id, name, size, mimeType, url }` object, and inserted that object back; the insert takes a file field's stored value, the `sys_file` id, only.

The clone now reads the source's file fields in their stored form (the bare id, or the list of ids for a `multiple` field). Each one then follows the same rule a clone naming the id in `overrides` already followed: the file's bytes are copied into a new `sys_file` that the clone's field owns, and the source record keeps its own file. A file field named in `overrides` still takes the override. Because a clone with no body now reaches that same copy step, it also gets that path's answer when a source file's `sys_file` row exists but its stored bytes are missing: `500 FileReferenceCopyError`, the error the `overrides` path already returned in that case.
