---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: `POST /api/v1/datasources/:name/test` refuses a name that no saved datasource has with `404 RESOURCE_NOT_FOUND`, as the other by-name doors do, instead of answering `200 { ok: false }`

Clause-②: no (narrowing) — `POST /api/v1/datasources/:name/test` and the in-process `ExternalDatasourceService.testConnection(name)` refuse a name that resolves no saved datasource with `404 RESOURCE_NOT_FOUND`, which they answered `200 { ok: false }` before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the Test door's request and its { ok, latencyMs, tableCount, error } answer keep their shape, and a name that resolves no saved datasource is now refused instead of answered. A failed probe of a datasource that does not exist had no meaning to keep, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the saved-datasource Test door (`@objectstack/service-datasource`), served at `POST /api/v1/datasources/:name/test`.

- **Before.** Testing a saved datasource by a name that no saved datasource has (a typo, a removed datasource, a name from another deployment) was answered `200` with `{ ok: false, error: "[ObjectQL] Datasource '…' has no registered driver to introspect." }`. That is the answer a saved datasource that is down gets, so an admin tool or script could not tell "this datasource is down" from "this datasource does not exist". `GET`, `PATCH` and `DELETE /api/v1/datasources/:name` already answered the same name `404`.
- **Now.** That request is refused `404` with `error.code` `RESOURCE_NOT_FOUND` and the message `GET /api/v1/datasources/:name` gives for the same name. Nothing is probed. The name is resolved through the same stored-record read the sibling by-name doors make. In process, `ExternalDatasourceService.testConnection(name)` throws that `404` error instead of returning `{ ok: false }`.
- **Unchanged.** A saved datasource that fails its probe still answers `200 { ok: false, error }`, and one that is up still answers `200 { ok: true, … }`. The platform's primary datasource (`default`) is still tested through its live driver, whether or not a datasource record is stored for it. Every other outcome of `testConnection` is still returned, never thrown.
- **Who sees it.** A caller holding the platform-settings capability who tests a name that no saved datasource has.

**The remedy.** None needed: pick the datasource from `GET /api/v1/datasources`, or check the name. A script that read `ok: false` as "does not exist" now reads `404`.
