---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a cloud-managed runtime keeps email and password sign-in off when its deployment declares it off

Clause-②: yes (narrowing) — narrowed: on a cloud-managed runtime (`OS_CLOUD_MANAGED=1`) whose deployment declares `emailAndPassword.enabled: false`, an auth settings save (`PUT /api/settings/auth`, `SettingsService.setMany('auth', …)`) that changes `email_password_enabled` to a value that reads on answers `400 SETTINGS_VALIDATION` (`invalid_value` at the key) and saves nothing in the batch, where it saved; a stored `email_password_enabled` that reads on is no longer applied there, so `GET /api/v1/auth/config` keeps answering `emailPassword.enabled: false`; and there a Google change no longer counts email and password as a way in, whatever the same save sets it to. Widened: on that runtime, a save that turns `email_password_enabled` off or clears it answers `200` and saves, where the sign-in method floor refused it `400 SETTINGS_VALIDATION`, because the host holds email and password off either way; the field error at that key can carry `constraint: { cloudManaged: true, declaredEmailPassword: false }`; a `managedEmailPassword` key on the sign-in floor copy, in all 11 locales; a module export (not on the package entry) `emailPasswordHeldOffByHost`.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the auth settings save or the email and password switch; `content/docs/deployment/self-hosting.mdx` and `content/docs/permissions/sso.mdx` gain the cloud-managed case in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: `auth.email_password_enabled` is a settings value, runtime state, not authorable metadata. The moved answers are a runtime refusal of one settings save, and one stored value not applied, on a cloud-managed runtime whose deployment declares email and password off; stored rows are left in place, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** for a cloud-managed runtime whose deployment declares email and password off: saving the auth settings with `email_password_enabled` changed to on is refused `400 SETTINGS_VALIDATION` and nothing in that save is written, and a value stored on earlier no longer turns email and password sign-in on. Self-hosted deployments, and cloud-managed ones whose deployment declares email and password on, are unchanged.

On a cloud-managed runtime (`OS_CLOUD_MANAGED=1`) the host refuses every password door. When such a runtime's deployment declared `emailAndPassword.enabled: false`, a stored `auth.email_password_enabled` that read on still overrode the declaration: `GET /api/v1/auth/config` answered `emailPassword.enabled: true`, and the sign-in page drew an email and password form whose every submit was refused.

- **The settings pass.** On such a runtime a stored `auth.email_password_enabled` that reads on is not applied, and the server says so once at `error`, with the remedy: clear the setting (or set it off) in the settings console. An `OS_AUTH_EMAIL_PASSWORD_ENABLED` value is the deployment's own declaration and still applies.
- **The save door.** A save that turns `auth.email_password_enabled` on there is refused with `400 SETTINGS_VALIDATION` and an `invalid_value` field error at the key, in the caller's language. Turning it off or clearing it is accepted there: the host holds it off either way, so the sign-in method floor no longer refuses that save.

Self-hosted deployments, and cloud-managed ones whose deployment declares email and password on, keep the toggle exactly as before.

What to do: nothing to migrate. On such a runtime, clear `auth.email_password_enabled` (or set it off) in the settings console if the server reports it stored on and not applied.
