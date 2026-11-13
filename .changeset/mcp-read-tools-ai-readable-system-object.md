---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-audit': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

The MCP read tools (`list_objects`, `describe_object`, `query_records`, `get_record`, `aggregate_records`) now admit a system object whose author declared `enable.aiReadable: true`, asked through a new optional bridge member `aiReadExposed` that both bridges answer with `isAiReadExposed`. Every gate after admission is unchanged (the caller's permissions, row-level security, the object's own read gates, field masking), and every write tool still refuses every `sys_*` object. `sys_approval_request` declares the key; `query_records` names the "waiting on you" filter shape.

The member baseline `member_default` now names `sys_approval_request` read-only, so every signed-in member holds a data-door read on it; which rows is still the approvals request read gate (the submitter, a current approver, a past actor), and no write opens. That gate now answers a conjunctive `pending_approvers` `$contains` of the caller's own id with the approvals service's acting-address fold, so the console's My Pending view and an agent's "waiting on me" query find a slot addressed by email or an unstaffed position, not only one holding the user id. A `pending_approvers` predicate naming another id, or under `$or`, is read as written.

`@objectstack/plugin-audit`: the activity and audit copies of an approval request no longer carry its subject snapshot, with a rewrite for copies at rest (`migrateSideCopies`) (GHSA-2985-5f64-8wgh).
