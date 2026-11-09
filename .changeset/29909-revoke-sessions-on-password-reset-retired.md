---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
---

feat(spec)!: retire `emailAndPassword.revokeSessionsOnPasswordReset` — a completed password reset always ends every session the account holds, and there is no setting (#29909)

Clause-②: no (narrowing) — `EmailAndPasswordConfig.revokeSessionsOnPasswordReset` becomes a `retiredKey()` tombstone, so the schema parse and `tsc` refuse it at any value, and plugin-auth's entry guard refuses it at any value too, `true` included, which it accepted before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: registered email-and-password-revoke-sessions-on-reset-retired -->

**BREAKING** for a configuration that still writes `emailAndPassword.revokeSessionsOnPasswordReset`, at any value.

- **`@objectstack/spec`.** `EmailAndPasswordConfig.revokeSessionsOnPasswordReset` is retired (ADR-0049 enforce-or-remove). A completed self-service password reset already ended every session the account holds, on every reset door, and an explicit `false` was already refused at boot, so the key could hold one value only. It is now a tombstone: a typed configuration that writes it fails `tsc`, and `AuthConfigSchema` / `EmailAndPasswordConfigSchema` refuse it with the prescription. The authorable-surface row reads `[RETIRED]`, `RETIRED_KEYS_BY_MAJOR[18]` lists `system/EmailAndPasswordConfig:revokeSessionsOnPasswordReset`, and the upgrade guide carries the semantic entry `email-and-password-revoke-sessions-on-reset-retired`. The prescription is exported as `REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED` (`@objectstack/spec/system`). No ADR-0087 conversion: the key lives in the configuration a host hands the auth plugin, never in a stack or a stored row, so `os migrate meta` has nothing to rewrite.
- **`@objectstack/plugin-auth`.** The auth manager takes its configuration unparsed, so it refuses the retired key itself, where the configuration enters: at construction, which stops the boot, and on a configuration patch, where the standing configuration keeps ruling. It now refuses `true` as well as `false`, with the tombstone's own prescription. `true` asked for what the platform does anyway; the key is to be deleted either way. The auth instance still sets better-auth's own option of that name itself, so a completed reset ends the account's sessions exactly as before.
- **Unchanged.** What a password reset does: every self-service reset door ends every session the account holds, and each ended session is stamped `revoke_reason: password_reset`. An absent key is accepted, as before.

**The remedy.** Delete `revokeSessionsOnPasswordReset` from the `emailAndPassword` block of the auth configuration, whatever it holds; nothing replaces it.
