---
'@objectstack/platform-objects': patch
'@objectstack/runtime': patch
---

feat: Setup → API Keys → Create Key offers the key's expiry, and a date past the policy's maximum is refused with the policy named

Clause-②: yes
Metadata-protocol: none

Create Key asked only for a name, so every key silently got the default life the Authentication API key policy sets, and the list then showed an expiry the admin never chose. The `sys_api_key` action `create_api_key` now declares an optional `expires_at` param, the second body key `POST /api/v1/keys` already reads. Its help text says what an empty field means (the policy's Default key lifetime, 90 days unless changed) and that a date later than the policy's Maximum key lifetime is refused. The param has no literal default on purpose: an action param default is submitted verbatim, so a fixed date there would override the deployment's policy instead of following it. The reveal dialog now shows the expiry the key actually got, beside the key.

The route behaviour is unchanged: an empty field gets the policy's default life, and a date past the maximum is refused `400 API_KEY_EXPIRY_TOO_LONG`, never clamped. That refusal's message now names the setting that decided it ("the Authentication API key policy's Maximum key lifetime is N days") next to the latest date allowed.
