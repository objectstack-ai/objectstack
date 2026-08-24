---
"@objectstack/objectql": minor
"@objectstack/service-storage": patch
---

Record file-field hydration now answers the same question about a `sys_file` tombstone that the download path answers (#11427). `#10246` stopped `GET /api/v1/storage/files/:id` treating a tombstone (`status: 'deleted'` + `deleted_at`) as the last word — it asks the reap guard's own `findFileHolder` and serves the row for as long as something still holds it — but the record read kept the older `status === 'committed'` rule. One `sys_file` row therefore answered `200` at the download endpoint and a bare id inside a record payload, which UI and export render as "this record has no attachment".

The population is narrow and unchanged in every other respect: `claimFile` already un-tombstones a field file synchronously when a record re-points at it, and attachments-scope files are never reached by field hydration, so what this closes is the residual the reap guard's sweep-time re-verification names — hook races, direct-driver writes, and future trash restore. A tombstone nothing holds still hydrates as a bare id, and a `pending` upload is untouched.

The predicate is not re-derived in the engine. `ObjectQL` gains `registerHeldFileResolver` (type `HeldFileResolver`), which the storage plugin fills with `findHeldFiles` — the batched form of `findFileHolder`, asking the same union of `sys_attachment` join rows and the `ref_*` ownership columns. Batched because hydration runs over many rows per read: a read with no tombstone costs nothing, and the residual case costs one extra query for the whole read rather than one per file. Engines with no storage plugin keep tombstones un-hydrated exactly as before.
