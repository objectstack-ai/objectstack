---
'@objectstack/service-storage': patch
---

fix(service-storage): a chunked-upload completion retried after it succeeded answers the same 200, and a completed upload takes no more chunks

Clause-②: yes (narrowing) — widened: `POST /api/v1/storage/upload/chunked/:uploadId/complete` on an upload that has already completed answers `200` with the same body the first completion answered (file id, key, size, MIME type, URL), where it answered `500 INTERNAL` and stamped the session `failed`. Narrowed: `PUT /api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex` on a completed upload answers `409 RESOURCE_CONFLICT`, where it stored the chunk for no file and answered `200`. A session in flight, `failed` or `expired` answers both doors as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type or export is added, removed or re-shaped. The moved answers are two storage doors' answers about a completed upload session, so there is nothing stored for a migration to rewrite and no tombstone. -->

A client that lost the `200` of a completion and sent it again (the SDK's `resumeUpload` retries this way) was told the upload failed, and the upload's progress read `failed`, while the file stayed committed and downloadable. The retry now writes nothing and does not reach the storage backend; it is still judged against the parts the upload holds, so a retry naming a chunk the upload does not hold is refused `409` as before. To send another file after a completed upload, start a new chunked upload.
