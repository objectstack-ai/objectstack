---
'@objectstack/lint': patch
---

feat(lint): `security-external-owner-unmapped` warns when a writable external object refuses every member write (#27332)

Clause-②: no (a warning narrows nothing; no accepted metadata shape moves)
Metadata-protocol: none

An external object (ADR-0015) on an owner-keyed sharing model (`private`, `public_read`, or none on a custom object) refuses every member edit and delete with 403 `PERMISSION_DENIED`, even for a member whose permission set grants `allowEdit`, unless an app-authored row-level policy admits the row. Before the write, record sharing reads the row's `owner_id` and the platform ownership floor reads `created_by` equal to the caller, and no remote row carries either column. `os validate`, `os build` and `os lint` now say so with a warning on the object.

- The warning names two ways out. One: declare `sharingModel: 'public_read_write'` and decide who may edit in a `beforeUpdate` hook. Two: declare `owner_id` in `fields` and have the driver return the remote owner under that name. A built-in SQL driver does that through `external.columnMap`; `columnMap` is not applied by the engine, so a plugin driver must return the field itself.
- A `columnMap` entry for `owner_id` without the declared field still warns, worded for it: it works on a built-in SQL driver only, and leaves reads unscoped by owner there.
- `ownership: 'none'` (or `'org'` / `'business_unit'`) is not a way out. It drops `owner_id`, and the floor's `created_by` check refuses the same write, so the warning still fires and names `created_by`. Declaring `created_by` (served by the driver) silences it.
- It skips a read-only binding (`external.writable` not `true`, or a datasource the stack declares with `external.allowWrites: false`), `public_read_write`, `controlled_by_parent`, and an object that declares the column its check reads.
- It is a warning, never an error: `defineStack` and every publish door accept the same stacks as before. `os explain security-external-owner-unmapped` explains the two checks, and why `public_read_write` opens edits but not deletes.
