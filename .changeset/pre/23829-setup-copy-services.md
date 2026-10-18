---
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-security': patch
'@objectstack/service-automation': patch
'@objectstack/plugin-sharing': patch
---

Clause-②: no

The approval, security, automation and sharing objects describe their records in plain admin
sentences. Approval Delegations now reads "While someone is away, approvals assigned to them
personally go to their delegate.", Record Shares "Records shared beyond their owner, one row per
grant.", User Positions "Which positions each user holds, one row per assignment.", Audience
Binding Suggestions "A package's suggestion to give one of its permission sets to everyone who
signs in, and the decision taken on it." and Automation Runs "Paused automation runs waiting to
resume, and the recent history of finished runs." Field help on Approval Requests, Approval
Delegations, User Positions, User Permission Sets and Audience Binding Suggestions, the
descriptions of the `organization_admin_no_bypass`, `mcp_agent_data_read` and
`mcp_agent_data_write` permission sets, the flow-dispatch ledger's description and the
reserved-position refusal no longer carry design-record numbers or runtime vocabulary; those
references stay in the code comments. The zh-CN, ja-JP and es-ES translations follow. Wording
only: no field, permission or behaviour changes.
