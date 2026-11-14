---
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': minor
---

feat(plugin-auth): an SSO provider can sign the person out of the company sign-in too, per provider and off by default

Clause-②: yes (widening) — `sys_sso_provider` gains a `sign_out_of_idp` column (boolean, default false), `/sso/register` and `/sso/update-provider` accept a `signOutOfIdp` member, the Edit Sign-In Options action gains its param, the Register SAML Provider and Edit SAML Settings actions gain an optional `logoutUrl`, and `/sso/saml2/sp/slo/:providerId` and `/sso/saml2/logout/:providerId` answer for a provider whose switch is on. Nothing that was served before is refused now; with the switch off (every existing provider) sign-out answers exactly as before.
Metadata-protocol: added

Each SSO provider has a new sign-in option, **Sign Out of the Company Sign-In Too**. It is off by default, and a change is recorded in the audit log like the other sign-in options (`trackHistory`). With it on, signing out of the platform also ends the person's session at the identity provider:

- **SAML** through single logout. Sign-out answers `{ success, url, redirect }` with the identity provider's logout URL carrying a LogoutRequest for the session that signed in, and the platform session ends. The identity provider's logout address is the new **IdP Logout URL** on Register SAML Provider and Edit SAML Settings, stored in the provider's SAML configuration as its single logout service (no new column). The provider's single logout endpoint opens only while the switch is on, and a logout message from the identity provider is accepted only when it is signed; a signed logout request ends only the session it names.
- **OIDC** through an RP-initiated logout redirect. Sign-out answers `{ success, url, redirect }` with the provider's `end_session_endpoint`, carrying the ID token of that sign-in as `id_token_hint`, the `client_id`, a `post_logout_redirect_uri` when the sign-out's `callbackURL` is on a trusted origin, and the sign-out's `state`. The endpoint is read from the provider's discovery document when the switch is saved on, and kept in its stored OIDC configuration.

Saving the switch on is refused `400 VALIDATION_FAILED` on `signOutOfIdp` for a provider that cannot honour it: a SAML provider with no IdP Logout URL, or an OIDC provider whose discovery document cannot be read or names no `end_session_endpoint` on a trusted origin. Saving it off is never refused. A sign-out through the SAML single logout writes the same logout audit row as `/sign-out`.

Not in this change: the Console sign-out following the answered `url`, and any form item the Edit Sign-In Options form does not render by itself, are a later Console change. A session started before the switch was turned on signs out of the platform only.
