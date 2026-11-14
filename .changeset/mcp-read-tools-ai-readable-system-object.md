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

`@objectstack/plugin-audit`: the activity and audit copies of an approval request are hardened: a ledger copy holds no value that its owner narrows per reader. New copies no longer carry the request's subject snapshot, and `migrateSideCopies` / `migrateArchivedSideCopies` rewrite the copies at rest. Both ledgers' read redactions drop it from an older copy whether or not the rewrite has run.

**Who can query those copies narrows.** A non-system query on `sys_activity` or `sys_audit_log` that names `sys_approval_request` by equality on `object_name` and names a column holding the copy (`metadata`; `old_value`, `new_value`), as a free-text search does, is now judged against every registered object, as a query naming no object already is. A reader withheld any field of any object, an organization administrator included, is refused it (`403`) where they were answered before. The same query pinned to another object, or naming only other columns, is judged as before. This does not depend on the rewrite having run.
