---
'@objectstack/skills': patch
---

docs(skills): objectstack-data's datasources rule states the organization scope an external object declares under a walled tenancy posture

Clause-②: no
Metadata-protocol: none

- **Before.** The datasources rule taught `external` bindings, `columnMap`, auto-connect and credentials, and said nothing about what an external object's rows are to the organizations of a walled deployment.
- **Now.** One bullet under *Federated (external) objects*: under `OS_TENANCY_POSTURE` `isolated`/`group` every external object states its organization scope — its own `organization_id` field (or `columnMap` onto it), `tenancy: { enabled: false }` (shared), or `systemFields: { tenant: false }`; none refuses the boot by name, and `tenancy.tenantField` is refused there too. Paid within the file's token ceiling (910 → 908 of 911) by trimming the auto-connect footnote, the managed-datasource sentence and the credentials paragraph; no ceiling moves.
