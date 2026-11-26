---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a self-serve social creation is admitted only with a provider-verified address under an address-based posture

Clause-②: no (narrowing: a creation admitted today is refused; owes one CONTRACT_REVIEW_TIER review before the queue)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the audience posture or a social-provider sign-in; `content/docs/permissions/authentication.mdx` and `content/docs/deployment/tenancy-modes.mdx` gain the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answer is an account the admission gate does not create, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment under the `email_domain` audience posture, or under `open` while email verification is in force, where people create their account by signing in through a social provider that reports the address unverified.

- Under `email_domain`, and under `open` while email verification is in force (the default there; only the deployment can declare it off), a new account through a social provider (`socialProviders`) is created only when the provider reports the address verified. Any other is refused `403 SELF_REGISTRATION_CLOSED` at the admission gate, as `invite_only` already refuses it: no account, no session, no membership. A browser sign-in redirects with `error=SELF_REGISTRATION_CLOSED`.
- A pending invitation addressed to that person does not admit the creation either, under both postures: the invitation is matched by the same address.
- The rule is told by the creation class, not by a list of providers, so a social provider added later is covered without being named.

Unchanged: a social provider that reports the address verified, which is admitted and bound as before; identity providers an operator registers (`oidcProviders` entries and SSO providers); accounts an administrator creates, SCIM provisioning and accounts a boot command provisions; the first account of a fresh install; email-and-password, magic-link and email-OTP sign-ups; `open` with the deployment's email verification declared off; and the `invite_only` posture.

What to do: a person refused this way verifies the address with the social provider and signs in again, or, where the deployment offers it, signs up with email and password and completes the verification mail. An invited person can also open the invitation mail's own link, which verifies the address and accepts in one step.
