---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: the global `auth.mfa_required` switch cannot be saved on while `OS_AUTH_TWO_FACTOR=false` keeps two-factor enrollment off (#30302)

Clause-②: no (narrowing) — while `OS_AUTH_TWO_FACTOR` is set to off, a save that turns the `auth.mfa_required` setting on is refused `400 SETTINGS_VALIDATION` (`invalid_value` at `mfa_required`), a value an administrator could save before; saving it off, or re-saving a value already in force, passes. No published export, error code, settings key or `/auth/config` member is added; nothing is widened.
Metadata-protocol: none
Skills-docs: updated here — `content/docs/permissions/authentication.mdx` (the `mfa_required` row) and `docs/HARDENING.md` (the MFA row); `skills/**` teaches neither `mfa_required` nor `require_mfa`, so no skill or eval moves.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime accept set on one settings key, `auth.mfa_required`, judged against the deployment's `OS_AUTH_TWO_FACTOR` env var at save time; the remedy is a deployment change (set the env var on, or remove it), which no ledger entry can derive. The other categories are closed on facts: the bumped package publishes (not unpublished); no ADR-0087 id covers this key and this diff adds none (not registered, not already-registered); no published export is added, removed or retyped, so no interface or type narrows (not runtime-export-retired, runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing on the `auth.mfa_required` settings save (Setup → Authentication, `PUT /api/settings/auth`, `SettingsService.setMany`), on a deployment that sets `OS_AUTH_TWO_FACTOR` to off.

- **Before.** Turning on "Require multi-factor authentication" saved and read as on. The settings pass turns the requirement and the two-factor plugin on as one piece, but the `OS_AUTH_TWO_FACTOR` env var outranks the plugin flag, so under `OS_AUTH_TWO_FACTOR=false` nobody could enroll an authenticator app, and the MFA gate, which holds only a user who can enroll, enforced nothing. An organization's own `require_mfa` already refused this state; the global switch did not.
- **Now.** That save is refused before anything is written: the whole save, other keys in it included, with one field error at `mfa_required` naming `OS_AUTH_TWO_FACTOR`, in the caller's language (English, Simplified Chinese, Japanese, Spanish), and the constraint `{ twoFactor: false, overriddenBy: 'OS_AUTH_TWO_FACTOR' }`.
- **Unchanged.** With `OS_AUTH_TWO_FACTOR` unset or on, the switch saves and turns enrollment on with the requirement, as before. Turning it off is never refused. A switch saved on before this release is left as stored and still not enforced; `GET /api/v1/auth/config` answers `features.twoFactor: false` there, the same decision the gate makes, which is the reading a console uses to say the requirement is not enforced.

**The remedy.** Set `OS_AUTH_TWO_FACTOR=true` on the deployment (or remove it) and restart, then turn on `auth.mfa_required`.
