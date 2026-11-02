---
'@objectstack/spec': patch
---

Clause-②: no
Metadata-protocol: none

`postureStampsOrganization`'s docblock no longer says the open engine does not stamp `organization_id`. It now names the open stampers (`ObjectQL#driverWriteTarget` lands an insert in the caller's active organization, `SqlDriver#injectTenantOnInsert` fills an absent `organization_id`) and keeps the true half: activating a walled posture needs the enterprise `@objectstack/organizations` runtime (ADR-0105 D12). Comment only; no behaviour change.
