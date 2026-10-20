---
'@objectstack/service-datasource': minor
---

fix(service-datasource): Setup → Datasources: Test answers truthfully for the platform's primary datasource and for drivers that cannot introspect, and Sync on the primary datasource refuses with the true reason

Clause-②: yes (widening: the published `ExternalDatasourceServiceConfig`, exported from the package entry, gains one optional member, the `liveDriver` callback; no status code, error code or accepted value moves on any route, and Test's answer keeps its existing keys)

- **What was wrong.** The Datasources page listed the primary datasource (`default`) as connected, which is true. Its Test then answered `200 { ok: false }` and Sync answered `400`, both saying the datasource "has no registered driver to introspect". The primary datasource's driver is registered under the driver's own name, not under `default`, and both doors looked it up by `default`. A connected `memory` datasource also got `ok: false` from Test, because Test was an introspection round trip and that driver cannot introspect.
- **Test, `POST /api/v1/datasources/:name/test`.** For the primary datasource, Test now finds the live driver the way the connection service's own teardown does and answers its health check: `{ ok: true, latencyMs }`. It does not list the platform database's tables. For a driver with no schema introspection (`memory`, `mongodb`), Test answers the health check too, `{ ok: true, latencyMs }` with no `tableCount`, instead of `ok: false`. A driver that fails its health check answers `ok: false`. Every other datasource is tested exactly as before (an introspection round trip with `tableCount`), and so is a datasource with no live driver.
- **Sync on the primary datasource.** `GET …/remote-tables`, `POST …/object-draft`, the import (`POST …/external/tables/:remote/import`) and the catalog refresh still refuse `default`, with the same status and code as before (`400 EXTERNAL_DATASOURCE_ERROR`, or `EXTERNAL_IMPORT_ERROR` on the import). The message now gives the true reason: the primary datasource is the platform's managed storage, not a federation source, so there are no remote tables to list, draft or import from it. Its tables are never introspected.
- **Unchanged.** Sync on every other datasource, including a managed runtime one, answers exactly as before.
- **New, optional: `ExternalDatasourceServiceConfig.liveDriver`.** `(datasource) => driver | undefined` returns the live driver registered for a datasource, resolved by the primary datasource's naming rule. `ExternalDatasourceServicePlugin` wires it. Test reads it to reach the primary datasource and drivers without schema introspection.

What to do: nothing, if the plugin builds the service. If you build `ExternalDatasourceService` yourself, pass `liveDriver` to get the new Test answers; without it, Test stays the introspection round trip, as before.
