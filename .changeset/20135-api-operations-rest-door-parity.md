---
'@objectstack/core': patch
---

fix(core): the `apiOperations` of `/auth/me/permissions` offers only what the REST door serves — nothing on an object with `enable.apiEnabled: false`, and `export` only where the export door admits it (#20135)

`buildEffectiveObjectPermissions` builds the `objects` slot of `GET /auth/me/permissions` (`@objectstack/plugin-hono-server`) and the map `ISecurityService.getEffectiveObjectPermissions` returns (`@objectstack/plugin-security`). Its last pass, `annotateEffectiveApiOperations`, attaches each entry's `apiOperations`: the operation set a client renders, where an absent annotation means default-allow. That set disagreed with the REST door in two places, both in the direction of offering an operation the door refuses:

- **`enable.apiEnabled: false`.** The door answers `404 OBJECT_API_DISABLED` for every verb on such an object, whatever `apiMethods` says. The annotation ignored the switch. It carried the object's whole closure, or, for a subject whose export stays allowed on an otherwise unrestricted object, no annotation at all, which a client reads as default-allow.
- **The export slot.** It fell back to the merged `'*'` export bit whenever an entry carried no `allowExport` of its own. The merged bit cannot say which set's wildcard reaches which object, so `export` was offered on a private object that only a plain `'*': { allowExport: true }` reached (a plain wildcard never covers a private object), and on an object that the exporting set itself names without the grant. The export door answers both `403 EXPORT_NOT_PERMITTED`.

Clause-②: no

**What changes.** The annotation now asks the door's own two questions, entry by entry:

- the object half is the spec's `canServeApiOperation`, the boolean face of `apiExposureDenialReason`, which `enforceApiAccess` in `@objectstack/rest` turns into its 404 and 405. An object with `enable.apiEnabled: false` is annotated `apiOperations: []`;
- the export half is the entry's own grant as the export door reads it: read and `allowExport`, through the spec's `objectPermissionGrants`. The coverage passes that run first have already put each set's `'*'` on exactly the entries that set reaches, per posture.

The entry of an API-disabled object stays in the map with its grants: `apiEnabled` closes the API, not the data, and `current_user.can()` reads those grants on the server. Which entries carry an annotation keeps its rule: an unrestricted object whose every operation is still served gets none.

**What a reader of `/auth/me/permissions` sees.** An object declaring `enable.apiEnabled: false` now reads `apiOperations: []` in every entry. That includes an unrestricted object whose export stays allowed, which this release's notes for the `apiOperations` annotation otherwise describe as carrying none. `export` leaves the annotation of a private object reached only through a plain wildcard export grant, and of an object named without the grant by the set whose wildcard carries it. A private, unrestricted object that lost its `export` this way is now annotated with its closure minus `export`. Nothing else moves: no entry is added or removed, no `allow*` bit changes, and no annotation gains an operation. The response shape, its keys and the route are unchanged. The REST door is unchanged, so no request changes its answer.

**For a caller of the exported helper.** `annotateEffectiveApiOperations` keeps its signature. It no longer reads the map's `'*'` entry: it reads each entry's own grants, which `buildEffectiveObjectPermissions` puts there. A map composed some other way should be built with `buildEffectiveObjectPermissions`.
