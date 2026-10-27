---
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

fix(service-automation): switching a packaged flow off now records which administrator did it

Clause-②: yes (widening)
Metadata-protocol: none

The flow toggle (`POST /api/v1/automation/:name/toggle`) writes a row in the activation ledger (`sys_metadata_activation`). Until now, that row and its audit entry named nobody: `created_by` / `updated_by` on the ledger row and `user_id` / `actor` on the `sys_audit_log` row were null, even when a signed-in administrator made the request. The action and security catalog doors were fixed in the previous release; the flow door reaches the ledger through `IAutomationService.toggleFlow`, which could not carry the caller until its `caller` parameter landed.

- `@objectstack/runtime`: the flow toggle door passes `toggleFlow(name, enabled, { userId })`, the signed-in user's id and nothing else.
- `@objectstack/service-automation`: `AutomationEngine.toggleFlow(name, enabled, caller?)` implements the contract's `caller`. The ledger write runs as that user, elevated and with no positions or permissions, so the engine and the audit plugin record the user's id on both rows. Only `userId` is read from `caller`. With no caller, or a caller without an id, the write stays unattributed, as before. `FlowActivationStore.setActive(row, options?)` takes the same optional `{ context }` as the shared activation store in `@objectstack/core`; a store that ignores it keeps working.
