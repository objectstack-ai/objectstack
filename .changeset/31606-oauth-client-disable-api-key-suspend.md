---
'@objectstack/plugin-auth': patch
'@objectstack/core': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth): disabling an OAuth client refuses its already-issued tokens on their next call, and a platform administrator's revoke of someone else's API key holds against its owner

Clause-②: yes (widening)
Metadata-protocol: none

**OAuth clients.** Disabling a client (the Disable action of `sys_oauth_application`, `POST /api/v1/auth/admin/oauth2/toggle-disabled`) refused it a new token, but the MCP door kept serving the access tokens it already held until they expired, up to an hour. The door now reads the client on every call, beside the consent it already reads, and refuses with the same `401` a withdrawn grant gets when the client is disabled, when its row is gone, or when the read fails. Disabling is a pause: the consent and the refresh token stay, so enabling the client again serves them again. To end the grant, withdraw it (`POST /api/v1/auth/authorized-clients/withdraw`, or the admin door) or call `/oauth2/revoke`. Each MCP call now makes two indexed reads (the client by `client_id`, then the consent) instead of one.

**API keys.** A revoked key is restorable, and until now its owner could restore a key an administrator had revoked the moment it was revoked. When a platform administrator revokes a key that is not theirs, `sys_api_key.revoked_reason` now records `administrator_suspended`, and only a platform administrator can restore that key. The owner's restore is refused `403 PERMISSION_DENIED`, naming the reason, and the key door's `403 API_KEY_REVOKED` says who can restore it. Restoring clears the reason, as before, and the same key works again with no re-issue. A host that stops a key itself writes the same value in the system context, beside `revoked: true`. The owner's own revoke still records no reason. An administrator's revoke never replaces a reason the key already carries, so a key revoked because its owner's membership ended stays restorable by no one. One multi-row revoke that matches both a key this rule stamps and a key that already carries a reason is refused whole with `400 VALIDATION_ERROR`; revoke those keys separately. The new select option and its description are translated in every shipped locale.

This does not stop a person from minting a new key of their own. A key acts as its owner, so stopping an agent for good takes a credential its owner cannot re-issue.
