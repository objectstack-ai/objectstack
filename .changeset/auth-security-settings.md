---
"@objectstack/service-settings": minor
"@objectstack/plugin-auth": minor
---

feat(auth): password-policy & session settings — live, enforced (P0 security)

Extends the existing `auth` settings manifest (global scope) with the security policy keys that are **genuinely enforced today**, rather than standing up a new `security` namespace full of non-functional toggles (which would be false surface):

- **Password policy** — `password_min_length` (default 8), `password_max_length` (default 128). Enforced by better-auth on sign-up and password reset.
- **Sessions** — `session_expiry_days` (default 7, absolute lifetime), `session_refresh_days` (default 1, refresh threshold).

These ride the existing `AuthPlugin.bindAuthSettings` → `AuthManager.applyConfigPatch` path (read on `kernel:ready`, re-applied live via `settings.subscribe('auth')`, which invalidates the cached better-auth instance). Days are converted to seconds for better-auth's `session.{expiresIn,updateAge}`; unset (`source: 'default'`) and malformed/non-positive values are ignored so the provider default holds. Ships en + zh-CN translations.

Deliberately **out of scope** (no enforcement exists, so they're not declared as settings): MFA-required, IP allowlist, SSO/SAML, SCIM, API rate limits, password complexity/rotation/history. These are real features to be built, not settings toggles.
