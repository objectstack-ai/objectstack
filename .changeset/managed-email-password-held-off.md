---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a cloud-managed runtime keeps email and password sign-in off when its deployment declares it off

Clause-②: no
Metadata-protocol: none

On a cloud-managed runtime (`OS_CLOUD_MANAGED=1`) the host refuses every password door. When such a runtime's deployment declared `emailAndPassword.enabled: false`, a stored `auth.email_password_enabled` that read on still overrode the declaration: `GET /api/v1/auth/config` answered `emailPassword.enabled: true`, and the sign-in page drew an email and password form whose every submit was refused.

- **The settings pass.** On such a runtime a stored `auth.email_password_enabled` that reads on is not applied, and the server says so once at `error`, with the remedy: clear the setting (or set it off) in the settings console. An `OS_AUTH_EMAIL_PASSWORD_ENABLED` value is the deployment's own declaration and still applies.
- **The save door.** A save that turns `auth.email_password_enabled` on there is refused with `400 SETTINGS_VALIDATION` and an `invalid_value` field error at the key, in the caller's language. Turning it off or clearing it is accepted there: the host holds it off either way, so the sign-in method floor no longer refuses that save.

Self-hosted deployments, and cloud-managed ones whose deployment declares email and password on, keep the toggle exactly as before. Nothing to migrate.
