---
'@objectstack/spec': patch
'@objectstack/plugin-auth': patch
---

feat(spec,plugin-auth): the `auth` service publishes `isOrganizationAdministrator(userId, organizationId)`, the one reading of "is this user an administrator in this organization"

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/spec`: `IAuthService.isOrganizationAdministrator?(userId, organizationId)`**, an optional member: true for any of ADR-0090 D12's three kinds of administrator, tenant-level (the `PLATFORM_ADMIN` rung), organization-level (the `TENANT_ADMIN` rung, from an owner or admin membership) and delegated (a permission set carrying an `adminScope`). A delegated grant that cannot be read counts as an administrator. Read-only and in-process; no route reaches it.
- **`@objectstack/plugin-auth`: `AuthManager.isOrganizationAdministrator`** implements it. It is the method the multi-factor requirement's `administrators` level already asked (formerly the package-internal `isMfaAdministrator`, renamed), so a caller outside plugin-auth, such as an access-policy console previewing who that level would hold, gets the gate's own answer, delegated administrators included. Ask it through the service: `ctx.getService<IAuthService>('auth').isOrganizationAdministrator?.(userId, organizationId)`. Nothing the gate decides changes.
