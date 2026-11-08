---
'@objectstack/rest': patch
---

fix(rest): a door whose environment's security service cannot be resolved refuses rather than proceeds

Clause-②: no
Metadata-protocol: none

The REST server's security resolver keeps two answers apart, by the service registry's own "never registered" brand:

- **Not registered** — no `plugin-security`, or a single kernel without a security service — is a deployment with no permission posture (ADR-0106 D6 tier 1). Every door answers it exactly as before, the `/security` doors' `501 NOT_IMPLEMENTED` included.
- **Registered but unresolvable** — a registered security service whose factory throws, or an environment kernel that cannot be acquired at the security step — is an unhealthy security service (ADR-0106 D6 tier 3). The request answers `503 SERVICE_UNAVAILABLE`, the same answer an unreadable authorization input gives everywhere else, and nothing is served.

These doors ask this resolver:

- the data export; the import template, at its gate and at its column projection; every object-schema read under `/meta` while object-schema masking is on (the default); and the record field-access door — each answers the `503`;
- the record page, whose access-explanation and field-access parts each carry the `503` as their own part refusal, while the page still answers with the record and every other part;
- the `/security` doors — the access explanation, the caller's delegable scope, a user's effective access, and the suggested audience bindings with their confirm, dismiss and reopen — each answers the `503` in its family's nested envelope. A caller context whose authorization store cannot be read answers the same `503` at these doors.

On a multi-environment host, an operator who sees this `503` for one environment restores that environment's security service; the other environments are unaffected.
