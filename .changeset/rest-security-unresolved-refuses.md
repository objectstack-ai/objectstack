---
'@objectstack/rest': patch
---

fix(rest): a door whose environment's security service cannot be resolved refuses rather than proceeds

Clause-②: no
Metadata-protocol: none

The REST server's security resolver keeps two answers apart, by the service registry's own "never registered" brand:

- **Not registered** — no `plugin-security`, or a single kernel without a security service — is a deployment with no permission posture (ADR-0106 D6 tier 1). Every door serves it exactly as before.
- **Registered but unresolvable** — a registered security service whose factory throws, or an environment kernel that cannot be acquired at the security step — is an unhealthy security service (ADR-0106 D6 tier 3). The request answers `503 SERVICE_UNAVAILABLE`, the same answer an unreadable authorization input gives everywhere else, and nothing is served.

The doors that ask this resolver: the data export; the import template, at its gate and at its column projection; every object-schema read under `/meta` while object-schema masking is on (the default); the record field-access door; and the record page, whose field-access part carries the `503` as its own part refusal and whose access-explanation part answers the page with it. On a multi-environment host, an operator who sees this `503` for one environment restores that environment's security service; the other environments are unaffected.
