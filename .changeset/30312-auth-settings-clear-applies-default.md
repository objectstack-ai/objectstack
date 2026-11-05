---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: clearing an authentication setting, or restoring the namespace's defaults, takes effect at once (#30312)

Clause-②: yes (narrowing) — one save an administrator could make before is now refused at the settings save door with the existing `SETTINGS_VALIDATION` / `invalid_value` field error: clearing `auth.email_password_enabled` on a deployment that itself declared email and password off, when nothing else signs anyone in after the save. Before, that clear was saved and changed nothing at runtime; now a clear applies, and that one would lock everyone out. No new error code, settings key or export.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches the auth settings namespace, its clear or the sign-in floor.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: every auth key keeps its declaration. A clear now applies the deployment's own declared value, which is what a clear always documented; the save door refuses only the one clear that would leave no way to sign in. Nothing at rest is rewritten, so there is nothing for a migration to do. -->

**BREAKING** accept-set narrowing at the auth settings save door (`PUT /api/settings/auth`, `SettingsService.setMany('auth', …)`): one clear that was saved before is refused.

- **The fix.** A cleared `auth.*` key (the console sends `null`) or a namespace reset resolves `source: 'default'`. Every key except `allowed_ip_ranges` (#30203) then kept its last stored value in force until a restart: lockout threshold, max sessions per user, password policy, session lifetime, MFA, API-key lifetime, rate limits, Google, audience. Now the running value returns in the same pass to what the deployment declared (plugin options, `auth:configure`), or to the built-in default where it declared nothing. A value in a block the auth manager judges (`emailAndPassword`, `plugins`, `audience`) is restored through that same block, so it is judged as a save of it would be. Environment overrides keep ruling.
- **The refused clear.** With email and password declared off by the deployment and turned on in Setup, and no other way in (Google switched off in Setup, no other provider, no SSO, no phone sign-in, no host handoff), clearing "Enable email/password login" now answers `400 SETTINGS_VALIDATION` at `email_password_enabled` (`constraint.lastSignInMethod: email_password`), and nothing is written. Set up another sign-in method first, or save the toggle on explicitly instead of clearing it.
- **Session lifetime.** A stored `session_expiry_days` / `session_refresh_days` now overrides its field of the deployment's declared `session` block instead of replacing the whole block.
