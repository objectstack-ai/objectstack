---
'@objectstack/service-storage': patch
---

fix(service-storage): finishing an upload after switching active organization answers `409 RESOURCE_CONFLICT` naming the change, not a `500` that reads as a data-engine outage

Clause-②: no

`POST /api/v1/storage/upload/complete` and `POST /api/v1/storage/upload/chunked/:uploadId/complete` write by id under the caller's active organization, and that write is scoped to it. When the uploader's active organization is no longer the one the upload was started in, the write cannot reach the upload's row. Both doors used to answer that with `500 INTERNAL` and a message diagnosing a data-engine outage ("Restore the data engine …").

- **Now:** before writing anything, each door answers `409 RESOURCE_CONFLICT` in the standard error envelope. The message says the upload was started in a different organization than the active one, and that switching back finishes it. The server log carries one warning naming the upload, the organization it was started in and the active one.
- **Unchanged:** which organization an upload belongs to (switching back finishes it there); a commit or completion from the starting organization; a real data-engine failure, which still answers `500` with its consequence and fix; the uploader-only rule, which runs first, so a caller who did not start the upload is still refused `403 PERMISSION_DENIED` and learns nothing about organizations; uploads stamped with no organization; routes with no session resolver; a store with no data engine wired; and the progress door.

What changes for you: when either door answers `409 RESOURCE_CONFLICT`, switch the active organization back to the one the upload was started in and retry the same call.
