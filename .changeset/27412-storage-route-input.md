---
'@objectstack/service-storage': patch
---

fix(service-storage): the chunk upload door refuses a `chunkIndex` the upload did not declare

Clause-②: no
Metadata-protocol: none

- **Chunk door** (`PUT /api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex`). **Before:** the index was read with `parseInt`, so `0.5` was read as `0`, `-1` reached the storage backend as part number 0 and answered `500 INTERNAL`, and an index at or past the upload's `totalChunks` was stored, counted in the progress, and then made `POST .../complete` answer `409` for good, since no door removes a stored chunk. **Now:** the index must be a whole number (decimal digits only) in `[0, totalChunks)`; anything else answers `400 INVALID_REQUEST` naming the valid range, with `details: { chunkIndex, totalChunks }`. Nothing is stored and the progress is unchanged, so the upload can still be completed. The check runs after the resume-token check, so a caller without the token still gets `403 INVALID_RESUME_TOKEN` first.
- **Who sees it.** Only a client that sent an index outside the range it was given. The SDK's `resumeUpload` and the Console upload client send `0 .. totalChunks - 1`, so they are not affected.
