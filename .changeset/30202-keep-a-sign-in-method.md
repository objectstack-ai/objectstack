---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): saving the auth settings refuses to turn off the last way to sign in (#30202)

Clause-②: no (narrowing) — a save an administrator could make before is now refused at the settings save door with the existing `SETTINGS_VALIDATION` / `invalid_value` field error: email and password off while nothing else signs anyone in, and, while email and password is already off, the Google change that removes the last provider. No new error code, export or settings key. Nothing is widened.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches `auth.email_password_enabled`; `content/docs/deployment/environment-variables.mdx` already names the `OS_AUTH_EMAIL_PASSWORD_ENABLED` override used for recovery below.

- **Before.** Setup → Settings → Authentication, "Enable email/password login" off, save: "Settings saved", with no social provider and SSO off. After the next sign-out nobody could sign in, the administrator included.
- **Now.** `PUT /api/settings/auth` with `email_password_enabled: false` answers `400 SETTINGS_VALIDATION`, with a field error at `email_password_enabled` (`code: invalid_value`, `constraint.lastSignInMethod: email_password`) whose message, in the caller's language (en, zh-CN, ja-JP, es-ES), says to set up and save another sign-in method first. Nothing in that batch is written, and email and password stays on.
- **What counts as another way in.** A social or OIDC provider in force; enterprise SSO switched on with at least one identity provider registered (the switch alone does not count); phone-number sign-in; a host sign-in handoff the host declared. `ssoOnlyMode` alone, magic link and passkeys do not count.
- **The other direction.** While email and password is off, `google_enabled: false`, or clearing `google_client_id` / `google_client_secret` when no environment variable or stack config supplies it, is refused (`constraint.lastSignInMethod: google`) if Google is the last way in.
- **Already locked out.** Set `OS_AUTH_EMAIL_PASSWORD_ENABLED=true` and restart: the environment override wins over the stored `false`, and email and password sign-in comes back. Then set up another method before turning it off again.
