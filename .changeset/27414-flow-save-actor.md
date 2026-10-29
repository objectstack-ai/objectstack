---
'@objectstack/runtime': patch
---

fix(runtime): creating, updating or cloning a flow over `/automation` now records which user saved it

Clause-②: no
Metadata-protocol: none

`POST /api/v1/automation`, `PUT /api/v1/automation/:name` and `POST /api/v1/automation/:name/clone` store the flow as a `sys_metadata` row. Until now that row named nobody: `created_by` and `updated_by`, and `recorded_by` on its `sys_metadata_history` entry, were null even when a signed-in administrator made the request. The `/meta` door already recorded the user. All three `/automation` doors now pass the signed-in user's id as the save's actor, so the row names that user, the same way `PUT /api/v1/meta/flow/:name` does. A request with no user, such as the engine's own system call, still saves with no actor, as before.

The `sys_audit_log` row for the same write is not changed by this fix. It still has a null `user_id` on every metadata door, `/meta` included.
