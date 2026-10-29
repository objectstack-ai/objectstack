---
'@objectstack/runtime': patch
---

feat(runtime): `GET`/`PUT`/`DELETE /api/v1/automation/connectors/credential-refs` — list the connector credentials an environment's connectors name, and set or clear one

Clause-②: yes (widening)
Metadata-protocol: none

Three new routes serve the automation service's connector credential store (#27237). `GET …/credential-refs` lists every `credentialRef` an installed connector names, plus stored references nothing names any more. Each entry has its `status` (`set` / `missing` / `rejected`), its `source` (`env` / `object` / `vault` / null) and the instances naming it, and never a value. `PUT …/credential-refs/:ref` with the closed body `{ "value": "…" }` stores a value, and the instances naming the reference re-materialize without a restart. `DELETE …/credential-refs/:ref` removes it.

All three require the `manage_metadata` capability. Under the `group` and `isolated` tenancy postures they refuse every caller with a 403 that names the posture, because connector credentials are environment-level. They take no query parameters. The service's refusals keep their standard codes: 400 `VALIDATION_ERROR` (an empty value, or one starting with `secret:`), 403 `PERMISSION_DENIED` (the service's own walled refusal), 404 `RESOURCE_NOT_FOUND` for an undeclared reference, 409 `RESOURCE_CONFLICT` for one an environment variable supplies or a first write another replica made at the same moment, and 503 `SERVICE_UNAVAILABLE` with no crypto provider. A mounted service without these optional members answers 501.
