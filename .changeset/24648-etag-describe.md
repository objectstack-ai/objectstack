---
'@objectstack/spec': patch
---

`CompleteUploadRequestSchema.eTag` no longer describes itself as "S3 ETag verification". The upload completion door stores the client-reported value on the file record as sent and compares it with nothing, because no storage adapter reports a stored object's ETag. The description now says so, and names the check the door does run before committing: the storage backend must hold bytes under the file's key and, when the upload declared a size, hold exactly that many. The schema's shape is unchanged.
