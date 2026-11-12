---
'@objectstack/lint': patch
---

fix(lint): `capability-reference-unknown` reads providers over the artifact being built, so a grant in a sibling package no longer warns

Clause-②: no
Metadata-protocol: none

`os build`, `os validate` and `os lint` run the author-time rules once per package of a multi-package artifact. In that pass `validateCapabilityReferences` read capability providers (`defineCapability` declarations and permission-set `systemPermissions` grants) from the package being judged only. An app in one package with `requiredPermissions: ['crm_marketing_app']`, granted by a permission set in another package of the same artifact, got the warning "no built-in, `defineCapability` or `systemPermissions` grant provides, so this gate fails closed". That was false: at run time a caller holds the grants of every permission set it holds, whichever package declared the set, so the gate admits the holder.

The rule now also reads `capabilities` and `permissions[].systemPermissions` from every package in the artifact's `packages[]`. Nothing else changes. The rule still judges only the references of the stack it is given. A capability that no package of the artifact provides still warns, with the same message. Capabilities declared by packages installed from other artifacts are still invisible to the lint, so the rule remains a warning.
