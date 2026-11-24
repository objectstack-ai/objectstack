---
'@object-ui/i18n': patch
---

Clause-②: no
Metadata-protocol: none

The console now reads a drawn flow's approval step label (`flows.FLOW.approvals.NODE_ID.label`) through the spec's `resolveFlowApprovalStepLabel`, the resolver the server's approval reader uses, with the same resolve options it hands `translateFlow` for the flow's own label. A locale tag spelled in another case (`zh-cn` against a `zh-CN` bundle) now finds the approval label as it already found the flow label, and a locale missing the entry still answers nothing, so the drawing keeps the authored label.
