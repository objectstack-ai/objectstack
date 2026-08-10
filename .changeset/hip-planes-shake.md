---
'@objectstack/plugin-approvals': patch
---

Unify the approval-status vocabulary across the `sys_approval_request` i18n bundles (#7232).

A request rendered through the generic object surfaces used a different word than the same
request in the Approvals Inbox and in the account-app navigation. The bundles now say what
those surfaces already say:

- **zh-CN**: the `status` option `pending` reads 待审批 (was 待处理), and the `my_pending`
  view reads 待我审批 (was 我的待办), matching the account-app nav entry; the view's
  empty-state title was aligned to the same wording.
- **en**: the `status` options are humanized — `Pending` / `Approved` / `Rejected` /
  `Recalled` / `Returned` — instead of shipping the raw enum values as labels.
- **ja-JP / es-ES**: the `my_pending` view label now matches the nav wording (承認待ち /
  Aprobaciones pendientes).

Status **values** are unchanged — this is display wording only, so no stored data, filter,
or API payload is affected.
