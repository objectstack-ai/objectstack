---
'@objectstack/metadata-core': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/plugin-security': minor
'@objectstack/spec': minor
---

Under a walled posture the security catalog is the platform operator's: tenants are refused creating, changing or deleting positions, permission sets and capabilities, and may only assign them

Clause-②: yes (narrowing)

<!-- adr-0087: registered walled-catalog-tenant-writes-retired -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3: "Shared-DB multi-tenant (`group` / `isolated`): tenant admins cannot create or edit catalog items; the operator defines the catalog for every tenant … Creation through Setup or the API is refused with a message naming the posture and the capability.").

**Why.** The catalog is environment-level, and every organization resolves it by name. Measured on a booted `isolated` and `group` stack: an organization owner granted `manage_metadata` inside their own organization saved `PUT /meta/permission/:name` over a permission set another organization's member holds, and that member's next resolution carried the change. One organization's write changed what another organization's members resolve.

**FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):

- `PUT /meta/:type/:name`, `DELETE /meta/:type/:name`, `POST /meta/:type/:name/publish` and `POST /meta/:type/:name/rollback` on `@objectstack/rest`, and `PUT /meta/:type/:name` on the runtime dispatcher, for `position` or `permission`: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` (the dispatcher's `PUT` answers `403 PERMISSION_DENIED`). The message names the posture and the capability.
- The same doors for `capability`: admitted where they were admitted. `capability` is a code-only type, so these doors already refused its writes before this change; only the sentence the caller reads changes, to the posture refusal. For `capability`, the accept set narrows at the data door on `sys_capability`, below.
- `POST /security/permission-sets/:name/clone` (the permission-set clone door): **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before the source is read.
- A data-door insert, update or delete on `sys_position`, `sys_permission_set` or `sys_capability`: **FROM** admitted to any caller whose grants admit the table (a `sys_permission_set` create landed in the environment ledger; a `sys_position` create landed as an organization row with no definition) **TO** `403 PERMISSION_DENIED`, before anything is written. This includes an ADR-0090 D12 delegate whose `adminScope` carries `authorEnvironmentSets`: under a wall it can no longer author environment permission sets at the data door. Its assignment and binding paths are untouched.

**Unchanged.** Assignments: `sys_user_position` and `sys_user_permission_set` rows stay organization rows that an organization's administrators write for their own members. The platform operator and the engine's own writes (seeders, installers, migrations) write the catalog as before. Every other metadata type is untouched. Under `single` (and with no `tenancy` service), catalog writes stay with `manage_metadata` holders, exactly as before. The catalog activation door already required the platform operator under a wall.

**The remedy.** A tenant that needs a position or permission set asks the platform operator to define it in Studio, or through a managed package. The tenant's administrators then assign it to their members. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-catalog-tenant-writes-retired`. `@objectstack/metadata-core` exports the one predicate every door asks, `walledCatalogWriteVerdict`, beside `isSecurityCatalogType`, `SECURITY_CATALOG_TYPES` and `PLATFORM_OPERATOR_POSTURE`. A custom door that writes catalog items asks it after `metaWriteCapabilityVerdict`.
