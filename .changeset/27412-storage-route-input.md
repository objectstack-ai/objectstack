---
'@objectstack/service-storage': patch
---

fix(service-storage): the chunk upload door refuses a `chunkIndex` the upload did not declare, and the presigned upload door refuses a `size` that is not a byte count

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A REST request value is refused at the presigned upload door (a negative size): no key of any metadata schema is removed, renamed or re-shaped, no export, type or error code is removed or renamed, and the refusal reuses the existing 400 INVALID_REQUEST envelope. There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

Narrowed: a negative `size`, which the spec number (`GetPresignedUrlRequestSchema.size`, a bare `z.number()`) admits, is now refused `400` at the presigned door.

- **Chunk door** (`PUT /api/v1/storage/upload/chunked/:uploadId/chunk/:chunkIndex`). **Before:** the index was read with `parseInt`, so `0.5` was read as `0`, `-1` reached the storage backend as part number 0 and answered `500 INTERNAL`, and an index at or past the upload's `totalChunks` was stored, counted in the progress, and then made `POST .../complete` answer `409` for good, since no door removes a stored chunk. **Now:** the index must be a whole number (decimal digits only) in `[0, totalChunks)`; anything else answers `400 INVALID_REQUEST` naming the valid range, with `details: { chunkIndex, totalChunks }`. Nothing is stored and the progress is unchanged, so the upload can still be completed. The check runs after the resume-token check, so a caller without the token still gets `403 INVALID_RESUME_TOKEN` first.
- **Presigned upload door** (`POST /api/v1/storage/upload/presigned`). **Before:** only a missing `size` was refused. A non-numeric `size` such as `"abc"` reached the `sys_file` insert and failed there as `500 INTERNAL`, and a negative `size` such as `-5` answered `200` and stored a pending `sys_file` row with that size. **Now:** `size` must be a finite, non-negative JSON number (the `GetPresignedUrlRequestSchema.size` number); a string (a numeric string such as `"100"` included), `NaN`, an infinity, a negative number or a boolean answers `400 INVALID_REQUEST` naming `size`, and no `sys_file` row is written. `0` and any positive number behave as before.
- **Who sees it.** Only a client that sent an index outside the range it was given, or a size that is not a JSON number of bytes. The SDK (`storage.upload`, `resumeUpload`) and the Console upload client send `0 .. totalChunks - 1` and `File.size`, so they are not affected.
