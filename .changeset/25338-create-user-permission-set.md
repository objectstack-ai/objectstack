---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat: Create User can grant a permission set in the same step, judged by the same delegated-administration gate as Setup's grant form

Clause-②: yes (widening: `POST /api/v1/auth/admin/create-user` and the `sys_user` `create_user` action accept an optional `permissionSet`; a request without it is answered exactly as before)
Metadata-protocol: none

A user created with no permission set signed in to a screen of refusals. Setup → Users → Create User now offers an optional **Permission Set** (the set's machine name, checked against the security catalog).

- **How the grant is written.** The route inserts the `sys_user_permission_set` row under the calling administrator's OWN execution context, never the system's. The security middleware, the ADR-0090 D12 delegated-administration gate (which stamps `granted_by`) and the catalog name check judge it exactly as they judge the grant form. The route's platform-admin gate decides who may create a user; it never decides what that user may be granted.
- **One step, one outcome.** The account and the grant run in one engine transaction. A refused grant answers the refusal's own status and code (403 `PERMISSION_DENIED` from the gate, 400 `VALIDATION_FAILED` with its `fields` for a name the catalog does not hold), and no user is created. A datasource whose driver has no `beginTransaction` runs the two writes unatomically, the engine's declared limit (ADR-0119 D1).
- **Refused before anything is written:** a `permissionSet` that is not a string (400), a caller whose own context does not resolve (403), and a host that wires no grant seam (501).
- **Response.** The success body carries `permissionSet` beside the user, and the result dialog shows it.
- **Cloud-managed environments are unchanged.** `create_user` stays hidden while `features.cloudManaged` is on.
