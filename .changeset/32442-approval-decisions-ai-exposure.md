---
'@objectstack/plugin-approvals': patch
---

Clause-②: no
Metadata-protocol: none

An approver's agent can now decide a pending approval request over MCP. The four approver decisions on `sys_approval_request` (approve, reject, reassign, send back) declare `ai: { exposed: true, description, requiresConfirmation: true }`, so `list_actions` lists them and `run_action` runs them once the call carries `confirm: true`. Each forwards to its approvals route as the caller, so the approval service admits the same people the console's buttons admit: a current approver of the request, or the administrator who may override it. Anyone else, the submitter included, is refused and the request stays pending. The submitter's levers, request-info and comments stay unexposed.
