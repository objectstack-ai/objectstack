---
'@objectstack/plugin-auth': patch
'@objectstack/service-settings': patch
---

fix(plugin-auth)!: saving the auth settings refuses to turn off the last way to sign in (#30202)

Clause-②: yes (narrowing) — a save an administrator could make before is now refused at the settings save door with the existing `SETTINGS_VALIDATION` / `invalid_value` field error: a save after which email and password is off and nothing else signs anyone in, judged on the whole save, including the Google change that removes the last provider while email and password is off. No new error code or settings key. The widening half: `SettingsWritePredicateInput`, exported from `@objectstack/service-settings`, gains an optional `batch` field, the whole write a predicate is asked about.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches `auth.email_password_enabled` or the settings write predicate; `content/docs/deployment/environment-variables.mdx` already names the `OS_AUTH_EMAIL_PASSWORD_ENABLED` override used for recovery below.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: auth.email_password_enabled and the auth.google_* keys keep their declarations, and the save door now refuses only the save that leaves no way to sign in. The predicate input's new batch field is optional and additive. A value stored before is not rewritten (the existing OS_AUTH_EMAIL_PASSWORD_ENABLED override recovers it), so there is nothing at rest for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the auth settings save door (`PUT /api/settings/auth`, `SettingsService.setMany('auth', …)`): a save that would leave no way to sign in is refused, where it was saved before.

- **Before.** Setup → Settings → Authentication, "Enable email/password login" off, save: "Settings saved", with no social provider and SSO off. After the next sign-out nobody could sign in, the administrator included.
- **Now.** A save after which email and password is off and no other way in is in force answers `400 SETTINGS_VALIDATION`. The field error sits at `email_password_enabled` (`code: invalid_value`, `constraint.lastSignInMethod: email_password`), and its message, in the caller's language (en, zh-CN, ja-JP, es-ES), says to keep or set up another sign-in method before or in that save. Nothing in that batch is written, and email and password stays on.
- **The whole save is judged.** `{ email_password_enabled: false, google_enabled: false }` (or with `google_client_secret` cleared) on a deployment signing in with email and password plus Google is refused, with a field error at each of the two keys. Google filled in (switch, client ID and secret) in the same save that turns email and password off is accepted, and so is the switch alone over a client ID and secret already stored.
- **What counts as another way in.** A social or OIDC provider in force whose client ID and client secret are both set; enterprise SSO switched on with at least one identity provider registered (the switch alone does not count); phone-number sign-in; a host sign-in handoff the host declared. `ssoOnlyMode` alone, magic link, passkeys, and a provider listed without its credentials do not count.
- **The other direction.** While email and password is off, `google_enabled: false`, or clearing `google_client_id` / `google_client_secret` when no environment variable or stack config supplies it, is refused (`constraint.lastSignInMethod: google`) if Google is the last way in.
- **Already locked out.** Set `OS_AUTH_EMAIL_PASSWORD_ENABLED=true` and restart: the environment override wins over the stored `false`, and email and password sign-in comes back. Then set up another method before turning it off again.
- **For a write predicate's author (`@objectstack/service-settings`).** `SettingsWritePredicateInput.batch` holds every key the write sets in the namespace, the asked key among them, with the value it would store (`null` clears). `setMany` always passes it, frozen. A rule over several keys judges the state after the whole write from it instead of one key against the rest as they stand. Existing predicates need no change.
