---
"@objectstack/rest": patch
"@objectstack/client": patch
"@objectstack/runtime": patch
---

feat(rest): route audit tranche 2 — the REST surface gets its own ledger +
conformance guard (#3587, follow-up to #3563)

The dispatcher tranche closed its 27 gaps and guards them (#3569…#3579), but
`@objectstack/rest` mounts a second, larger surface the client also reaches —
89 routes, never audited. `rest-route-ledger.ts` now records a reviewed
disposition for every one of them (38 sdk, 43 gap, 3 server-only, 3 public,
2 mismatch), and the guard is real enumeration on both sources: RouteManager
routes via the `getRoutes()` introspection seam, and the two
RouteManager-bypassing registrars (`package-routes.ts`,
`external-datasource-routes.ts`) via captured mock-server registrations — no
pinned-by-hand list. The client half
(`rest-route-ledger-coverage.test.ts`) verifies every claimed method exists;
a 43-gap ratchet is wired into CI. Every guard direction was negative-tested.

Notable dispositions the audit surfaced: `POST /api/v1/packages` is a
publish/install shape collision between REST and the dispatcher (REST
registers first and wins) — ledgered `mismatch`; the REST
`GET /ui/view/:object/:type` path dialect is unreachable by the SDK's
query-param dialect — ledgered `mismatch`; `service-storage` /
`service-i18n` mount a third route surface outside `@objectstack/rest`,
explicitly out of scope here and tracked under #3587.

No behavior change — data + tests only, plus a scope-note refresh in the
runtime ledger pointing at the new REST ledger.
