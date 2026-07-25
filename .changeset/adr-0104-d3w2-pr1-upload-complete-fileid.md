---
"@objectstack/spec": patch
"@objectstack/service-storage": patch
"@objectstack/client": patch
---

feat(storage): surface the sys_file id on upload-complete — ADR-0104 D3 wave 2 (PR-1)

`POST /api/v1/storage/upload/complete` now returns the opaque `sys_file` id
(`data.fileId`), and `client.storage.upload()` surfaces it on the returned
`FileMetadata`. Previously the commit response omitted the id — the caller
could not learn which id to persist after committing an upload, so a file
field could never store a reference.

Additive and non-breaking (new optional `fileId` on `FileMetadataSchema`; the
client falls back to the presigned id when talking to an older server). This is
the enabling foundation for file-as-reference; the storage model itself is
unchanged in this PR.
