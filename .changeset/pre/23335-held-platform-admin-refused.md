---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth)!: the platform-admin actions refuse a session the ADR-0069 authentication policy holds, a platform administrator's included

Clause-②: no (narrowing: a held session is refused on the platform-admin surface, which ADR-0069 D3 already declares gated)

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at one family of routes plugin-auth mounts directly on the host server, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a session the policy does not hold receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which sessions the family serves: a session whose user carries the ADR-0069 posture (an expired or administrator-forced password, or enforced MFA not yet enrolled) is now refused with the gate's 403 before any of the family's logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only / runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 D3 holds a signed-in user out of every protected resource while their password has expired (or an administrator has forced a change) or while enforced MFA is not yet enrolled, until they remediate. REST and the runtime dispatcher already refuse such a session. The platform-admin actions plugin-auth mounts on the host server (user creation, password, ban, removal, unlock, manager, import, membership, OAuth-client and SSO administration) are judged by one shared judge, `judgePlatformAdmin`, which read the session and the admin rung but never the posture, so a held platform administrator could still administer the platform.

- **Refused now:** a held session meets `403` with the gate's own `code` (`PASSWORD_EXPIRED` or `MFA_REQUIRED`) and `message` on every platform-admin action that judge guards, in the family's declared envelope, before the action runs. The judge asks the shared decision (`evaluateAuthGate`, `@objectstack/core`) without a request path, so these actions never inherit the exemption that keeps the auth endpoints reachable.
- **Order:** an anonymous caller still meets `401 UNAUTHENTICATED` first. A held signed-in caller who is not a platform administrator now meets the posture's `403` code instead of `403 PERMISSION_DENIED`: same status, the remedy named.
- **Unchanged:** a session the policy does not hold is served exactly as before. Sign-in, change-password, two-factor enrollment and sign-out still answer a held session, so remediation works as before.

What changes for you. A platform administrator the policy holds must remediate (change the password, or enroll an authenticator) before the platform-admin actions answer them, as on every other protected route.
