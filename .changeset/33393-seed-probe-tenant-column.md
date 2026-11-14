---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an organization-scoped seed load resolves a reference into an object walled by a declared `tenancy.tenantField` on that column

Clause-②: no
Metadata-protocol: none

A seed reference whose target declares `tenancy: { enabled: true, tenantField: 'workspace_id' }` with the injected `organization_id` column switched off was probed with `organization_id = <load organization>`, a column the target does not have. The driver refused the filter (`INVALID_FILTER`) and the reference was reported unresolved although a row of the load's organization existed. The probe now filters on the target's resolved tenant column (`resolveTenantFieldName`, falling back to `organization_id`), the same column the wall scopes the target by, so the reference resolves to the load organization's row and never to another organization's row of the same name.
