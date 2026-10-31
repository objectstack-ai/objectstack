---
'@objectstack/service-storage': patch
---

fix(service-storage): `sys_file`'s file-reference columns (`ref_object`, `ref_id`, `ref_field`, `released_ref_object`, `released_ref_id`) are owned by the file-reference lifecycle and can no longer be set or changed by a write that does not come from it

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A data-door write to five lifecycle-owned sys_file columns is no longer applied: no key of any metadata schema is removed, renamed or re-shaped, no export, type or error code is removed or renamed, and no write is refused (an update keeps the stored values, a create starts with none of them). There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

The five columns that record which record and field hold a file, and which record last let it go, take the same form as the five storage-owned columns:

- **Update.** They are now `readonly` on `sys_file`. A non-system update, by id or by predicate, keeps the values the lifecycle wrote and lands the rest of the payload; the write answers as before and the engine logs the dropped column at `warn`, as it does for every read-only column. A caller that passes `strictReadonlyWrites` is refused with `ERR_READONLY_FIELD_REJECTED`, as for every read-only column.
- **Create.** The create-side guard of the storage-owned columns now drops these five too: a non-system create of a `sys_file` row keeps the caller's other columns, drops any value it gives them, starts `pending` as before, and logs one `warn` naming the dropped columns. The create is not refused.
- **Unchanged.** The file-reference lifecycle writes them under the system context, as before: a file field's claim, release and copy, and the operator backfill of file references.

A file is attached to a record by writing its id into the record's file field, never by writing `sys_file` directly.

`system-file.object.ts` now also states that the presence of `key` and `status` on a `sys_file` row is the storage writers' invariant, not the engine's (the engine checks a `readonly` field for shape only on insert), and the guard's unused helper export is no longer exported.
