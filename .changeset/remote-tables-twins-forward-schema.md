---
"@objectstack/service-datasource": patch
---

fix(service-datasource): the admin `remote-tables` route honours `?schema=` instead of dropping it (#7955)

`IExternalDatasourceService.listRemoteTables` is reachable through two live
routes, and only one of them read the query:

- `GET /api/v1/datasources/:name/external/tables` (federation, `packages/rest`)
  forwards `?schema=` to the service.
- `GET /api/v1/datasources/:name/remote-tables` (admin, this package) never
  touched `req.query`, so `?schema=public` came back as the UNFILTERED listing —
  not the filtered set, and not a refusal either.

Wire-visible change, on the admin spelling only: `?schema=<name>` now narrows the
listing to that remote schema, exactly as the federation twin already did. A
request with no `?schema=` is unchanged — it still returns the full listing, so
every existing caller (none of which can have been passing the parameter
meaningfully) sees the same bytes as before.

The coercion is copied from the federation route rather than reinvented, down to
its treatment of a non-string: a repeated `?schema=a&schema=b` reaches the
handler as an array and both spellings drop it to "no filter". No refusal, no
warning, no deprecation is added here — whether an unusable query parameter
should be REFUSED is the global ingress-policy question tracked by #7606, and
honouring the parameter is correct under either answer it reaches, so the twins
can move together then.

This finishes on the REQUEST path what #4249 did for the failure path ("one
operation, one failure contract now, on both paths"). The equivalence is pinned
across the two packages by
`packages/rest/src/remote-tables-twin.equivalence.test.ts`, which drives the same
query at BOTH spellings against one service and compares the answers — a test
that exercised only the fixed route could not fail if the twins drift apart
again. `@objectstack/rest` gains two dev-only workspace dependencies so that test
can mount both registrars; its published surface is unchanged.
