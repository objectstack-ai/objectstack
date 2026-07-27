---
"@objectstack/plugin-auth": patch
"@objectstack/service-settings": patch
---

fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

`auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
governed two-factor verification no matter what the admin configured. An operator
who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
password stage that locked at 3 and a second factor that still locked at 10: the
stricter door was the looser one, with nothing in the UI saying so.

`lockout_threshold` / `lockout_duration_minutes` are now projected onto
better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
`durationSeconds`, minutes converted to seconds) rather than growing a parallel
`two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
field arrives as a new option instead of a conflict. The projection goes through
`applyConfigPatch`, which resets the cached better-auth instance, so a settings
change takes effect without a restart.

Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
password stage's "off", and a deployment may leave that stage unlocked because
rate limiting or an IdP covers it; the second factor is the last check before a
session is issued, so it keeps better-auth's default rather than being switched
off by a setting that never mentioned it.

The threshold field is also no longer hidden behind `email_password_enabled` —
two-factor verification exists in passwordless deployments, where the setting was
previously unreachable.

Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
option reaches; a threshold above 5 forces a fresh challenge rather than raising
that cap.
