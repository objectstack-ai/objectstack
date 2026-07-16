---
'@objectstack/service-storage': patch
---

fix(storage): abort the backend multipart upload when reaping an abandoned sys_upload_session (#2970)

The `sys_upload_session` lifecycle (added in #2984) reaps abandoned/terminal
chunked-upload session ROWS, but not the underlying backend multipart upload —
on S3 an initiated-but-not-completed multipart keeps its already-uploaded parts
billable and invisible to normal listing until an explicit
`AbortMultipartUpload`, so reaping only the row stranded them (with
`backend_upload_id`, the sole pointer, gone).

`createUploadSessionReapGuard` registers a `LifecycleReapGuard` on
`sys_upload_session` that aborts the backend multipart before the row is
deleted: it skips `completed` sessions (their multipart already became a real
object — an abort would `NoSuchUpload`-error), re-seeds the S3 adapter's
`uploadId → key` map from the row (a cold sweep lacks the live in-process map),
and vetoes (keeps the row for retry) on abort failure so the pointer survives.
The local adapter's parts directory is removed the same way.
