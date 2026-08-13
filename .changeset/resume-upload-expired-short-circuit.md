---
'@objectstack/client': patch
---

client: `storage.resumeUpload` exits on an expired session instead of uploading a chunk into it

`resumeUpload` polls `GET .../upload/chunked/:uploadId/progress` before it sends
anything, but read only `totalChunks` / `uploadedChunks` off the response and
discarded `status`. Since #7667 a session past its own `expires_at` is durably
stamped `expired` and reported as such by that very poll — so a client resuming
a dead session learned nothing from the response it already had, uploaded a full
chunk, and discovered the expiry from the 410 `UPLOAD_SESSION_EXPIRED` the chunk
`PUT` came back with. Correct, but it spent an upload to rediscover something it
had been told.

The poll's `status` is now read: `expired` short-circuits before the file is
read or a single byte leaves, throwing an `Error` carrying
`code: 'UPLOAD_SESSION_EXPIRED'` and `httpStatus: 410` — deliberately the same
registered code and status the server answers a chunk `PUT` against that session
with, plus `details: { uploadId, expiresAt }`. A caller already branching on
`err.code === 'UPLOAD_SESSION_EXPIRED'` keeps matching; the difference is only
how early it fires, and that the bytes stay home.

The guard compares against `'expired'` exactly, so every other declared status
(`in_progress`, `completing`, `completed`, `failed`) resumes as before, and a
server or fixture that omits `status` is unaffected.
