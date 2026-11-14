---
'@objectstack/service-storage': patch
---

feat(service-storage): the uploader removes an attachment they uploaded, through an own-row door, with no delete bit on the member grant

Clause-②: yes (widening) — one route is added: `DELETE /api/v1/attachments/:id` removes a `sys_attachment` row whose `uploaded_by` is the caller, answering `{ id, deleted: true }` (200), and refuses `UNAUTHENTICATED` (401), `VALIDATION_ERROR` (400), `RECORD_NOT_FOUND` (404, an attachment the caller cannot read answers as one that does not exist) and `PERMISSION_DENIED` (403, any caller who is not the uploader, an administrator included). The package's exports are unchanged: `StorageServicePlugin` mounts the door wherever it mounts its routes on the kernel's HTTP server. Every existing answer is as before: the member grant `storage_attachment_member` still carries read and create only, so the data API's delete on `sys_attachment` stays refused to a member who holds only the baseline, and an administrator's delete there is unchanged.
Metadata-protocol: none
Skills-docs: `content/docs/permissions/attachments-access.mdx` documents the removal door, its refusals and its row in the enforcement summary. `skills/**` teaches nothing of deleting an attachment.

A member could attach a file to a record they edit, but could not take it back: the member grant carries no delete bit (ADR-0090 D5 keeps delete off every set the `everyone` position holds), so the data API refused their own upload `PERMISSION_DENIED`. The storage service now mounts the platform's own-row delete door for attachments beside its routes. It reads the row as the caller, so every attachment read rule applies first; it admits only when `uploaded_by` names the caller, which the attach rule stamps from the session and no caller can rewrite; and it removes the row on the caller's behalf, attributed to them, so the file behind it is released as on any delete. Removing someone else's attachment, as a parent editor or an administrator, still goes through the data API with an explicit delete grant.
