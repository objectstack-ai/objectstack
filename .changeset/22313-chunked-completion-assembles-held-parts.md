---
'@objectstack/service-storage': minor
---

fix(service-storage)!: a chunked upload completes with the file it was sent — the completion door assembles the parts the upload holds, and a re-sent chunk is counted once

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime upload door: a chunked completion whose upload does not hold its declared bytes, which used to answer 200 with a short or empty file, is refused with 409 before anything is assembled. The other categories are closed on facts: the one bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and nothing exported is removed or narrowed — the diff changes no export, type or route option — so it is neither runtime-interface-only nor type-surface-only. -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

**What was wrong.** `POST /storage/upload/chunked/:uploadId/complete` assembled the parts the *request* listed. The SDK's `resumeUpload` lists only the chunks its own pass sent, so an upload whose first chunks were stored before an interruption completed with `200` and the declared `size`, while the stored file held only the resumed chunks. And `PUT …/chunk/:chunkIndex` added a re-sent chunk to the session's progress a second time, so `GET …/progress` overstated `uploadedSize`, `uploadedChunks` and `percentComplete` — the counts `resumeUpload` resumes from.

**What the completion door does now.** It assembles the upload's own record of the chunks it holds — every chunk the chunk door stored, with the eTag the backend answered for it — and checks the request's `parts` against that record. A resumed upload therefore completes with the whole file, whatever subset of parts the client lists, and the SDK's `resumeUpload` needs no change.

**What stops being accepted.** The door refuses with `409` and the standard code `RESOURCE_CONFLICT`, before anything is assembled, when:

- the upload does not hold every chunk it declared (chunk indexes `0` to `totalChunks - 1`), or holds one beyond them;
- the chunks it holds do not add up to the declared `totalSize`;
- the request lists a chunk the upload does not hold, or lists one with an eTag other than the one the upload holds for it.

`error.details` carries `missingChunks`, `unexpectedChunks`, `unheldListedChunks` and `mismatchedChunks` (zero-based chunk indexes), with `totalChunks`, `totalSize` and `heldBytes`. The session stays `in_progress` and the file stays `pending`: upload the missing chunks with `PUT …/chunk/:chunkIndex`, then complete again. A `parts` value that is not a list of `{ chunkIndex, eTag }` is refused `400 INVALID_REQUEST`; an absent `parts` is still an empty list.

**What changes for you.** A client that completed an upload before sending all of its bytes — including a completion with no chunks at all, which used to commit an empty file — now receives the `409` above. Send every chunk first.

**Progress.** A chunk index sent again replaces its slot, as it replaces its bytes in the backend: `uploadedChunks` counts distinct chunks and `uploadedSize` is the sum of each chunk's latest size. A session started before chunk sizes were recorded keeps its running byte total until it ends, and is completed only when that total reaches `totalSize`.
