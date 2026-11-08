---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
'@objectstack/core': patch
---

feat(plugin-auth,platform-objects,core): `sys_api_key.revoked_reason` accepts `organization_membership_ended`, and no user-context Restore lifts it

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/platform-objects`: `sys_api_key.revoked_reason` gains the option `organization_membership_ended`** ("Organization membership ended"), beside `admin_password_reset`. It is the word `sys_session.revoke_reason` already carries when a membership removal ends a session, so one grep finds every place the platform acts on a membership ending, across sessions and keys. The platform never writes it: a host that removes someone from the organization and revokes their keys writes it in the system context, beside `revoked: true`. The column stays readonly and off the ADR-0092 D2 whitelist, so no data-API write sets or clears it. The field's help text names both reasons and who can restore each; the six translated locales carry the new option and the new help.
- **`@objectstack/plugin-auth`: the restore guard refuses every user-context restore of a key carrying that reason**, a platform administrator's included (by the `admin_full_access` grant or by the `OS_PLATFORM_OWNER_EMAIL` anchor), on the by-id path and per row on a multi-row update: `403 PERMISSION_DENIED`, nothing written, and a message that says the owner's membership ended and that a member creates a new key (`POST /api/v1/keys`, or the API Keys page). This is the `restore_api_key` row action's own door (`PATCH /api/v1/data/sys_api_key/{id}` with `{ revoked: false }`). Re-arming the key would hand a non-member's credential back its access, whoever clicks Restore, and on a `single` deployment no per-request membership check refuses the key, so `revoked` is the only barrier. A system-context un-revoke still lands and clears the reason, as for every reason. `admin_password_reset` keeps its rule unchanged: a platform administrator restores it, its owner does not.
- **`@objectstack/core`: the key door's `403 API_KEY_REVOKED` text for such a key** says it was revoked because its owner's membership in the organization ended and cannot be restored, and names the new-key road. It used to offer "its owner or a platform administrator can restore it", a restore the guard now refuses. Code, status and every carried field are unchanged.
