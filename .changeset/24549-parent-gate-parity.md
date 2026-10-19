---
'@objectstack/service-storage': patch
'@objectstack/plugin-audit': patch
---

The `sys_attachment` parent gate and the `sys_comment` moderation gate give the answer a by-id update of the parent record gets

Clause-②: no

- Every limb that asks whether the caller may edit the parent record (attaching a file, editing or removing another user's attachment or comment, moving an attachment to another record, and `assertMayAttach`) now admits only where a by-id update of that parent admits. After record sharing and the master-detail check, the gate asks the security service's judgement of that update: its record-grained `explain` verdict for `update` on the parent, `allowed` and `record.visible` both.
- The step only adds refusals, with each limb's existing envelope (`ATTACHMENT_PARENT_ACCESS`, `ATTACHMENT_DELETE_DENIED`, `RECORD_NOT_ACCESSIBLE`, or the not-visible `PERMISSION_DENIED` for a caller who cannot read the parent). A store fault keeps its own status, and an attach naming a parent object the registry does not hold answers what a by-id update of it answers (`404 OBJECT_NOT_FOUND`).
- Posting a comment is unchanged: it stays a read rule on the parent.
