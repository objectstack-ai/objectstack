---
'@objectstack/plugin-auth': patch
---

refactor(plugin-auth): the SCIM connection-id cap is derived from the exported service-principal prefix

Clause-②: no
Metadata-protocol: none

`POST /api/v1/auth/admin/scim/mint-credential` refuses a `connectionId` longer than 246 characters so the connection's audit actor `svc:scim:CONNECTION_ID` fits the 255 characters of `sys_audit_log.actor`. That cap was computed from the prefix spelled out a second time; it now reads the length of `SCIM_SERVICE_PRINCIPAL_PREFIX`, the constant the actor label itself is built from, so the two can no longer drift apart. Nothing a caller sees changes: the cap is still 246, and the refusal is still `400 INVALID_REQUEST`.
