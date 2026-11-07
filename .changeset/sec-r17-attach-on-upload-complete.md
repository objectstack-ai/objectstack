---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/service-storage': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
---

fix(service-storage): a member attaches a file from the browser again — the upload's own completion attaches it as them, restoring the Attachments panel after #31031

Clause-②: yes (widening)
Metadata-protocol: none

A signed-in member who may attach files, and holds no read of `sys_file`, can attach a file from a record's Attachments panel again. Since the write-time reference check began judging a `lookup` value through the caller's own read door, the panel's second step — `POST /api/v1/data/sys_attachment` naming the file it had just uploaded — was refused `400 VALIDATION_FAILED` (`file_id`, `reference_not_found`) for such a member.

The rule now: the upload-complete door (`POST /api/v1/storage/upload/complete`) takes an optional `attachTo: { parentObject, parentId }`. With it, the door runs every gate it already asked — the session, the upload ownership rule, the starting organization, the held bytes — and then hands the upload to the file-attachments service's `attachUploadAs`, which runs as the caller. That verb vouches for one `sys_file` only: a `pending` upload in the `attachments` scope that the caller uploaded, that no record holds yet, in the caller's write reach and in the parent's organization. It asks the attach authorization first (the permission to create an attachment, the parent-edit attach rule, `enable.files`), then writes the `sys_attachment` row and commits the file as one unit. The answer is the committed file with its new `attachmentId`. Another user's upload id, an id that names no file, a committed or already attached upload, and a record the caller may not attach to are refused, and the upload stays `pending`.

The vouch is spent on that one write: a hook that runs under it — as the user or as the system — writes without the mark (`withoutVouchedReferences`, `@objectstack/core`), so a hook naming the same `file_id` is judged through the caller's read door.

Unchanged: no caller gains a read of `sys_file` or of anything else. The generic data door keeps its rule — a `sys_attachment` create through `POST /api/v1/data/sys_attachment` naming a `sys_file` the caller cannot read is still refused `reference_not_found`. A completion without `attachTo` commits exactly as before. A mount with no file-attachments service bound refuses `attachTo` with `501 NOT_IMPLEMENTED`.

The console's Attachments panel (`@object-ui/app-shell`) now completes its upload with `attachTo` and makes no second call, keeping its refusal messages; the upload adapter (`@object-ui/data-objectstack`) gains an `attachTo` option and returns the `attachmentId` it receives.
