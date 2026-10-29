---
'@objectstack/service-storage': patch
---

fix(service-storage): `sys_file`'s storage-owned columns (`key`, `mime_type`, `size`, `status`, `etag`) can no longer be set or changed by a write that does not come from the storage service

Clause-②: no (narrowing)
Metadata-protocol: none

A file field refuses a file whose upload never completed by reading `sys_file.status`, and judges its `accept` / `maxSize` by `mime_type` / `size`. Those columns were plain writable fields, so a caller allowed to write `sys_file` rows (an administrator, on a stock boot) could `PATCH /api/v1/data/sys_file/ID` a presigned upload that never received its bytes to `committed`, and a record's file field then claimed it; or rewrite `size` / `mime_type` after commit so the field's constraints judged values that do not describe the stored bytes.

- **Update.** The five columns are now `readonly` on `sys_file`. A non-system update, by id or by predicate, keeps the values the storage service wrote and lands the rest of the payload; the write answers as before and the engine logs the dropped column at `warn`, as it does for every read-only column. A caller that passes `strictReadonlyWrites` is refused with `ERR_READONLY_FIELD_REJECTED`, as for every read-only column.
- **Create.** A non-system create of a `sys_file` row keeps the caller's other columns, drops any value it gives these five, and starts the row `pending`, with one `warn` naming the dropped columns. A file field refuses such a file, and the lifecycle's `pending` retention collects it. The create is not refused.
- **Unchanged.** The storage service's own writes all run under the system context and still move every column: presign, PUT and `/upload/complete`, the chunked upload, a file field's claim, release and copy, and the attachment tombstone. Every other `sys_file` column (`name`, `acl`, `scope`, ownership) is written through the data door as before.

To change what a file is, upload it again through the storage upload doors (`POST /api/v1/storage/upload/presigned`, then `/upload/complete`).
