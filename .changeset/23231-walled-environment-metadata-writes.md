---
'@objectstack/metadata-core': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
'@objectstack/spec': minor
---

fix(security)!: under a walled posture every environment-metadata write is the platform operator's, whatever its type (ADR-0131 D12 items 7–8, D11)

Clause-②: no (narrowing)

<!-- adr-0087: registered walled-environment-metadata-writes-retired -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes. ADR-0131 D12 item 7: a walled deployment is "one environment, one schema, one catalog … The metadata-authoring capability (`manage_metadata` / `studio.access`) is what headquarters IT holds and plant admins do not." Item 8: a plant "cannot create a position, a permission set, a capability, a template or any metadata … A plant that needs its own catalog is given its own environment." D11: the rules are identical in every posture; only whether the wall is enforced differs.

**Why.** The environment definition ledger carries no organization column, so a write lands for every organization. Measured on booted `isolated` and `group` stacks before this change: an organization owner granted `manage_metadata` inside their own organization created an object, a view and a flow at `/api/v1/meta`, edited, published, rolled back and reset the operator's view, passed all thirteen `/api/v1/packages` write doors, installed, upgraded and uninstalled packages through `install-local`, and created a flow at `/api/v1/automation`, each with `2xx`; another organization's owner read every result. The security catalog was refused at these doors already; every other type was not.

**FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):

- `PUT`, `DELETE`, `POST …/publish` and `POST …/rollback` of `/api/v1/meta/:type/:name` on `@objectstack/rest`, and `PUT /meta/:type/:name` on the runtime dispatcher, for a type outside the security catalog (`object`, `view`, `flow`, `app`, `dashboard`, `translation` and every other type): **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` (the dispatcher answers `403 PERMISSION_DENIED`).
- Every `/api/v1/packages` write on the runtime dispatcher — create, the manifest `PATCH`, enable, disable, publish, publish-drafts, discard-drafts, revert, rollback, `commits/:commitId/revert`, duplicate, adopt-orphans and delete — for a package carrying no position, permission set or capability: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before anything is read or written. The refusal no longer reads the package's items.
- `POST /api/v1/marketplace/install-local` (install and upgrade) and `DELETE /api/v1/marketplace/install-local/:id` (uninstall) on `@objectstack/cloud-connection`, for a package carrying no catalog item: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN`. The refusal's `error.details` no longer carries `catalogItems`; it carries `manifestId`.
- `POST /api/v1/automation`, `PUT /api/v1/automation/:name`, `DELETE /api/v1/automation/:name` and `POST /api/v1/automation/:name/clone`: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before the automation service is touched.
- Every one of these refusals carries one sentence: it names the written type (`a package` at the package doors), the posture and "ADR-0131 D3, D12 items 7–8, D11", and points at an environment of the organization's own. The catalog refusals that shipped before keep their envelopes and now read the same sentence.
- The activation refusals under a wall (`POST /api/v1/automation/:name/toggle`, `POST /api/v1/actions/_activation/…`, `POST /api/v1/security/_activation/permission/…`) no longer recommend cloning a flow or a permission set, or authoring a sibling action, since those writes are the operator's under a wall too; they name the platform operator.

**Unchanged.** Reads. Assignments: `sys_user_position` and `sys_user_permission_set` rows stay organization rows. The platform operator and the engine's own writes (seeders, installers, migrations) write as before. Under `single` (and with no `tenancy` service), a `manage_metadata` holder writes exactly as before. `POST /meta/_migrate-stored` keeps its own `manage_metadata` gate.

**The remedy.** The platform operator authors the environment's metadata, in Studio or through a managed package; an organization that needs metadata of its own is given an environment of its own. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-environment-metadata-writes-retired`. `walledCatalogWriteVerdict` (`@objectstack/metadata-core`) now judges every type alike: a custom door that writes environment metadata asks it after its capability gate, with no `isSecurityCatalogType` pre-filter.
