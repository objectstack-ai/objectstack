---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the by-id BULK write faces refuse a row that names no record (#5088)

`updateMany`, and `batch`'s `update` and `delete` branches, now answer
`RECORD_NOT_FOUND` (404) for a row whose id resolves to nothing — the same code
and the same message (`Record <id> not found in <object>`) the single-record
`PATCH` / `DELETE` have answered since #4435.

Before this, #4435's "a write that touched zero rows must not report success"
was live on only 2 of the 5 write faces in `protocol.ts` (`updateData`'s
existence probe and `deleteMany`'s `deleted === false`). The three bulk faces
went straight to the engine, with two visible consequences:

- **`updateMany` / `batch.update`** — a stale id entered the write pipeline.
  With no stored row to overlay, #4770's record materialisation (stored ⊕
  payload) produced a payload-only record, a hook `condition` reading any
  untouched field found it absent, and #4775's unevaluable-condition abort
  fired. The row failed `INTERNAL_ERROR` with a diagnostic accusing a *correct*
  hook of naming an undeclared field, so an operator with one stale id in a
  batch was told their hook was broken and pointed at the object's field list.
  Under `atomic: true` that row also poisoned the batch, taking every later row
  to `NOT_ATTEMPTED`. Hooks, automation and audit rows no longer fire at all for
  a record that does not exist.
- **`batch.delete`** — discarded the driver's return and reported
  `success: true` unconditionally, so a batch of typo'd ids reported every one
  of them deleted. It now reads the driver contract's positive not-found value
  (`=== false`), exactly as `deleteMany` does.

Existence is asked with the same `probeRecord` the single-record path uses: it
answers EXISTENCE, not visibility, so the by-id write policy stays #1994's
decision inside `engine.update` and the `rls-by-id-write` proof can still go
red. `upsert` is deliberately unchanged (a missing id still inserts), as are
the predicate bulk writes (`multi: true`, no per-row id) and the `atomic`
response shape — the causal row keeps its position, later rows stay
`NOT_ATTEMPTED`, and rows with real ids behave exactly as before.

Note for high-volume callers: each by-id row in these three faces now costs one
extra existence read before its write.
