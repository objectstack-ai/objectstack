---
'@objectstack/plugin-approvals': minor
---

feat(plugin-approvals): serve the approval request's record page, and declare the thread reply as `approval_comment`

Clause-②: no

**The request's record page is now metadata this plugin serves.** `ApprovalsServicePlugin` registers `sys_approval_request_detail` through its manifest `pages`: a slotted record page, default for every `sys_approval_request` record, that the metadata API serves like any other page. Its slots:

- `actions`: one `record:approval_decision` node (the decision panel: the request's decision progress and its declared decision actions);
- `highlights`: the object's `highlightFields` without `record_id`, so `record_id` stays in the details grid, where the console draws the target record of the `record_id` / `object_name` pointer pair. The object's own `highlightFields` is unchanged;
- `tabs`: Details (`record:details`) and Timeline (`sys_approval_action` as a related list on `request_id`, newest first);
- `discussion: []`: no generic discussion thread. The request's thread is its timeline.

The page label is translated in the plugin's bundle as `pages.sys_approval_request_detail.label` (en, zh-CN, ja-JP, es-ES). The page stays module-internal: nothing new is exported from the package entry.

**`approval_comment` declares the thread reply.** `sys_approval_request` now declares a ninth action, `approval_comment` ("Reply"). It posts `comment` (a required textarea) and `attachments` (optional, several files) to `POST /api/v1/approvals/requests/{id}/comment`, the route the console drawer posted to by hand. The service stores the reply as a `sys_approval_action` row with action `comment`, which the Timeline lists. Its `visible` gate is the route's own admission: a pending approver (`record.viewer.can_act`), or the submitter while the request is `pending`. It has no admin-override arm, because the comment route admits none.
