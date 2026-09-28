---
"@objectstack/plugin-auth": patch
---

The `no_sign_in_account_at_boot` boot report states the email-verification rule each audience posture enforces.

Clause-②: no

The report's recovery advice said an `open` or `email_domain` posture forces email verification on the invited login. Later in the same message it said an `open` deployment can turn verification off. The first sentence stopped being true when posture `open` began honouring a deployment's opt-out. The message now states the rule once, as the auth plugin enforces it, and applies it to the invited login and to a new self-registered address alike:

- `email_domain` always forces email verification on.
- `open` forces it on unless the deployment turns it off, with `emailAndPassword.requireEmailVerification: false` or `OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false`. A `false` stored only through the settings console is refused.
- `invite_only` follows the deployment's declaration and is off by default.

The advice keeps its order: on a deployment with no mail transport, close the posture back to `invite_only`, with verification left at its default off, before the invited person registers.

Text only: no admission decision, verification default or accepted value changes.
