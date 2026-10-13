---
'@objectstack/service-storage': patch
---

fix(service-storage): chunks sent in parallel to one chunked upload each record their part

Clause-②: no

`PUT /storage/upload/chunked/:uploadId/chunk/:chunkIndex` merges its chunk into the upload session's record of the chunks it holds (`parts`, `uploaded_chunks`, `uploaded_size` on `sys_upload_session`). It read that record, merged in memory and wrote the whole record back, so two chunk PUTs to one upload at the same time both answered `200` while the record kept only one of them: `GET …/progress` undercounted, and the completion was refused `409 RESOURCE_CONFLICT` naming the chunk the record had lost until the client sent it again.

The record is now written with a compare-and-set: the write lands only while the row still holds the progress the chunk door read, and when another chunk's write landed first the door reads the record again and merges again. On a wired data engine this is the engine's own conditional update, evaluated in the same statement that writes, so it holds across server processes. Every chunk sent in parallel is recorded, and a parallel upload completes on its first completion. A sequential upload is unchanged.

A chunk whose record write loses to another write on 16 attempts in a row is refused `409 RESOURCE_CONFLICT`, with `error.details` `{ chunkIndex, attempts }`: its bytes are stored, but the upload does not hold it. Send that chunk again.
