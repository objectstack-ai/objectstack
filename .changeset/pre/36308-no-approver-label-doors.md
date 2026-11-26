---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the decide refusal and the submitter notice name a no-approver position by its label, and the approver-type word is translated

Clause-②: no
Metadata-protocol: none

When a request opens on a slate that names no one but its submitter, three places tell people what to do next: the request's timeline note, the notice sent to the submitter, and the refusal when the submitter tries to approve it. Only the timeline note named a position by its label. The other two used the position's internal name (`legal`), and in all three the approver type stayed the English token (`position`) in every language, so a zh-CN reader read `担任 position '销售经理' 的成员`.

- The decide refusal (`FORBIDDEN`, both the `excludeSubmitter` refusal and the administrator-override refusal) names each position by the decider's language pack label, then its declared label, then its name. The sentence itself stays English, as before.
- The submitter's `approval.comment` notice names the position the same way, per recipient at delivery. For a slate of one slot its body is the new `approvalNoApproverHoldingSlot` sentence, which carries the approver type's word and the position's label as catalog keys. A slate of several slots still sends one English `who`, with each position named by its declared label.
- The approver type is named by its own word in all eleven packs (`approvalApproverTypePosition`, `…Team`, `…Department`, `…OrgMembershipLevel`), and each slot is one `approvalNoApproverSlot` clause joined by `approvalNoApproverSlotSeparator`. A zh-CN reader now reads `担任岗位「销售经理」的成员`. A slot of any other type keeps its token, as the administrators' note does.

The English is unchanged. Each `en` type word is the machine token, so the comment a request stores and the English refusal still read `position 'legal'` for a position with no label. Stored audit text is not rewritten.
