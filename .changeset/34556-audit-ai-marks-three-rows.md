---
'@objectstack/plugin-audit': patch
'@objectstack/spec': patch
---

Clause-②: no
Metadata-protocol: none

The action-invocation, data-export and dataset-query rows in `sys_audit_log` now mark an in-product AI call the way the record-write row does. When the in-product AI performed the call for a person, `metadata` carries `performed_by` (the agent) beside `on_behalf_of` (the person), plus `conversation_id` and, when the person confirmed the call, `confirmation_id`. Before, these three rows read only an OAuth client from `performedBy` and recorded an in-product AI call as the person's own. An OAuth client stays the recorded performer, also when an envelope names both, and its rows never carry the two marks. A person's own call is unchanged. All four row kinds now apply one shared rule inside the package.

In `@objectstack/spec`, the `ExecutionContext.performedBy` describe no longer says these three rows record `clientId` only. It now says they record the performer and the two marks by the same rule. The reader rule there and in the `HookContext.provenance.performedByAgentId` describe now also says which tell decides when both apply. The change is describe text only, with no change to schema shape.
