---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/plugin-audit': patch
'@objectstack/trigger-record-change': patch
'@objectstack/service-automation': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(audit): a write made while an administrator impersonates a user now records the administrator

Clause-②: yes (widening)
Metadata-protocol: added

An administrator who impersonates a user writes as that user, and until now nothing on the write said otherwise: the `sys_audit_log` row, the `sys_activity` row and the record were byte-identical to the user's own work. The session already knew (`sys_session.impersonated_by`); the write did not.

- `ExecutionContext.impersonatedBy` (new, optional, attribution only) carries the administrator's `sys_user` id. The shared request-identity resolution sets it from the session read that admitted the caller, for a session credential only. `HookContext.provenance.impersonatedBy` hands it to hooks; it is never folded into `session`, so a hook that gates on the caller still sees the impersonated user.
- `userId`, `created_by`, ownership, `current_user.*` RLS and every permission stay the impersonated user's. Nothing in the authorization path reads the new field.
- The audit writer stamps `sys_audit_log.metadata.impersonated_by` on record writes and on `action_invocation` rows, and `impersonated_by` plus `impersonated_by_name` in the `sys_activity` row's metadata. Each key is present only on such a write; its absence means the user acted themselves. `user_id` and `actor` do not move.
- A record-triggered flow started by such a write carries the administrator onto its own writes (`AutomationContext.impersonatedBy`), on both `runAs` arms. After an approval decision the decider's segment carries none.
- The console's record timeline and field history read 「Dev Admin 代王工操作」 (`detail.impersonatedActor`, in all ten console languages).

No schema column and no migration: older rows simply carry no key.
