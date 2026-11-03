---
'@objectstack/spec': patch
---

docs(spec): the tenancy-posture docblocks name `@objectstack/organizations` as open code and the licence as the commercial entitlement

Clause-②: no
Metadata-protocol: none

The file header and the docblocks in `packages/spec/src/security/tenancy-posture.ts` still called the `@objectstack/organizations` runtime "enterprise", although it ships from this repository under Apache-2.0 since ADR-0132 D1. They now name the package without that adjective, and say "commercial entitlement" where they mean the licence gate that the commercial package of the same name adds by subclassing the open one (ADR-0132 D2, D3). What stays true is unchanged: a walled posture (`group` or `isolated`) still needs that runtime mounted to activate (ADR-0093 D5). Comment-only: no schema, type or runtime behaviour changes.
