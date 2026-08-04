---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `updateMany` classifies an id-less row as a caller error, matching `batchData`'s update branch (#5100)

`runUpdateManyLoop` lacked the `!record.id` guard #4793 gave `runBatchDataLoop`'s
update branch, so the two by-id update faces classified the same malformed row
differently: `VALIDATION_FAILED`/400 on batch, but on `updateMany` the row fell
through to the #5088 existence probe as `{ id: undefined }` and came back
`RECORD_NOT_FOUND`/404 with `undefined` interpolated into the message — a
request-shape error reported as a data-state one, with the row's fate left to
each driver's undefined-where-key handling.

Not reachable over REST (`UpdateManyRecordSchema` requires `id`, #3939) — the
change is observable only to in-process callers of the protocol method, whose
id-less rows now answer `VALIDATION_FAILED`/400 (`Record id is required for
update`) before any engine round-trip, identically on both faces (#4620: one
classification per file, enforced by a cross-face parity test). `record.data`
handling is aligned to the batch branch's `record.data || {}` in the same
change.
