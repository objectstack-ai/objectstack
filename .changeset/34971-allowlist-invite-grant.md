---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an invited sign-up the audience posture's own rule admits receives the declared self-registration permission set

Clause-②: yes (widening)
Metadata-protocol: none

Under the `email_domain` audience posture, a self-serve sign-up whose address is on `allowedEmailDomains` is admitted by its domain, invitation or not; under `open`, every self-serve sign-up is. Such a sign-up now receives the declared `selfRegistrationPermissionSet` whether or not it also holds a pending invitation. Before, a pending invitation addressed to it was read ahead of the posture, and the sign-up was admitted with no self-registration grant, though the membership settle already treated an on-allowlist address as domain-admitted and bound it at creation. The admission verdict and the membership settle now read one classification of "admitted by the posture's rule".

The invitation still places the sign-up as it names: once the address is verified and the invitation accepted, the membership and role the invitation names are written beside the grant.

Unchanged: under `invite_only` an invitation admits with no self-registration grant; under `email_domain` an address off the allowlist that an invitation admitted gets the account and no grant, and is not bound while its address is unverified; operator, bootstrap and SSO-provider creations; a social-provider creation whose address the provider did not verify is still refused under `email_domain`, and under `open` while email verification is in force; an undeclared or unresolvable set still refuses the sign-up.

No authorable key, accepted value or default changes; `selfRegistrationPermissionSet` keeps its meaning, the set each self-registrant receives, and is now applied to the invited sign-ups its posture admits.
