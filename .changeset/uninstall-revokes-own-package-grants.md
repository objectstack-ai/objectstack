---
'@objectstack/plugin-security': patch
'@objectstack/metadata-protocol': patch
---

fix(plugin-security): uninstalling a package revokes only the permission-set grants bound to that package

Clause-②: yes (widening) — an uninstall's `cleanups` outcome may now carry `reportedGrants`; with one holder of a name every uninstall answers as before.
Metadata-protocol: none

Uninstalling a package revokes the grants (`sys_user_permission_set`) that name a permission set it declared. Until now it revoked every grant of that name. Once two packages may each hold a permission set of the same name (ADR-0150 D3/D4), that would also revoke users' grants of the other package's set, which that package still holds. The uninstall cleanup now reads each grant's `permission_set_package` column:

- **Bound to the uninstalled package:** revoked, as before.
- **Bound to another package:** left alone. That package still holds its set, and the grant is its user's access to it.
- **Empty column:** revoked in every case. When the uninstalled package was the name's only holder, nothing else changes. When another holder still serves the name after the uninstall, the grant never said which holder it meant, so it is revoked rather than handed to the remaining holder, and it is reported. One warning per uninstall names each such grant's user, organization and set. The uninstall's answer also lists it under the `security.package-permissions` cleanup as `reportedGrants` (`{ user, organization, permission_set }`), so the operator can grant it again with the package named.

`UninstallCleanupOutcome` and the `UninstallCleanup` result in `@objectstack/metadata-protocol` gain the optional `reportedGrants` member. `runUninstallCleanups` copies it onto the outcome when a cleanup reports at least one grant, so both uninstall doors (`deletePackage` and install-local's `DELETE /api/v1/marketplace/install-local/:manifestId`) answer it. Today no installation can hold a name twice, because install still refuses a second holder, so every answer is unchanged until that narrowing lands.
