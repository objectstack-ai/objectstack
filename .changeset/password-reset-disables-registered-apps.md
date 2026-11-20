---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-email': patch
'@objectstack/core': patch
'@objectstack/cli': patch
---

fix(plugin-auth)!: a password reset disables the OAuth applications the account registered and revokes the SCIM credentials it minted

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is what a completed password reset ends: rows the account owns are written disabled or revoked by the doors administrators already use, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an account that registered an OAuth application or minted a SCIM provisioning credential, and then has its password reset.

- FROM: a completed password reset (the emailed link, the texted code, an administrator's `POST /api/v1/auth/admin/set-user-password` with `revokeSessionsAndKeys` on, and `os user set-password`) ended the account's sessions, API keys, linked sign-in accounts, authorized apps and device sign-ins. The OAuth applications the account registered (`sys_oauth_application.user_id`) stayed enabled, and the SCIM credentials it minted (`sys_scim_connection_credential.user_id`) stayed active. A self-service reset sent the account no notice.
- TO: the same resets also disable every OAuth application the account registered that is not disabled, as a platform administrator's Disable action does (the provider issues it no token, client-credentials tokens included, answers its tokens inactive at introspection, and the MCP endpoint refuses every token it holds), and revoke every SCIM credential the account minted that is still active, as Revoke Credential does. An application another account registered and a credential another administrator minted are not touched. The account's single sign-on providers and two-factor enrolment are kept.
- A completed self-service reset then mails the account `auth.password_reset_notice` (a new built-in template, in en-US, zh-CN, ja-JP and es-ES): how many API keys, linked sign-in accounts and authorized apps it ended, each application it disabled and each credential it revoked by name, and the single sign-on providers and second factor it kept. It is best-effort: a notice that cannot be sent never fails the reset. The forced resets send no notice and answer their requester instead.
- The administrator's forced reset reports the new counts on `data.revoked` (`ownedApps`, `scimCredentials`) and on its ledger row (`revokedOwnedApps`, `revokedScimCredentials`); `setOperatorPassword` answers `ownedAppsDisabled` and `scimCredentialsRevoked`, and `os user set-password` prints them. A disable or revoke that does not land answers the self-service requester an error and keeps the forced reset's `complete` false, as for the other rows.
- A password change disables and revokes nothing. Its reminder, `auth.password_changed_notice`, now also lists the OAuth applications the account registered that are still enabled and the SCIM credentials it minted that are still active, and is sent when the account holds only those.

The fix for an owner after a reset: ask a platform administrator to enable an application you still need again, and have a platform administrator mint a new SCIM credential for a connection whose credential was revoked.
