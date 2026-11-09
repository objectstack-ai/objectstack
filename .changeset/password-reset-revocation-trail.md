---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth): a session a password reset ends leaves a revocation trail

Clause-②: no
Metadata-protocol: none

- **A session a password reset ends leaves a revocation trail.** When a completed self-service password reset ends the account's sessions — the emailed link (`POST /api/v1/auth/reset-password`), and the phone OTP reset (`POST /api/v1/auth/phone-number/reset-password`); better-auth's email-OTP reset door, which the platform does not mount, is covered on its own path too — each `sys_session` row is now kept and stamped, `revoked_at` with `revoke_reason: password_reset`, the same kind of trail an interactive revoke leaves, instead of being deleted. The session is still refused (`401`).
- **The value says who ended the session.** `password_reset` is distinct from `user_revoked` (the owner revoking their own sessions) and from `admin_password_reset`, which an administrator's forced reset keeps writing.
- **`sys_session.revoke_reason`'s published vocabulary names `password_reset`** (`@objectstack/platform-objects`, the field's description and its translated help).
- **Unchanged.** Which sessions a reset ends; sign-out, which still deletes its row; the account's API keys, which a self-service reset does not revoke; and the audit log, which records no `logout` row for a reset.
