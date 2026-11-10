---
'@objectstack/objectql': minor
'@objectstack/runtime': minor
'@objectstack/metadata-protocol': minor
---

feat(objectql, runtime)!: object-less action names are held per namespace, and a call that names no package is refused when two holders answer it (ADR-0150 child B, #31697)

Clause-②: yes (narrowing) — a call that names no package is refused `409 RESOURCE_CONFLICT`, naming every holder, where it ran one of them before: the engine's `executeAction` when two code owners (two packages, or a package beside host code or a plugin) register a handler under one object and name; the bare `POST /actions/:object/:action` and the MCP bare `run_action` when two packages declare one action on one object, or a package's declaration stands beside an owner-less one the environment's store does not hold; `GET /meta/action/NAME` when two packages hold an object-less action of the name. Measured first-party: 0 (showcase, crm and multi-package booted: no object and name two holders answer, no owner-less declaration). The install side widens: two packages of two namespaces may each declare one object-less action name.
Metadata-protocol: added

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type an author writes changes. The refusal names each holder's package-qualified address (`/actions/:ns/...`, `run_action{namespace}`, `?package=`), which is the fix, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that names no package while two holders answer the name. Each such call is now refused `409 RESOURCE_CONFLICT` with a sentence naming every holder; nothing picks one by registration or listing order:

- `ObjectQL.executeAction(object, name, ctx)` with no `packageId`, while two code owners hold a handler under `object:name`: two packages' `app:<id>` handlers, or a package's beside host code (registered with no owner) or a plugin's. A handler the environment's authored-action resync registers (`metadata-service`) is never a second owner. Before, the last registration ran.
- `POST /api/v1/actions/:object/:action[/:recordId]` (no namespace) and the MCP `run_action` with no `namespace`, while two packages declare the action on one object, or a package's declaration stands beside an owner-less one. Before, the object's own declaration answered.
- `GET /api/v1/meta/action/NAME` with no `?package=`, while two packages hold an object-less action of the name. Before, the first registered was served. A read of an action bound to an object is unchanged.

The fix is the address that names the holder: `POST /api/v1/actions/:namespace/:object/:action`, `run_action` with `namespace`, `GET /api/v1/meta/action/NAME?package=<id>`, or `executeAction(object, name, ctx, { packageId })`. Renaming one of the two actions also works.

An owner-less declaration is the environment's only when the environment's own store holds it (an active `sys_metadata` row bound to no package); then it answers first, as before (ADR-0150 D3). Any other owner-less declaration is code the host or a plugin registered with no package: alone it answers; beside a package's it is refused, naming the package and the platform. The row's source decides, never a value in its definition.

The widening: the object-less `action` joins `NAMESPACE_SCOPED_BARE_NAME_TYPES` (ADR-0150 D2/D9). Two packages of two namespaces may each declare one object-less action name; the package door, the item seam and the cold boot accept the second, and the cold boot no longer warns about it. A co-owner of one namespace, a package with no namespace, two packages of `base`, `system` or `sys`, and a built-in name are refused as before. An action bound to an object was never covered and is unchanged.
