---
'@objectstack/plugin-auth': patch
'@objectstack/core': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth): a directory deactivation revokes the user's API keys, and no one restores them

Clause-②: yes (widening)
Metadata-protocol: none

**The rule.** Deactivating a user through SCIM (`active: false`), or deleting one (`DELETE /Users/{id}`), revokes every API key the user owns. Each key row stays, with `revoked: true` and `revoked_reason: scim_deactivated`. A later re-activation lifts the directory's ban and re-arms none of those keys: the person creates a new key (`POST /api/v1/keys`, or the API Keys page) and replaces the old one wherever it is configured. An administrator's own ban and unban are unchanged and leave keys alone. The user's local password is not changed by this release.

**Who can restore such a key.** No one, from a user context. The owner's Restore is refused `403 PERMISSION_DENIED`, and so is a platform administrator's, naming the reason and the new-key road. The key door's `403 API_KEY_REVOKED` says the key cannot be restored and names no restorer. A key the user had already revoked, or that carried `admin_password_reset` or `administrator_suspended`, is restamped with `scim_deactivated` by the deactivation; a key that carried `organization_membership_ended` keeps it, since no one restores either.

**`@objectstack/platform-objects`: `sys_api_key.revoked_reason` gains the option `scim_deactivated`** ("Deactivated by the directory"), beside `admin_password_reset`, `organization_membership_ended` and `administrator_suspended`. The column stays readonly and off the ADR-0092 D2 whitelist, so no data-API write sets or clears it. The field's help text names the new reason and that no one restores it; every shipped locale carries the new option and help.

**If the revocation does not finish.** The deactivation still lands: the account is disabled and the SCIM request succeeds. The server logs one `error` line naming the user, how many keys were and were not revoked, and the remedy (revoke the remaining `sys_api_key` rows with that reason). The next SCIM write that leaves the user inactive runs the revocation again.
