---
'@objectstack/service-datasource': patch
---

Ledger the mounted datasource-admin routes, at the spelling they are mounted under.

The ten admin CRUD routes under `/api/v1/datasources` — list, read, create, patch,
remove, connection probe, driver catalog and schema introspection — carried no
route-ledger entry in any of the three ledgers the platform keeps. They are mounted
the "third way" `service-storage` and `service-i18n` grew their own ledgers for:
`objectstack serve` builds a small plugin that resolves the `http.server` service and
registers straight on `IHttpServer`, so neither `RouteManager` nor
`RestServer.getRoutes()` ever sees them.

The five `datasources` rows the REST ledger does carry are the **federation** family
(`/api/v1/datasources/:name/external/…`), which is a different, separately mounted
family in `@objectstack/rest` — not the admin family misspelled. Both are live, and
no route is renamed here: the new ledger is written at the live admin spelling, and
its conformance guard derives what it expects from the registrar rather than from a
literal in the test, so an eleventh route fails the guard instead of silently
reopening the gap.

No runtime behaviour changes — this adds a package-internal ledger and its guard.
