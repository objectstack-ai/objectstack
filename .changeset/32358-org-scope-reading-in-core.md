---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/service-automation': patch
---

refactor(core, plugin-security): the external organization-scope reading lives in `@objectstack/core`, so `@objectstack/service-automation` no longer loads `@objectstack/plugin-security` at run time

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/core` now exports the one reading of the organization scope an external object states (ADR-0015 §10): `externalOrganizationScopeOf`, its Layer 0 projection `externalOrganizationScopeIsUndeclared`, `declaredForeignTenantField`, the provenance test it composes `hasPhantomTenantAnchor`, the `ExternalOrganizationScope` type, and the three-ways-out sentence `EXTERNAL_SCOPE_REMEDY`. The code moved unchanged; every answer and every sentence is the same.

`@objectstack/plugin-security` keeps exporting the same names from its package entry and from the same module paths. They are now re-exports of the core bindings, so an importer of either package gets the same function. Nothing to change in your code.

`@objectstack/service-automation`'s sync-in pull imports the reading from `@objectstack/core`, and `@objectstack/plugin-security` moves back to its dev dependencies. Installing the automation service no longer installs the security plugin package.
