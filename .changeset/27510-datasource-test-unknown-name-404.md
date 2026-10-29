---
'@objectstack/service-datasource': patch
---

fix(service-datasource): `POST /api/v1/datasources/:name/test` answers a name that resolves no saved datasource `404 RESOURCE_NOT_FOUND`, as the other by-name doors do

Clause-②: no
Metadata-protocol: none

Testing a saved datasource by a name that no saved datasource has used to answer `200` with `{ ok: false, error: "[ObjectQL] Datasource '…' has no registered driver to introspect." }`. That is the answer a saved datasource that is down gets, so an admin tool or script could not tell "this datasource is down" from "this datasource does not exist", while `GET`, `PATCH` and `DELETE /api/v1/datasources/:name` already answered the same name `404`.

- **Unknown name.** The Test door now answers `404` with `error.code` `RESOURCE_NOT_FOUND` and the message `GET /api/v1/datasources/:name` gives for the same name. Nothing is probed.
- **A saved datasource that fails its probe** still answers `200 { ok: false, error }`, unchanged.
- **The platform's primary datasource (`default`)** is still tested through its live driver, whether or not a datasource record is stored for it.

`ExternalDatasourceService.testConnection(name)` now throws that `404` error for an unknown name instead of returning `{ ok: false }`. Every other outcome is still returned, never thrown.
