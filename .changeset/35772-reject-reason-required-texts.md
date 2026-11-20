---
'@objectstack/skills': patch
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
---

docs(approvals): a reject reason is required at every human door — the contract docblock, the docs, the platform checklist and the skill reference say so

Clause-②: no
Metadata-protocol: none

Text only; no behaviour changes. `ApprovalService.decide()` already refuses a reject whose `comment` is missing, blank or not a string with `400 VALIDATION_ERROR` before any write, and an approve keeps its comment optional. The texts that still called the reason optional now state that rule: the `ApprovalDecisionInput.comment` and `IApprovalService.decide` docblocks in `@objectstack/spec` (the type is unchanged: `comment` stays optional in the interface, because an approve may omit it), the `approval_reject` action's source comment in `@objectstack/plugin-approvals`, which said the target route does not judge the reason, and `references/state-machines-and-approvals.md` § Recording a decision in `@objectstack/skills`. The skill reference pays for its new sentence in place: the outputs paragraph's restatement of how a previous approver picks the next node's approvers is replaced by a pointer to the Dynamic approvers example that shows it.
