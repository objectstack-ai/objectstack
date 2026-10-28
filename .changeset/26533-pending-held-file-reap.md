---
'@objectstack/service-storage': patch
---

fix(service-storage): the pending-upload retention no longer deletes a `pending` `sys_file` that a record or an attachment still holds

Clause-②: no
Metadata-protocol: none

- **Before.** `sys_file` reaps `status: pending` rows after 7 days, through the `sys_file` reap guard. Its pending branch deleted the bytes and the row without asking whether anything held the file. A pending file can be held: until the previous release a signed-in record write could claim one (`ref_object` / `ref_id` / `ref_field` stamped while the row stayed `pending`), and a system write still does, since the seed loader writes the record before `claimFiles` commits the row. Seven days later the record named a file id whose bytes and row were gone.
- **Now.** The pending branch asks the same hold question the tombstone branch asks (a `sys_attachment` row, or the `ref_*` columns). A held pending file is kept, bytes and row, and stays `pending`; each sweep logs one warning naming the file and its holder. An unheld pending file is reaped as before. A failure to answer the hold question keeps the file for the next sweep.
- **What an operator does with the warning.** The uploader completes the upload with `POST /api/v1/storage/upload/complete`, which checks the stored bytes and commits the file. A record that lets go of the file hands it back to the sweep. The guard never commits the file itself, because that would skip the byte check the complete door makes.
