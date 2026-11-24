---
'@objectstack/plugin-approvals': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

fix(i18n): an approval rejection reads 驳回 in Chinese, on the runtime surfaces and in the designer's approval panel

Clause-②: no
Metadata-protocol: none

In Chinese, the approval runtime now names the reject decision 驳回 (zh-Hant 駁回), the word the flow designer gives the approval branch and the server notifications already use. Before, the designer's branch said 驳回 while its approval-node help and the approver's buttons said 拒绝 for the same decision.

- `@object-ui/i18n`: the `approvalsInbox` strings in zh-Hans and zh-Hant: the inbox and record-bar buttons, the bulk and single confirm dialogs, the toasts, the status chip (已拒绝 → 已驳回), the history row, the keyboard hint and the send-back limit notice.
- `@objectstack/plugin-approvals`: the zh-CN labels of `sys_approval_request` (the `approval_reject` lever, its confirm question and success toast, the `rejected` status) and of the `reject` row of `sys_approval_action`; the zh-Hant bundle already said 駁回. The email action-link confirm and result pages read 驳回.
- `@object-ui/app-shell`: the approval node's zh panel in the flow designer: the multi-approver help, the status-mirror help, the escalation help and its `auto_reject` option label (自动拒绝 → 自动驳回; the stored `auto_reject` value is unchanged), and the revision-limit help. Its branch label and Problems hint already said 驳回; a zh-Hant session draws the same Simplified table.

拒绝 stays where it means access denial or declining an invitation, in the AI tool approvals, and in the designer's end-node refused outcome and its API-key, bulk-update and audit-outcome refusals. Display text only: the stored `rejected` status and the `reject` action key are unchanged, and English and the other languages are untouched.
