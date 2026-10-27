---
'@objectstack/service-storage': patch
---

fix(service-storage)!: a file field refuses a file whose upload was never completed, so a record cannot claim a `pending` `sys_file`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A record write naming a pending sys_file is refused at the file-field write gate: no key of any metadata schema is removed, renamed or re-shaped, no export, type or error code is removed or renamed, and the refusal reuses the existing VALIDATION_FAILED envelope with an invalid_value field entry. There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the file-field write gate (`installFileReferenceHooks`, `@objectstack/service-storage`), which every engine record write runs before the driver: a single insert, each row of a batch insert, and a single update.

- **Before.** A presigned upload is a `sys_file` row with `status: pending` until `POST /api/v1/storage/upload/complete` commits it, and that door is the one that checks the storage backend holds the bytes the row declares (#24548). A signed-in record write naming a `pending` file was taken like a committed one: `201`, the record held the id, and the row was stamped with `ref_object` / `ref_id` / `ref_field` while it stayed `pending`. The field read as attached, the download door answered `404` for it, and the bytes were never measured: a file declared at 100 bytes and PUT at 2 MiB passed a 1 MiB `maxSize`, and the commit door then refused it, so it stayed `pending` and claimed.
- **Now.** That write is refused before the driver runs, with the envelope a file the caller may not read already gets (#26043): one `400 VALIDATION_FAILED` with an ADR-0114 `invalid_value` entry per field. The entry names the field and the file, because the caller may read it. Nothing is written and the `sys_file` row is not stamped. Once `/upload/complete` has run, the same write is taken.
- **Unchanged.** A committed file, and a released (`deleted`) file a claim revives within its grace window. The read check still runs first, so a file the caller may not read keeps #26043's answer. A system write and a context-less programmatic write are not judged: the seed loader writes a record over the `pending` row `storeFile` makes and commits it with `claimFiles` after. A record that already holds a `pending` file can still be updated while it resends that value.
- **Who sees it.** A client that saved the `fileId` from `/upload/presigned` into a record before calling `/upload/complete` now gets `400` instead of `201`. `storage.upload(file)` in the client SDK completes the upload before it returns the id, so it is not affected.

**The remedy.** Call `POST /api/v1/storage/upload/complete` with the `fileId`, then save the record again.
