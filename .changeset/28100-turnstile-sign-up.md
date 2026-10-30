---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(plugin-auth): opt-in Cloudflare Turnstile on email sign-up — off unless both `OS_TURNSTILE_SITE_KEY` and `OS_TURNSTILE_SECRET_KEY` are set

Clause-②: yes (widening: the public auth config gains `features.turnstileSiteKey`, served only while the challenge is on; `PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS` and `AuthFeaturesConfigSchema` gain `turnstileSiteKey`; with the challenge on, `/sign-up/email` answers better-auth's `captcha` refusals `400 MISSING_RESPONSE`, `403 VERIFICATION_FAILED` and `500 UNKNOWN_ERROR`; two new env vars; `@object-ui/auth` gains `TurnstileWidget`, `TURNSTILE_SCRIPT_URL`, `RegisterForm`'s `turnstileSiteKey` prop and `captchaFailed`/`captchaRetry` labels, `SignUpData.captchaToken` and a fifth `signUp` argument; `@object-ui/app-shell` gains `signUpCaptchaFailedMessage`)
Metadata-protocol: none

A deployment can now ask for a human check before an email/password account is created. Set both variables and:

- **The server** mounts better-auth's `captcha` plugin with the `cloudflare-turnstile` provider on `/sign-up/email` only. A sign-up without a token in the `x-captcha-response` header is refused before anything is read or written, a token is verified with Cloudflare using the secret, and a verification that cannot complete fails closed. Sign-in and password reset are not challenged (better-auth's default list would have included them; it is overridden). The per-address rate limit still runs first. Server-side registrations through `auth.api.signUpEmail` (the development admin seed, demo staff) are unaffected.
- **The public auth config** (`GET /api/v1/auth/config`) serves `features.turnstileSiteKey`, the public site key, and never the secret.
- **The Console** renders the challenge on `/register` and on the first-run `/setup` wizard, holds submit until it is solved, and sends the token. A failed, expired or refused challenge shows one retry message, never Cloudflare's code or the plugin's text. The Console document's content-security-policy admits `https://challenges.cloudflare.com` in `script-src` and `frame-src` only while both variables are set.

With either variable unset or blank nothing changes: no plugin, no config key, no widget, the same policy. A deployment that sets only one gets one boot `warn` naming the missing variable.
