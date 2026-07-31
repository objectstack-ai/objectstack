---
"@objectstack/spec": patch
"@objectstack/service-datasource": patch
"@objectstack/rest": patch
---

fix(service-datasource,rest)!: external-datasource refusals answer their own error code (#4249)

#4225 / #4234 fixed the 503 `message` on the three routes in
`service-datasource/admin-routes.ts` that dispatch to `external-datasource`
rather than `datasource-admin`. The identical mis-attribution survived one field
over, on the 400 path — and machine-readably: one shared `badRequest` helper
hard-coded `DATASOURCE_ADMIN_ERROR`, which the ADR-0112 ledger defines as a
refusal *from the datasource-admin service*. So a `no such schema` raised by the
external-datasource introspector was reported as datasource-admin's, and where
#4225 misled a human reading prose, this misrouted a client switching on
`error.code`.

`EXTERNAL_DATASOURCE_ERROR` is now registered in the error-code ledger — under
`@objectstack/service-datasource` and `@objectstack/rest`, the two packages that
emit it; per the ledger's own rule the per-package rows are provenance, not
identity — and `badRequest` takes the same `ServiceName` the route passed to
`resolve` (#4234), so the code, like the 503 message, comes from the service the
route actually dispatches to.

Wire-visible changes:

- **The three external-datasource routes' 400 `error.code`** —
  `GET /datasources/:name/remote-tables`, `POST /datasources/:name/test`,
  `POST /datasources/:name/object-draft` — is now `EXTERNAL_DATASOURCE_ERROR`
  (was `DATASOURCE_ADMIN_ERROR`). Status, envelope, and `error.message` are
  unchanged, as is everything on the six datasource-admin routes. No consumer
  branches on the old code (grepped both repos, all the ADR-0112 sweep forms).
- **The rest surface's two introspection routes now have a failure contract at
  all.** `GET /datasources/:name/external/tables` and
  `POST /datasources/:name/external/tables/:remote/draft` carried no
  `try`/`catch`, so the very same service operations that answer 400 through
  the admin surface surfaced here as the adapter's non-envelope
  `500 { error: 'No response from handler' }`. They now answer
  `400 EXTERNAL_DATASOURCE_ERROR` in the declared envelope — one operation, one
  failure contract, on both paths. (`EXTERNAL_IMPORT_ERROR` on the import route
  is unchanged: a refused import is a different act from a failed
  introspection, and its name says so.)

Why a new registered code rather than reusing one: ADR-0112's ledger asks
*generic* conditions to reuse the standard catalog — that argument carried
#4225's 503, where `SERVICE_UNAVAILABLE` is correct for all nine routes and only
the free-text `message` named the service. A refusal specific to one service is
exactly what registered extension codes are for, and the closed `ErrorCode`
union means correcting the attribution had to be a ledger edit. Widening
`EXTERNAL_IMPORT_ERROR` to cover introspection was rejected because these are
not imports; leaving the throws uncaught was rejected because the adapter's 500
is not the declared envelope.

The conformance rows that pinned the drift move with it, and each surface now
pins the refusal code per route the way #4234 pinned the 503 message per route.

Pre-existing, like #4225: #3843 carried every code string over verbatim.
