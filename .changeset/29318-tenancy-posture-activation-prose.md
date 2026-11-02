---
'@objectstack/spec': patch
---

docs(spec): the tenancy-posture docblocks say which side of the open/commercial split each activation sentence describes

Clause-②: no
Metadata-protocol: none

Comment-only. The header of `@objectstack/spec`'s tenancy-posture module and the `postureStampsOrganization` docblock said "open code does not mean free activation" without saying where, which read as if a multi-organization posture were licence-gated everywhere. It is not: on an open install `@objectstack/organizations` ships under Apache-2.0 with no licence check and entitles both walled postures by construction (ADR-0132 D1, D2, D4), so mounting it is enough. Only on a commercial host, where the package of the same name subclasses the open one and adds its licence gate (ADR-0132 D2, D3), does activation need an entitlement. The cloud ADR-0016 iron-rule paragraph no longer says the guarantee comes from not "giving the posture away": the guarantee is that a multi-organization shape never runs unwalled (ADR-0093 D5), on either side of the split. No schema, type, export or runtime behaviour changes.
