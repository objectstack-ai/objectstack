---
'@objectstack/spec': patch
---

feat(spec): `IAutomationService.toggleFlow` takes an optional caller, so switching a packaged flow on or off can name the admin who did it

Clause-②: yes (widening)
Metadata-protocol: none

`toggleFlow?(name, enabled)` gains an optional third parameter, `caller?: Pick<AutomationContext, 'userId'>`. A door that serves a person passes that person's id, so the `sys_metadata_activation` row the switch writes, and its `sys_audit_log` row, can name the administrator instead of a null actor. An absent caller, or one without a `userId`, means an unattributed write. The channel carries the acting user only: it grants nothing, since the authority gate stays at the door, and it names no tenant, since the activation ledger has no organization column.

The parameter is optional, so every current implementer and caller compiles unchanged. This is the contract half: the toggle door and `@objectstack/service-automation`'s `toggleFlow` start passing and writing the caller in a later change, and until then the flow switch's ledger row still carries no actor.
