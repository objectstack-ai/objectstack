---
'@objectstack/plugin-approvals': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

A submitter's agent can now recall and resubmit its own approval request over MCP. `approval_recall` and `approval_resubmit` on `sys_approval_request` declare `ai: { exposed: true, description, requiresConfirmation: true }`, the same shape the four approver decisions got, so `list_actions` lists them and `run_action` runs them once the call carries `confirm: true`. Each forwards to its approvals route as the caller, so the approval service admits the same people the console's buttons admit: the submitter, and, for recalling a pending request, the administrator who may override it. Anyone else is refused (recall in the `approval_recall_not_submitter` sentence) and the request does not move. Remind, request-info and comments stay unexposed.
