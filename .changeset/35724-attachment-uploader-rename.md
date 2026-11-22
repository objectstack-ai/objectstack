---
'@objectstack/service-storage': patch
'@objectstack/rest': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/core': patch
---

feat(service-storage): rename an attachment through a door by the attachment delete rule, and the Attachments tab names the uploader of other people's files

Clause-②: yes (widening)
Metadata-protocol: none

Two additions, no answer narrowed:

- **The rename door.** `PATCH /api/v1/attachments/:id` with `{ "file_name": "..." }` sets the name one `sys_attachment` row is listed under, by the attachment delete rule: the caller who uploaded it, or a caller the attachment update gate admits as an editor of the record it is attached to. The door reads the row as the caller first, so every attachment read rule applies; the uploader's rename is written on the caller's behalf with no edit grant, as the uploader's removal door does; anyone else's goes through the data engine as the caller, so the object's edit grant and the update gate judge it. It answers `{ id, file_name }` (200), and refuses `UNAUTHENTICATED` (401), `VALIDATION_ERROR` (400: a query parameter, a blank name, or any body key besides `file_name`), `RECORD_NOT_FOUND` (404: an attachment the caller cannot read answers as one that does not exist) and the update gate's `RECORD_NOT_ACCESSIBLE` (403) for a caller who can read the record but not edit it. Only the attachment row's name changes: the stored file, its bytes and the name a download carries are untouched. The package's exports are unchanged; `StorageServicePlugin` mounts the door beside the removal door.
- **The uploader, expanded.** The record page payload's `attachments` part (`POST /api/v1/data/:object/:id/page`) now asks its `sys_attachment` read with `uploaded_by` expanded, as the `activity` part expands its actor, and the Attachments panel's own list read does the same. The expansion is a read of `sys_user` as the caller: a reader who may read the uploader gets that user's row (its name), and a reader who may not keeps the stored id. A consumer of that part that compared `uploaded_by` with a user id now reads `uploaded_by.id` where the reader may read the user.

The record Attachments tab shows the uploader's name on every row whose uploader the reader may read, and never shows a bare id. Its row menu offers Rename beside Delete, on the reader's own uploads and, to a reader who also holds the edit grant on `sys_attachment`, on every row, opening a name prompt; the new name is the one the list shows after a reload.

`@object-ui/core`: the affordance-to-grant map gains the `attachmentRename` row (the edit grant on `sys_attachment`), which the panel asks for a row the caller did not upload.
