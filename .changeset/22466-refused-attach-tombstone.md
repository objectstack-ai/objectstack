---
'@objectstack/service-storage': patch
---

fix(service-storage): a refused attach no longer leaves the uploaded file stored forever — the caller's own never-attached file is tombstoned and reclaimed by the sweep

Clause-②: no

Attaching a file is two writes: the upload commits a `sys_file` (scope `attachments`), and then a `sys_attachment` insert attaches it to a record. When the attachment gate refused that insert with `403 ATTACHMENT_PARENT_ACCESS`, the file stayed `committed` with no attachment pointing at it. Nothing ever reclaimed it: files were tombstoned only when they lost their last attachment, and this one never had one.

- **Now:** when the attachment gate refuses an attach, the file is tombstoned (`status: 'deleted'`, `deleted_at` set), the same way a file is tombstoned when its last attachment is removed. This covers every way the gate refuses: sharing denies edit on the parent, the parent's master record denies it (`controlled_by_parent`), or the parent cannot be read. From there the file follows the existing path. The lifecycle sweep reclaims the row and its bytes 30 days after `deleted_at`. At sweep time it checks again that nothing holds the file.
- **Only the caller's own unheld upload:** the file must be an `attachments`-scope, `committed` file. The refused caller must be its uploader (`sys_file.owner_id`). It must have no attachment and no field owner (`ref_*`). A refused attach that names someone else's file, a file another record still holds, or a field file changes nothing.
- **It survives a rollback:** the tombstone is written after the refusal, outside the refused write's transaction. If the attach ran inside a caller's own transaction, an `atomic` batch for example, rolling that transaction back does not undo the tombstone.
- **Unchanged:** the refusal itself (status, code, message), which does not depend on the file and says nothing about it; an admitted attach; and a retry. Retrying the same `file_id` within the 30 days is admitted or refused like any attach. An admitted retry attaches the file and brings it back to `committed`, as re-attaching a detached file always has.

What changes for you: nothing to do. A refused upload no longer uses storage indefinitely.
