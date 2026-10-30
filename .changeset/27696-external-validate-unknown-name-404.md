---
'@objectstack/service-datasource': patch
---

fix(service-datasource): `POST /api/v1/datasources/:name/external/validate` answers a name no saved datasource has `404 RESOURCE_NOT_FOUND`, as `GET /datasources/:name` and the other federation doors do

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, accepted value, stored row, stored shape or export moves. What narrows is one HTTP answer: a validate request for a datasource name that does not exist now gets the 404 the sibling by-name doors already give it, instead of an empty 200 report. There is no metadata for `objectstack migrate meta` to rewrite and nothing to tombstone; the fix for a caller is to stop addressing a datasource that does not exist. -->

`ExternalDatasourceService.validateDatasource(name)` selected the federated objects bound to `name` and validated them. For a name with no saved datasource it selected nothing and returned an empty, vacuously `ok` report, so the validate door answered `200 { ok: true, results: [] }` and a caller could not tell "nothing on this datasource is federated" from "this datasource does not exist".

It now checks that the datasource exists first, the check `testConnection` makes (#27510): a name that resolves no saved datasource throws the package's one `datasourceNotFoundError` (`404`, `RESOURCE_NOT_FOUND`, `Datasource "NAME" does not exist.`) before anything is listed or introspected, and the REST route relays it as such. Only existence is asked, not the full federation guard: a saved datasource with nothing federated, a managed one included, and the platform's primary datasource (not looked up, as it may have no stored record) keep their `200` empty report.

**Side effect.** The runtime's background drift check (`external.validation.checkIntervalMs`) also calls `validateDatasource`. For a datasource that was deleted after its timer was armed, a tick now lands in the check's existing catch (one `warn`, "drift check could not be performed", no events) where it used to return an empty report silently.

**BREAKING** for a caller of `POST /api/v1/datasources/:name/external/validate`, or of `validateDatasource`, that addresses a datasource name that does not exist.

- **Before.** `200` with `{ ok: true, results: [] }`; `validateDatasource` resolved to `{ ok: true, results: [] }`.
- **Now.** `404 RESOURCE_NOT_FOUND`; `validateDatasource` rejects with that error.
- **Fix.** Address a saved datasource, or treat the `404` as "no such datasource".
