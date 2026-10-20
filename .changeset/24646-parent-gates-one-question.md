---
'@objectstack/service-storage': minor
'@objectstack/plugin-audit': minor
'@objectstack/spec': minor
---

feat(service-storage, plugin-audit): the attachment and comment gates judge "may edit the parent record" by the parent's own by-id update alone

Clause-②: yes (widening)

A caller who can update the parent record by id can also attach files to it and moderate its comments; a caller who cannot, still cannot. The gates only stop refusing what the CRUD path already admits.

- **What widens.** The `sys_attachment` parent gate (`@objectstack/service-storage`: attaching, detaching or editing another user's attachment, re-pointing one, and `assertMayAttach`) and the `sys_comment` moderation gate (`@objectstack/plugin-audit`: editing or removing another person's comment) now ask one question about the parent record: the security service's record-grained judgement of a by-id `update` of it (`security.explain` for `update` on the parent, admitting only `allowed === true` and `record.visible === true`). They no longer ask record sharing at owner-only depth first, nor the master-detail check: both are part of that judgement already. So a caller whose write depth on the parent object is `unit`, `unit_and_below` or `org` may now attach and moderate wherever that depth lets them update the parent, and so may a caller an app-authored row-level update policy admits.
- **What does not move.** A caller the parent's by-id update refuses is refused, with the same codes as before (`ATTACHMENT_PARENT_ACCESS`, `ATTACHMENT_DELETE_DENIED`, `RECORD_NOT_ACCESSIBLE`, all 403), and a caller who cannot read the parent still gets the not-visible refusal. A `controlled_by_parent` parent is still judged through its master. Uploaders keep their own attachments and authors their own comments. Posting a comment stays a read rule on the parent. A store fault keeps its own status.
- **Kernels that judge no by-id update.** Where the security service serves no `explain` (or there is none), both gates keep exactly the composition they had: record sharing's tri-state edit verdict at owner-only depth, then the master-detail check. With no sharing service, a caller-scoped read of the parent is still asked first.
- **`@objectstack/spec`.** The `ISharingService` contract prose ("Write DEPTH is an input the CALLER supplies") now records that the parent-record gates ask the security service's by-id update judgement instead of this service, and why they never resolve the parent's depth themselves. No type, member or export changes.
