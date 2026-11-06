---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: the datasource admin door asks the walled-catalog verdict on every row-writing verb, as the /meta door does

Clause-②: no (narrowing) — under the `isolated` and `group` tenancy postures, creating, changing or removing a datasource at the datasource admin routes (`POST /api/v1/datasources`, `PATCH` and `DELETE /api/v1/datasources/:name`, `POST /api/v1/datasources/:name/migrate-credential`) is a write to the environment's metadata catalog, and it is the platform operator's, as every other write to that catalog is.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: which caller the datasource admin routes admit to a datasource write under a walled tenancy posture is all that moves, and every stored datasource stays as it is. -->

**BREAKING** accept-set narrowing at the datasource admin routes (`@objectstack/service-datasource`) under a walled tenancy posture.

- **The rule.** Under `isolated` and `group` every organization shares the environment's metadata catalog, and a write to it is admitted only for the platform operator and for the engine's own writes (ADR-0131 D3, D12 items 7–8, D11). A datasource is a `datasource` item of that catalog, the same record `PUT /api/v1/meta/datasource/:name` writes. So each datasource admin route that writes a datasource record (create, update, remove, migrate-credential) asks the walled-catalog verdict the `/meta` write doors ask (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`) for the type `datasource`, after the `manage_platform_settings` capability gate and before the datasource service is looked up.
- **The answer.** A refused call answers `403 PERMISSION_DENIED` with the verdict's sentence for a `datasource` item, the one the `/meta` write doors answer, naming the posture. Nothing is stored, no secret is sealed or removed, and no pool is rebuilt or evicted.
- **Unchanged.** The platform operator writes datasources under a wall as before. Under `single`, and on a deployment with no `tenancy` service, every caller holding `manage_platform_settings` writes datasources as before. Listing, reading, the driver catalog, both connection tests, the remote-table listing and the object draft are unchanged, and the capability gate answers first, as before.
- **Who moves.** On a walled deployment, a datasource create, update, removal or credential migration by a caller below the platform operator, an organization's `admin_full_access` holder included, is refused; the platform operator performs it.
