---
'@objectstack/spec': minor
'@objectstack/service-storage': minor
---

A server-side producer can store a file and attach it to a record: `IFileAttachmentService.attachFile`, registered by `StorageServicePlugin` as the kernel service `file-attachments` (`FILE_ATTACHMENT_SERVICE`), writes the bytes, one `sys_file` row and one `sys_attachment` row linking it to the parent, under the checks every other attachment of that parent meets

Clause-②: yes (widening: `@objectstack/spec/contracts` gains `IFileAttachmentService`, `AttachFileInput`, `AttachedFile` and `FILE_ATTACHMENT_SERVICE`, and `StorageServicePlugin` registers and declares one more service)

- **The call.** `attachFile({ parentObject, parentId, organizationId, filename, mimeType, data })` answers `{ fileId, attachmentId, size }`. `organizationId` is required: the organization the caller acts in, or `null` for none. It acts as the system, for a producer with no browser upload in front of it (inbound mail first). Reach it with `ctx.getService(FILE_ATTACHMENT_SERVICE)` once the kernel has bootstrapped.
- **What it runs.** Each check is the one the rest of the platform already runs, not a copy:
  - The `max_upload_mb` storage setting, through the same verdict the REST upload doors ask. Over it, the call is refused `413 PAYLOAD_TOO_LARGE` before anything is stored.
  - The parent's organization. A parent walled into another organization than `organizationId` is refused `404 RECORD_NOT_FOUND`, as a missing parent is. Both rows are written in the parent's organization, or in the caller's for a global parent.
  - Every gate on the `sys_attachment` insert, among them the `enable.files` opt-in: a parent object without it is refused `403 FILES_DISABLED`.
  - Before the kernel has bootstrapped, or with no data engine, the call is refused `503 SERVICE_UNAVAILABLE`. A malformed input is refused `400 VALIDATION_ERROR`.
- **No refusal leaves a committed `sys_file`.** The row is written `pending` before the bytes, and turns `committed` only in the same transaction as the `sys_attachment` insert. A refused call removes the bytes and the row before it throws. If the process dies mid-call, the pending-upload retention reclaims both.
- `@objectstack/service-storage`: the upload doors' size refusal moved from the route module into `storage-limits.ts`, beside the limit it enforces, so the doors and the verb read one status, one code and one sentence. The doors answer exactly as before.
