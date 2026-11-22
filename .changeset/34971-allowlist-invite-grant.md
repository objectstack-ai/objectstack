---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

fix(plugin-auth)!: an invited sign-up the audience posture's own rule admits receives the declared self-registration permission set, and is refused when that set cannot be resolved

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the audience posture's invitation sign-up or `selfRegistrationPermissionSet`; `content/docs/deployment/self-hosting.mdx` gains the rule in this change.

<!-- adr-0087: registered self-registration-permission-set-reaches-invited-sign-ups -->

**BREAKING** for a deployment under the `open` audience posture, or under `email_domain` for an address on `allowedEmailDomains`, whose declared `selfRegistrationPermissionSet` cannot be resolved (no such set, or the set is switched off) and that relies on an invited person still being able to sign up.

- Under `open`, and under `email_domain` for an address on the allowlist, a self-serve sign-up is admitted by the posture's own rule, invitation or not. It now receives the declared `selfRegistrationPermissionSet` whether or not it also holds a pending invitation. Before, a pending invitation addressed to it was read ahead of the posture in `decideAudienceAdmission` (`audience-posture.ts`), and the sign-up was admitted with no self-registration grant, though the membership settle already treated it as admitted by the posture and bound it at creation. The verdict and the settle now read one classification, the module-private `isAdmittedByPostureRule`.
- When the declared set cannot be resolved, such an invited sign-up is now refused `403 AUTH_CONFIG_ERROR`, naming the set, as an uninvited one already was. No account is created. Before, the invitation admitted it without the set.
- The invitation still places the sign-up as it names: once the address is verified and the invitation accepted, the membership and role it names are written beside the grant.

Unchanged: under `invite_only` an invitation admits with no self-registration grant; under `email_domain` an address off the allowlist that an invitation admitted gets the account and no grant, and is not bound while its address is unverified, whatever state the declared set is in; operator, bootstrap and SSO-provider creations; a social-provider creation whose address the provider did not verify is still refused under `email_domain`, and under `open` while email verification is in force; `admin_full_access` is still refused as the self-registration set.

No authorable key, accepted value or default changes; `selfRegistrationPermissionSet` keeps its meaning, the set each self-registrant receives, and now reaches the invited sign-ups its posture admits.

What to do: keep `selfRegistrationPermissionSet` naming a permission set that exists and is switched on. A person refused this way signs up again once an administrator has corrected the setting or switched the set on, or an administrator creates the account directly. An invitation can expire while the set is broken; send it again after the fix.
