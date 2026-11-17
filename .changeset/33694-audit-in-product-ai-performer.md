---
'@objectstack/plugin-audit': patch
'@objectstack/spec': patch
---

feat(plugin-audit): a record write the in-product AI made for a person is marked on its `sys_audit_log` row

Clause-②: no
Metadata-protocol: none

Before this change, a record the in-product AI changed for a signed-in person produced a `sys_audit_log` row identical to one that person typed. The write context already carried the AI's identity (`ExecutionContext.performedBy.agentId`, `conversationId` and `confirmationId`, surfaced to hooks as `provenance.performedByAgentId` and its siblings), but the record-write audit writer read only the OAuth client (`performedByClientId`).

The writer now records the in-product AI the way it records an MCP OAuth client, in the row's `metadata`:

- `performed_by`: the agent that ran, beside `on_behalf_of`, the person (the existing pair; no new actor vocabulary);
- `conversation_id`: the AI conversation the write was made in;
- `confirmation_id`: the pending item the person's approval decided, present only when the write needed a confirmation.

`user_id` and `actor` still name the person, so ownership, joins to `sys_user` and existing readers are unchanged. A write the person made themselves still carries none of these keys. The action-invocation, data-export and dataset-query rows still record the OAuth client only.

The `@objectstack/spec` descriptions of `ExecutionContext.performedBy` and `HookContext.provenance` no longer say these keys are not recorded; they name the metadata keys above. No schema shape changes.
