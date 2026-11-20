---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
---

docs(approvals): a reject reason is required at every human door — the contract docblock, the docs and the platform checklist say so

Clause-②: no
Metadata-protocol: none

Text only; no behaviour changes. `ApprovalService.decide()` already refuses a reject whose `comment` is missing, blank or not a string with `400 VALIDATION_ERROR` before any write, and an approve keeps its comment optional. The texts that still called the reason optional now state that rule: the `ApprovalDecisionInput.comment` and `IApprovalService.decide` docblocks in `@objectstack/spec` (the type is unchanged: `comment` stays optional in the interface, because an approve may omit it), and the `approval_reject` action's source comment in `@objectstack/plugin-approvals`, which said the target route does not judge the reason.
