---
'@objectstack/spec': minor
'@objectstack/service-settings': minor
'@objectstack/plugin-auth': minor
'@objectstack/cli': minor
---

Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

- **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
- **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
- **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
- **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).
