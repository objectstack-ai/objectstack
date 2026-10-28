---
'@objectstack/spec': minor
---

feat(spec): the record field-access answer says whether the record itself is writable

Clause-②: yes (widening)
Metadata-protocol: added

`GetRecordFieldAccessResponseSchema` (`@objectstack/spec/api`, the answer of `GET /api/v1/data/{object}/{id}/field-access`) gains `writable: boolean`: whether the caller may update this record at all, judged by the write gate on the stored row (the object's edit permission, record sharing and ownership, row-level security, and the parent's edit access for a record controlled by its parent). `false` means an update of the record is refused whole, whatever it changes. `true` does not promise a save succeeds: a pending approval's record lock, conditional read-only and validation rules on the values sent, and a data source that refuses writes are still judged at save. `editable` is unchanged and stays field-level. `ISecurityService.getRecordFieldAccess` documents the member: the write gate's own verdict, never a second evaluator.

Supersedes, in the same release: the `@objectstack/spec` note "a record-scoped field projection, judged on the stored row by the write gate" lists the answer as `{ object, recordId, readable, editable }`; it is now `{ object, recordId, readable, editable, writable }`.
