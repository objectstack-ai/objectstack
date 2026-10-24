---
'@objectstack/objectql': patch
---

fix(objectql): the engine declares the organization wall's exemption to the driver, so an exempt platform admin's predicate write is not told to declare an option it cannot set

Clause-②: no
Metadata-protocol: none

Under a walled posture an exempt platform admin's predicate update or delete reaches the driver with no `tenantId`, because the wall lifted the scope on purpose (ADR-0131 D8). The SQL driver's `[tenant-audit]` line then told the caller to declare `bypassTenantAudit: true`, an option no REST caller can set.

The engine now fills in `bypassTenantAudit: true` on the driver options when the Layer 0 verdict the security layer recorded for the operation is `none` and the same decision without the exemption would have walled it. It does not fill it in when no verdict was recorded (a by-id write, a system context, no security layer), under the `single` posture, for an insert, for an object outside the tenant machinery, or when the caller supplied its own value.

Diagnostics only: the driver's scope was already the recorded verdict's, and the option only silences the warning.
