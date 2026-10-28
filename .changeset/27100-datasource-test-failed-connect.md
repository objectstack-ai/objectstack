---
'@objectstack/service-datasource': patch
---

fix(service-datasource): Test on a saved datasource whose connect failed answers that connect failure, not "no registered driver"

Clause-②: no — no accepted input changes and no request that was served is refused; `POST /api/v1/datasources/NAME/test` keeps its `200 { ok: false, error }` answer, and only the `error` text changes, for a datasource whose last connect failed.
Metadata-protocol: none

A Postgres datasource created with a wrong host or password answers `status: 'error'` with the connect failure in `statusReason`. Pressing Test then said `Datasource 'NAME' has no registered driver to introspect.`: true of the engine (a failed connect registers no driver), and pointing the admin at installing a driver that is installed. Test now answers the datasource's retained connect verdict, the same `reason` the create answer and the admin list serve as `statusReason`, when the datasource has no live driver and its last connect failed.

- One message: Test reads `getConnectionState` on the shared `datasource-connection` service, the store `statusReason` already reads. It builds no second failure text.
- Test still does not re-attempt the connect. An edit rebuilds the pool and replaces the verdict: a rebuild that fails again is answered with its own fresh reason, and one that connects is tested through its live driver.
- Unchanged: a datasource with no connect verdict and no driver keeps the driver-missing sentence; a connected datasource, the primary datasource, and a datasource whose failed rebuild kept its old pool serving are probed through their live driver as before; a blocked (policy-refused) verdict keeps the engine's answer.
- `ExternalDatasourceServiceConfig` gains an optional `connectionState` reader; a host that does not wire it keeps the old answer.
