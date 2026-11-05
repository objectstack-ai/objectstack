---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: deleting the last identity provider is refused, and a boot that serves no sign-in method says so (#30300)

Clause-②: yes (narrowing) — a request an administrator could make before is now refused: `POST /api/v1/auth/sso/delete-provider` (Setup's "Delete SSO Provider") on the last identity provider, while email and password is off and nothing else signs anyone in, answers `409 DELETE_RESTRICTED` (an existing standard code, the one an organization delete refused for the same reason answers), or `503 SERVICE_UNAVAILABLE` when the provider list cannot be read to tell. No new error code, setting or field. The widening half: `AuthManager` gains `setSsoProviderDeleteFloor()`, marked `@internal`, through which `AuthPlugin` hands it the judge. The boot report is a new `error` log line only; nothing about the boot's outcome changes.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches deleting an SSO provider or the sign-in boot reports; `content/docs/deployment/self-hosting.mdx` gains "No sign-in method left" with the three doors and the recovery.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: sys_sso_provider keeps its columns and the delete endpoint keeps its request shape; it now refuses only the delete that leaves no way to sign in. Nothing stored is rewritten, so there is nothing at rest for a migration to rewrite. -->

**BREAKING** accept-set narrowing at `POST /api/v1/auth/sso/delete-provider`: deleting the identity provider that is the last way to sign in is refused, where it was deleted before.

- **Before.** Email and password off, one SSO identity provider registered and nothing else in force. Setup → the provider → "Delete SSO Provider": `200 {"success":true}`, the row gone. From then on nobody could sign in, the administrator included (measured on a real boot).
- **Now.** That delete answers `409` with `code: DELETE_RESTRICTED`, `lastSignInMethod: enterprise_sso`, and a message in the caller's language (en, zh-CN, ja-JP, es-ES) saying to turn email and password back on, or register another identity provider or set up another sign-in method, first. Nothing is deleted. When the provider list cannot be read to tell, it answers `503 SERVICE_UNAVAILABLE` instead of letting the delete through.
- **Still allowed.** Deleting a provider while another one remains, while email and password is on, while enterprise SSO is switched off, or while another way in counts: a social or OIDC provider with a client ID and secret, phone-number sign-in, or a host sign-in handoff. An unknown provider is still the vendor's `404`, and a caller with no session the vendor's `401`; the vendor's own provider-access check still decides who may delete which provider.
- **The redeploy door.** A boot whose configuration no longer declares the last way in (for example a redeploy without the `GOOGLE_CLIENT_*` pair while email and password is off) still boots, as before, and now reports at `error` under the grep token `no_sign_in_method_at_boot`, naming the consequence and the recovery. It is a positive claim only: a provider table that cannot be read says nothing. Refusing such a boot is a later option, not done: a deployment that signs people in through a door the auth plugin cannot see must keep starting.
- **Already locked out.** Set `OS_AUTH_EMAIL_PASSWORD_ENABLED=true` and restart: the environment override wins over a stored `auth.email_password_enabled = false` and over the stack config, and email and password sign-in comes back.
