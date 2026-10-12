---
'@objectstack/cloud-connection': minor
'@objectstack/runtime': minor
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

Under a walled posture a package that carries security catalog items is the platform operator's: tenants are refused installing, upgrading, uninstalling or deleting it

Clause-②: yes (narrowing)

<!-- adr-0087: registered walled-catalog-package-writes-retired -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3: "Shared-DB multi-tenant (`group` / `isolated`): tenant admins cannot create or edit catalog items; the operator defines the catalog for every tenant (managed packages, Studio).").

**Why.** A package registers its positions, permission sets and capabilities environment-wide, and every organization resolves them by name. Measured on a booted `isolated` and `group` stack, with an organization owner granted `manage_metadata` inside their own organization (never the platform operator):
- the owner re-installed an operator-installed package at a new version through `install-local`, adding `manage_users` to a permission set another organization's member holds, and that member's next resolution carried `manage_users`;
- the owner's `install-local` uninstall of that package took the set away from that member;
- the owner's `DELETE /api/v1/packages/:id` of a runtime package the operator had saved a permission set into did the same.

The existing name-conflict refusal stops only a package that shadows a name another holder has, never a write by the package that holds it.

**FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):

- `POST /api/v1/marketplace/install-local` (`@objectstack/cloud-connection`) of a package whose incoming version declares a position, permission set or capability, or, on an upgrade, whose installed version does: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN`, before the package is registered or the ledger written. The whole package is refused, since a package installs whole. The message names the posture, and `error.details.catalogItems` lists the items.
- `DELETE /api/v1/marketplace/install-local/:id` of a package whose installed version declares one: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN`, before the ledger is touched.
- `DELETE /api/v1/packages/:id` on the runtime dispatcher, of a writable package holding stored positions or permission sets: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before anything is deleted.

**Unchanged.** A package with no catalog item installs, upgrades and uninstalls as before, for the same callers. The platform operator does all of the above as before. Under `single` (and with no `tenancy` service) nothing changes. Disabling a package is unchanged: it was measured not to change what any organization resolves.

**The remedy.** The platform operator installs, upgrades and removes catalog-carrying packages. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-catalog-package-writes-retired`. Both doors ask the one predicate the catalog's other write doors ask, `walledCatalogWriteVerdict` (`@objectstack/metadata-core`), once per catalog type the package declares. `@objectstack/objectql` now exports `declaredSecurityCatalogNames`, the engine's own reading of what a manifest declares, so a package door judges the declarations the engine registers.
