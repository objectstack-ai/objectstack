---
"@objectstack/service-settings": patch
---

The auth settings console states the email-verification rule each audience posture enforces (#20413).

Clause-②: no

The Audience group description and the `audience_posture` help said every posture other than invitation-only forces email verification on. That stopped being true when posture `open` began honouring a deployment's opt-out. Both strings, in the manifest and in the `en`, `zh-CN`, `es-ES` and `ja-JP` bundles, now state the rule the auth plugin enforces:

- `email_domain` always forces email verification on.
- `open` forces it on unless the deployment turns it off, with `OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false` or `emailAndPassword.requireEmailVerification: false` in the stack config.
- A `false` saved in the settings console is refused under `open`.

Text only: no key, option, default or accepted value changes.
