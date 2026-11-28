---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: Setup → Authentication's switches show what the deployment runs when nothing is saved

Clause-②: yes (narrowing) — narrowed: with nothing stored, `SettingsService.get('auth', …)` and `GET /api/settings/auth` answer `email_password_enabled`, `signup_enabled` and `require_email_verification` with the deployment's declaration (still `source: 'default'`), where they answered the manifest default; so on a cloud-managed runtime (`OS_CLOUD_MANAGED=1`) whose deployment declares `emailAndPassword.enabled: false`, a save of `email_password_enabled: true` with nothing stored answers `400 SETTINGS_VALIDATION` (`invalid_value` at the key) and saves nothing in the batch, where it saved a row that was not applied; and a save that sets one of these keys to its manifest default where the declaration differs now asks the key's write predicates. Widened: a save that sets one of these keys to the declaration with nothing stored is no change and asks no predicate; on a deployment that declares `emailAndPassword.enabled: false` with nothing stored, the ten `auth` keys visible only while `email_password_enabled !== false` (`signup_enabled`, `require_email_verification`, `password_min_length`, `password_max_length`, `password_reject_breached`, `password_require_complexity`, `password_min_classes`, `password_history_count`, `password_expiry_days`, `mfa_required`) are hidden, so a save of one of them is no longer judged for `required`, options or bounds (for example `password_min_length: 2` is now stored where it was refused `400 SETTINGS_VALIDATION`), as under a stored `email_password_enabled: false`; a save that turns `email_password_enabled` on re-judges them; `AuthManager.resolveDisableSignUp(declared)` (public method). The Setup → Authentication live-status banner no longer states the declared-off, nothing-saved case (the switch says it): its `declaredOffLabel` / `declaredOffText` copy is removed, and the cloud-managed statement is always a `warning`.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the auth settings page or these switches; `content/docs/protocol/kernel/config-resolution.mdx` states the declared default.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: these are settings values, runtime state, not authorable metadata, and the settings manifest is unchanged. What moves is the value a key with nothing stored resolves to, and the save of it that a write predicate is now asked about; no stored row is read differently, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** for a reader of `GET /api/settings/auth` or `SettingsService.get('auth', …)` on a deployment whose own configuration differs from the manifest default for one of these three keys, with nothing saved: the value answered is now what runs (for example `email_password_enabled: { value: false, source: 'default' }` where the deployment declares `emailAndPassword.enabled: false`), not the manifest default. A saved value and an `OS_AUTH_*` override still win, and a clear returns to the declaration.

What each switch reads with nothing saved:

- `email_password_enabled` — `emailAndPassword.enabled`, on unless declared `false`.
- `signup_enabled` — off where self-registration is forced off (SSO-only, cloud-managed) or turned off by `OS_DISABLE_SIGNUP` or a declared `emailAndPassword.disableSignUp: true`; else on.
- `require_email_verification` — the declared `emailAndPassword.requireEmailVerification` under the audience posture in force: on under `email_domain`, on under `open` unless declared `false`, else as declared (off by default).

On a cloud-managed runtime whose deployment declares email and password off, the switch now reads off with nothing saved, and turning it on is refused at the save door (before, the save was stored and not applied, because `true` was the value the settings service already resolved). Self-hosted deployments keep taking a saved value as before.

What to do: nothing to migrate. A client that read `source: 'default'` as "the manifest default" should read it as "nothing is saved; this is the deployment's default".
