---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(runtime): switching a packaged action or a security catalog item off now records which administrator did it

Clause-②: yes (widening)
Metadata-protocol: none

The activation ledger (`sys_metadata_activation`) is written by the ADR-0126 activation doors. Until now, its row and that row's audit entry named nobody: `created_by` / `updated_by` on the ledger row and `user_id` / `actor` on the `sys_audit_log` row were null, even when a signed-in administrator made the request. The store wrote every row under a fixed system context that carries no user.

The action door (`POST /api/v1/actions/_activation/:object/:action`) and the security catalog door (`POST /api/v1/security/_activation/:type/:name`, for positions, permission sets, sharing rules and webhooks) now write the row for the caller. They pass down the caller's own execution context, elevated (`{ ...callerContext, isSystem: true }`). The elevation keeps the engine-owned ledger writable, and the engine and the audit plugin record the caller's user id on both rows.

- `@objectstack/core`: `MetadataActivationStore.setActive(row, options?)` takes an optional `{ context }`. The new `MetadataActivationWriteContext` type requires `isSystem: true`, so a door cannot pass the caller's context down without the elevation. Without a context, the store keeps writing under its system context, so a write that no caller requested still names nobody. `MetadataActivationWriteOptions` is exported too.
- `@objectstack/objectql`: `ObjectQL.setActionActive(row, options?)` and `ActionActivationProjection.setActive(row, options?)` pass the options to the store unchanged. `ActionActivationWriteOptions` is exported.
- `@objectstack/runtime`: both doors pass the caller's elevated context.

The flow toggle (`POST /api/v1/automation/:name/toggle`) is not changed yet. It reaches the ledger through `IAutomationService.toggleFlow(name, enabled)`, and that contract has no way to carry the caller.
