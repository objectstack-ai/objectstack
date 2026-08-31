---
"@objectstack/driver-memory": patch
---

fix(driver-memory): make `bulkUpdate` and `bulkDelete` all-or-nothing, so a refused row leaves the table exactly as it found it (#13435)

`bulkUpdate` and `bulkDelete` were still `Promise.all(map(...))` over
`update`/`delete`, and both of those write into the table synchronously. So a
mid-batch refusal — a `UNIQUE_VIOLATION`/409 on `bulkUpdate`, a missing-id
throw under `strictMode` on `bulkDelete` — left every row processed *before*
it already mutated, and the caller got a rejection describing a batch that
had partly landed. #13340 fixed the identical shape on `bulkCreate`; this is
the third and fourth batch door.

`bulkUpdate` now builds and checks every pending row's post-image — each id
keeps its own patch, so this is new construction (a projected row set per
pending row, generalized from `updateMany`'s single-shared-patch posture)
rather than a copy of either sibling door — before writing any of them.
`bulkDelete` resolves every id to a table index first, refusing the whole
batch under `strictMode` before touching the table if one is missing, and
only then splices. Both follow `update`/`delete`'s own existing contract for
a missing id (skip under non-strict, refuse under strict) rather than a third
posture. `bulkDelete` still returns `void` — no current caller reads a
per-row outcome, so widening the return type stays out of scope.

All four batch doors of `InMemoryDriver` (`bulkCreate`, `updateMany`,
`bulkUpdate`, `bulkDelete`) now agree that a batch is atomic.
