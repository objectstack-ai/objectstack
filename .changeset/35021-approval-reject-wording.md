---
'@objectstack/plugin-approvals': patch
'@object-ui/i18n': patch
---

fix(i18n): an approval rejection reads 驳回 in Chinese on the runtime surfaces

Clause-②: no
Metadata-protocol: none

In Chinese, the approval runtime now names the reject decision 驳回 (zh-Hant 駁回), the word the flow designer gives the approval branch and the server notifications already use. Before, the designer said 驳回 and the approver clicked 拒绝 for the same decision.

- `@object-ui/i18n`: the `approvalsInbox` strings in zh-Hans and zh-Hant: the inbox and record-bar buttons, the bulk and single confirm dialogs, the toasts, the status chip (已拒绝 → 已驳回), the history row, the keyboard hint and the send-back limit notice.
- `@objectstack/plugin-approvals`: the zh-CN labels of `sys_approval_request` (the `approval_reject` lever, its confirm question and success toast, the `rejected` status) and of the `reject` row of `sys_approval_action`; the zh-Hant bundle already said 駁回. The email action-link confirm and result pages read 驳回.

拒绝 stays where it means access denial or declining an invitation, and in the AI tool approvals. Display text only: the stored `rejected` status and the `reject` action key are unchanged, and English and the other languages are untouched.
