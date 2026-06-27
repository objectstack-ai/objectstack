---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

Auth: SSO quality polish (ADR-0024 / cloud#551)

- **plugin-auth**: `OS_OIDC_PROVIDER_ENABLED` / `OS_SSO_ENABLED` / `OS_SCIM_ENABLED` now parse with the shared `readBooleanEnv` helper (same as `OS_AUTH_TWO_FACTOR` etc.), so the platform-standard truthy set works (`true`/`1`/`yes`/`on`, case-insensitive) instead of only the literal `'true'` — a repeated operator footgun where `OS_SSO_ENABLED=1` silently parsed as disabled. Added unit tests.
- **platform-objects**: `sys_sso_provider`'s list view gets a per-object empty state ("No SSO providers yet" + a pointer to "Register SSO Provider"), replacing the shared identity-object copy ("records are created automatically … cannot be added here") which is wrong for this object — it HAS a register action.
