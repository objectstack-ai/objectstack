---
'@objectstack/service-storage': patch
---

fix(service-storage): sending a chunk, or polling an expired upload's progress, after switching active organization answers `409 RESOURCE_CONFLICT` naming the change, not a `500` that reads as a data-engine outage

Clause-②: no

`PUT /api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex` records each chunk on the upload session, and `GET /api/v1/storage/upload/chunked/:uploadId/progress` stamps a session past its `expires_at` as `expired`. Both writes go by id under the caller's active organization, and they are scoped to it. When the uploader's active organization is no longer the one the upload was started in, the write cannot reach the session row. Both doors used to answer that with `500 INTERNAL` and a message diagnosing a data-engine outage ("Restore the data engine …").

- **Now:** each door answers `409 RESOURCE_CONFLICT` in the standard error envelope, with the same message the commit and chunked-completion doors give: the upload was started in a different organization than the active one, and switching back finishes it. The chunk door answers it before the chunk reaches the storage backend and before any write. The progress door answers it only when the expiry stamp is due, before stamping. The server log carries one warning naming the door, the upload, the organization it was started in and the active one.
- **Unchanged:** which organization an upload belongs to (switching back finishes it there); a chunk or a progress read from the starting organization; the progress of a live session, or of one already `expired`, which is a read and still answers `200` from any organization; a real data-engine failure, which still answers `500` with its consequence and fix; the resume-token check on the chunk door and the uploader-only rule on the progress door, which run first, so a caller who cannot act on the upload learns nothing about organizations; sessions stamped with no organization; routes with no session resolver; and a store with no data engine wired.

What changes for you: when either door answers `409 RESOURCE_CONFLICT`, switch the active organization back to the one the upload was started in and retry the same call.
