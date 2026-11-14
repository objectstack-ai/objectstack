---
'@objectstack/objectql': patch
---

fix(objectql): an upgrade or re-install of a package withdraws the items its new version no longer ships, so their names are free at once (#33050)

Clause-②: no
Metadata-protocol: none

A package body re-registered under an installed id — `POST /api/v1/marketplace/install-local` re-installing or upgrading a package, or any other caller of the engine's `registerApp` / the `manifest` service — now replaces what that package ships instead of adding to it. Once the new body has registered, the registry withdraws the item slots the previous body registration wrote that this one did not write again (a dropped tool, flow, page, app, permission set, …), and releases the bare-name and security catalog claims the new manifest no longer declares. Before, a dropped item stayed registered and served until the next restart, and it kept its name: another package declaring that name was refused `422 PLUGIN_REGISTER_FAILED`, "already held by" the package that had dropped it.

What is withdrawn is exactly what the previous BODY registration wrote under the package's id: an environment overlay in the bare slot (ADR-0005), an item registered under the id outside a body, and the hook binder's function claims are left as they are, and a first registration withdraws nothing. The withdrawal runs inside the same restore-on-refusal run as the registration, so a refused upgrade still leaves the installed version serving whole, its items back in the order they stood. Objects and object extensions are not items and are not changed by this.

`SchemaRegistry.replacingPackageBody(packageId, manifest, register)` is the new verb `registerApp` runs its body registration through.
