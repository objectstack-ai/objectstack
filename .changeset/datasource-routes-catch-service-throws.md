---
"@objectstack/service-datasource": patch
"@objectstack/rest": patch
---

fix(service-datasource,rest): the last three uncovered datasource routes answer their registered refusal code (#4264)

#4249 (fixed in #4263) gave the rest surface's two introspection routes a
failure contract; this closes the same gap on the three sibling routes it left
uncovered. Each had no `catch` around its service call, so a service throw was
swallowed by the adapter and surfaced as the pre-#3675 non-envelope
`500 { error: 'No response from handler' }` — no `success` flag, no
`error.message`, no code to switch on, real cause lost.

Wire-visible changes — each route now answers `400` in the declared envelope,
under the refusal code registered (ADR-0112) for the service it dispatches to,
with the service's own message at `error.message`:

- `GET /api/v1/datasources` (`listDatasources` throw) →
  `400 DATASOURCE_ADMIN_ERROR` — matching its eight siblings in
  `service-datasource/admin-routes.ts`, which already answer their catches this
  way.
- `POST /api/v1/datasources/:name/external/refresh-catalog` (`refreshCatalog`
  throw) and `POST /api/v1/datasources/:name/external/validate` (`validateAll`
  throw) → `400 EXTERNAL_DATASOURCE_ERROR` — the same code #4249 gave the two
  introspection routes one block above them.

The issue left the code choice open (`INTERNAL_ERROR` was the alternative);
the registered per-service codes win on consistency: every other catch in both
modules — including pure reads — already answers 400 with the service-attributed
code, and `refreshCatalog`'s dominant throw class (unknown datasource,
unreachable remote, no such schema) is the one #4249 already adjudicated as a
400 refusal on `listRemoteTables`. A 500 here would fork the failure contract
within a module — the drift #4249 removed.

No new codes: both were registered in the error-code ledger by #4263. The
envelope-conformance suites and the `REFUSALS` pin table gain one row per
route.
