---
'@objectstack/platform-objects': minor
'@objectstack/service-settings': minor
'@objectstack/plugin-auth': minor
---

Auth: password history / no-reuse (ADR-0069 D1, P1)

Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.
