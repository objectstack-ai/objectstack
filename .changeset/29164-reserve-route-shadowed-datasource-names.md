---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: creating a runtime datasource refuses `drivers`, the name the driver-catalog route answers, so a datasource is never created that its edit form cannot load (#29164)

Clause-②: no (narrowing) — `POST /api/v1/datasources` with `name: 'drivers'`, which answered 201 before, now answers 400 `DATASOURCE_ADMIN_ERROR` naming the reserved name. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, export or stored shape changes: the runtime datasource-admin create door refuses one more name, the way it already refused `default`. A stored row of that name is not rewritten or refused, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the datasource-admin create door (`@objectstack/service-datasource`).

- **Before.** `GET /api/v1/datasources/drivers` is the driver catalog, mounted ahead of `GET /api/v1/datasources/:name`. A runtime datasource named `drivers` was created and listed, but its detail read always answered the catalog, so Setup → Datasources could never open its edit form.
- **Now.** Create refuses every literal path segment the admin routes mount beside a same-method `/datasources/:name` route; today that is `drivers` alone. The refusal is the same 400 `DATASOURCE_ADMIN_ERROR` that `default` already answers. `test` stays creatable: `POST /datasources/test` (the unsaved-draft probe) sits beside no `POST /datasources/:name`, so a datasource named `test` keeps every by-name door.
- **Stored rows.** A `drivers` row created before this release is not refused or rewritten. It stays listed, patchable, removable and probe-able by name; its detail read still answers the catalog.

**The remedy.** Create the datasource under another name. For a stored `drivers` row, create the same connection under another name, move the objects bound to `drivers` onto it, then remove `drivers` (`DELETE /api/v1/datasources/drivers`, which refuses while any object is still bound).
