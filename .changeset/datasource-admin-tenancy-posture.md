---
'@objectstack/service-datasource': patch
---

The datasource admin routes derive the tenancy posture before resolving the caller

`requireDatasourceAdmin` resolved the request with `resolveAuthzContext({ ql, headers, getSession })` and supplied no `tenancyPosture`. Both posture-conditional API-key refusals are gated on the caller supplying one — `organization_required` and `organization_membership_ended` — so neither ran on this family, and an API key stamped with an organization its owner had left was admitted; the routes then gated it on `authz.systemPermissions` alone. Because this family gates on system capabilities rather than on organization-scoped rows, the consequence was an admitted principal rather than a cross-organization row read.

The posture is now read off the kernel's `tenancy` service and classified rather than swallowed: a service that was never registered stays quiet (`undefined` — the supported no-tenancy composition, unchanged behaviour), while one that was registered and failed to build raises `AuthzStoreUnavailableError` instead of degrading to "no posture". Patch rather than minor: no accept set widens, and a declared guard returns to enforced.
