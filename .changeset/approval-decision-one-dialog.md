---
'@objectstack/plugin-approvals': patch
---

approvals: rejecting or recalling a request now opens ONE dialog instead of two

`sys_approval_request`'s `approval_reject` and `approval_recall` actions declared
both `confirmText` and `params`. The console action runner chains confirmation
**then** param collection, both awaited, so a single decision opened a confirm
prompt, then a second dialog the approver never asked for — and nothing was sent
until that second Confirm, while the first prompt already read as "the action is
running".

Each action now carries its confirm question in the action's top-level
`description` (the key added in #7367), which the param dialog renders under its
title. The wording is unchanged in all four shipped locales — including the
finality warning "A rejection is final for every approver." — so one decision is
one condition, one wording, one dialog, and nothing is sent until its own Confirm.
