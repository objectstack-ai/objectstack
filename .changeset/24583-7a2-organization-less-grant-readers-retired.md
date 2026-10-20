---
'@objectstack/core': minor
'@objectstack/plugin-security': minor
---

feat(core,plugin-security)!: a grant applies only in its own organization — an organization-less grant row confers nothing, and the Default Organization's `admin_full_access` grant is the only platform-admin anchor

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The data change this relies on is the operator's ownership ceremony, `os migrate organization-ownership`, which an upgraded database must have passed before it boots. -->

**BREAKING** for a stored grant row that carries no `organization_id` (`NULL`, absent or blank), shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D10). After the ownership ceremony no such row exists: it attributes every one to an organization and makes the column NOT NULL, a server refuses a database it did not create or certify, and a fresh install that registers the organization object never writes one. So on a certified or fresh database nothing resolves differently.

- **`resolveUserAuthzGrants` / `resolveAuthzContext` (`@objectstack/core`).** A `sys_user_position` or `sys_user_permission_set` row applies only while its organization is the active one. FROM: a row with no organization was "global" and applied in every resolution, including one with no active organization. TO: it applies nowhere, and a resolution with no active organization gets no stored grant at all.
- **Platform-admin standing.** FROM: under `single`, an organization-less `admin_full_access` grant anchored `platform_admin`, beside the Default Organization's. TO: only the Default Organization's grant anchors it (still in every organization, and with none active). Walled postures are unchanged: standing there comes from `OS_PLATFORM_OWNER_EMAIL` alone.
- **`bootstrapPlatformAdmin` (`@objectstack/plugin-security`).** The existing-admin check reads only the Default Organization's grant. When no Default Organization can be named (a walled posture, or none to name), it reads no grant at all. The walled "no owner email declared" error drops its sentence about a legacy unscoped grant row.
- **The delegated-administration gate.** A held position counts toward self-delegation only when its row belongs to the caller's active organization. An organization-less holding, or a caller with no active organization, holds nothing there, which is what the resolver grants. An organization administrator's removal of an organization-less row is refused as "not one of the organization you administer".
- **What a lean composition sees.** A composition that registers no organization object (`sys_organization`, which plugin-auth ships) still stores grants without an organization, and those grants now confer nothing. No shipped composition does this: `os serve` registers the security plugin only together with plugin-auth.

**What an operator does.** Nothing beyond the upgrade itself: run `os migrate organization-ownership` before serving a database that 17.x or an 18.0 pre-release created. The server refuses such a database until you do. If an embedding composes `@objectstack/plugin-security` without plugin-auth, register the organization object so that grants carry an organization.
