---
'@objectstack/plugin-auth': minor
'@objectstack/spec': patch
---

**plugin-auth: under the `open` audience posture, the deployment can turn email verification off**

Clause-②: yes (widening)

Under `audience.posture: 'open'`, an explicit `emailAndPassword.requireEmailVerification: false`
declared by the **deployment** is now honoured instead of refused at config entry. The deployment
declares it through its stack config (the `AuthManager` constructor), host code calling
`AuthManager.applyConfigPatch()`, or the `OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false` env override
of the `auth.require_email_verification` setting. A sign-up is then signed in at once, with no
verification mail. This is for a deployment with no mail transport that trusts its sign-ups,
such as a pre-production environment, which otherwise dead-ends every new account at the verify
page.

Nothing changes for anyone who does not opt out:

- `open` with the value absent or `true` still forces verification on.
- `email_domain` still refuses an explicit `false`, from any source, with the same message. The
  domain allowlist is the only gate there, so an unverified sign-up could claim a colleague's
  address.
- `invite_only` is unchanged.
- A `false` stored only through the settings console is still refused under `open`. The console
  can agree with the deployment's opt-out, never make one.

The opt-out is loud. `AuthPlugin` logs one warning at boot naming the posture and the
consequence: anyone can register an address they do not control, and an organization invitation
sent to that address can then be accepted by that account. `getPublicConfig()` reports
`requireEmailVerification: false`, the value actually wired, because the wiring and the
advertisement now read one resolver.

`AuthManager.applyConfigPatch()` takes an optional second argument,
`{ requireEmailVerificationFrom: 'deployment' | 'console' }`. It defaults to `deployment`; the
settings binding passes `console` for a stored value and `deployment` for an env override.
