---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a metadata save's audit row names the user who saved it

Clause-②: no
Metadata-protocol: none

A signed-in user's metadata save (`PUT /api/v1/meta/:type/:name`, the `/automation` definition doors, a delete) wrote its `sys_audit_log` row on `sys_metadata` with `user_id` and `actor` both null, although the save named its actor and the `sys_metadata` row's `created_by` / `updated_by` recorded it. `SysMetadataRepository.put` and `delete` run their writes as the system, so the audit writer saw no session user. They now pass the save's actor as `ExecutionContext.attributedUserId`, the existing attribution channel the audit writer reads into `user_id`. The write is still authorized as the system; the actor is never presented as the caller. A save with no actor (boot sync, seeds, engine self-writes) stays unattributed, as before.
